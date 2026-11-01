#!/usr/bin/env python3
"""Verify the real HTTPS secret service with fictional data; never display secrets."""
import argparse
import getpass
import json
import secrets
import subprocess
import sys
import urllib.error
import urllib.request
import uuid
from verify_production import read_public_key, NoRedirect, SafeError

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--email',required=True)
    parser.add_argument('--operator',action='store_true',help='Create a fictional scoped test identity using server administrator credentials; disable it after verification.')
    args=parser.parse_args()
    if not args.operator and not sys.stdin.isatty():raise SafeError('Use an interactive terminal.')
    key=read_public_key('/opt/workstel/.env')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    token=None;count=0;created=None;test_actor=None;admin_request=None
    def request(path,body=None,authenticated=True,expected=()):
        # Cloudflare's browser integrity check blocks the default Python-urllib agent (error 1010).
        headers={'apikey':key,'Origin':'https://workstel.pages.dev','Content-Type':'application/json','User-Agent':'Workstel-Commissioning/1.0'}
        if authenticated and token:headers['Authorization']='Bearer '+token
        req=urllib.request.Request('https://workstel.gabot.my.id'+path,data=json.dumps(body).encode() if body is not None else None,headers=headers,method='POST')
        try:
            with opener.open(req,timeout=45) as result:
                payload=result.read(262145)
                if len(payload)>262144:raise SafeError('Response exceeded the commissioning limit.')
                return (json.loads(payload) if payload else {}),result.headers
        except urllib.error.HTTPError as error:
            if error.code in expected:return {'expected_status':error.code},error.headers
            raise SafeError('Request failed with HTTP '+str(error.code)+'; response suppressed.') from None
        except (urllib.error.URLError,TimeoutError,json.JSONDecodeError):raise SafeError('HTTPS request or response validation failed; details suppressed.') from None
    def require(condition,label):
        nonlocal count
        if not condition:raise SafeError('FAIL: '+label)
        count+=1;print('PASS: '+label)
    def rpc(name,body):
        result,_=request('/rest/v1/rpc/'+name,body)
        if result.get('error'):raise SafeError('Metadata request was rejected; response suppressed.')
        return result
    def secret(operation,body,**kwargs):return request('/functions/v1/workstel-vault/'+operation,body,**kwargs)
    password='' if args.operator else getpass.getpass('Workstel admin password (hidden): ')
    fictional='Fictional-試験-'+secrets.token_urlsafe(32)
    try:
        if args.operator:
            # Use a new fictional identity; never change a real staff member's credentials.
            inspected=subprocess.run(['docker','inspect','workstel-edge-functions'],capture_output=True,text=True,check=True)
            variables=dict(line.split('=',1) for line in json.loads(inspected.stdout)[0]['Config']['Env'] if '=' in line)
            service=variables['SUPABASE_SERVICE_ROLE_KEY']
            def admin_request(path,body,method='POST'):
                headers={'apikey':service,'Content-Type':'application/json','User-Agent':'Workstel-Commissioning/1.0'}
                if not service.startswith('sb_secret_'):headers['Authorization']='Bearer '+service
                req=urllib.request.Request('https://workstel.gabot.my.id/auth/v1/admin/'+path,data=json.dumps(body).encode(),headers=headers,method=method)
                with opener.open(req,timeout=45) as result:return json.loads(result.read(262144))
            inspected=None;variables=None
            password=secrets.token_urlsafe(48)
            test_email='workstel-commissioning-'+str(uuid.uuid4())+'@example.invalid'
            identity=admin_request('users',{'email':test_email,'password':password,'email_confirm':True})
            test_actor=str(uuid.UUID(identity['id']))
            # Copy only the selected operator's scope, requiring all commissioning permissions.
            email_hex=args.email.encode().hex()
            statement="insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read,can_write,can_archive,can_audit) select '"+test_actor+"',hotel_id,department_id,true,true,true,true from workstel_private.staff_access a join auth.users u on u.id=a.user_id where u.email=convert_from(decode('"+email_hex+"','hex'),'UTF8') and a.enabled and a.can_read and a.can_write and a.can_archive and a.can_audit limit 1;"
            result=subprocess.run(['docker','exec','-i','-u','postgres','workstel-db','psql','-X','--dbname=postgres','--set=ON_ERROR_STOP=1'],input=statement,capture_output=True,text=True)
            if result.returncode:raise SafeError('Commissioning identity scope setup failed; details suppressed.')
            auth,_=request('/auth/v1/token?grant_type=password',{'email':test_email,'password':password},authenticated=False)
        else:
            auth,_=request('/auth/v1/token?grant_type=password',{'email':args.email,'password':password},authenticated=False)
        password='';token=auth.get('access_token');auth=None
        require(isinstance(token,str) and bool(token),'Actual HTTPS sign-in')
        status,headers=secret('status',{})
        require(status.get('data',{}).get('available') is True,'Local AES-GCM key and secret schema available')
        require(headers.get_all('Access-Control-Allow-Origin')==['https://workstel.pages.dev'],'Exact frontend CORS origin')
        denied,_=secret('reveal',{'accountId':str(uuid.uuid4())},authenticated=False,expected=(401,403))
        require(denied.get('expected_status') in (401,403),'Anonymous secret access denied')
        session=rpc('workstel_session',{})
        candidates=[a for a in session.get('data',[]) if all(a.get(k) for k in ['canRead','canWrite','canArchive','canAudit'])]
        require(bool(candidates),'Explicit commissioning permissions')
        selected=candidates[0];hotel=selected['hotelId'];department=selected['departmentId']
        marker=str(uuid.uuid4())
        metadata=rpc('vault_write_metadata',{'p_hotel_id':hotel,'p_department_id':department,'p_input':{'name':'Encrypted commissioning '+marker,'username':'fictional-account','website':'https://example.org','notes':'Fictional encrypted-password commissioning record. Retained archived for audit.'}})
        created=metadata.get('data',{}).get('id');require(isinstance(created,str),'Fictional account created')
        inspection,_=secret('inspect',{'accountId':created})
        inspected=inspection.get('data',{})
        require(inspected.get('hasSecret') is False and inspected.get('version')==0 and 'password' not in inspected and 'ciphertext' not in inspected,'No ciphertext or password in inspection')
        request_id=str(uuid.uuid4())
        payload={'accountId':created,'password':fictional,'expectedVersion':0,'requestId':request_id}
        written,_=secret('write',payload);require(written.get('data',{}).get('version')==1,'Actual AES-GCM encrypted password written')
        repeated,_=secret('write',payload);require(repeated.get('data',{}).get('version')==1,'Idempotent retry does not overwrite the committed password')
        stale,_=secret('write',{**payload,'requestId':str(uuid.uuid4())},expected=(409,));require(stale.get('expected_status')==409,'Stale secret update rejected')
        revealed,headers=secret('reveal',{'accountId':created})
        require(revealed.get('data',{}).get('password')==fictional,'Actual AES-GCM decryption matches fictional value')
        require('no-store' in headers.get('Cache-Control',''),'Reveal response is not cacheable')
        require(revealed.get('data',{}).get('expiresIn')==30,'Bounded client reveal lifetime')
        revealed=None
        rows=rpc('vault_list_accounts',{'p_hotel_id':hotel,'p_search':marker,'p_status':'all'}).get('data',[])
        require(len(rows)==1 and 'ciphertext' not in rows[0] and 'password' not in rows[0],'Metadata list excludes ciphertext and password')
        archived=rpc('vault_write_metadata',{'p_hotel_id':hotel,'p_department_id':department,'p_account_id':created,'p_expected_version':rows[0]['version'],'p_action':'archive','p_input':{}})
        require(bool(archived.get('data')),'Fictional test account archived')
        denied,_=secret('reveal',{'accountId':created},expected=(403,));require(denied.get('expected_status')==403,'Archived accounts cannot reveal secrets')
        events=rpc('vault_list_audit',{'p_hotel_id':hotel,'p_department_id':department,'p_limit':100}).get('data',[])
        actions={e['action'] for e in events if e.get('resource_id')==created and e.get('outcome')=='success'}
        require({'vault.secret.write','vault.secret.reveal'}.issubset(actions),'Actual encrypted write and reveal have durable audit')
        print('Encrypted commissioning passed: '+str(count)+' checks. No secret values were displayed.')
        print('Fictional account and encrypted value remain archived for evidence. Other staff sharing and recovery drills remain separate acceptance steps.')
    finally:
        password='';fictional=''
        if token:
            try:request('/auth/v1/logout?scope=local')
            except SafeError:print('Test sign-out could not be confirmed; token was not displayed.')
        token=None
        if test_actor:
            statement="update workstel_private.staff_access set enabled=false where user_id='"+test_actor+"';"
            result=subprocess.run(['docker','exec','-i','-u','postgres','workstel-db','psql','-X','--dbname=postgres','--set=ON_ERROR_STOP=1'],input=statement,capture_output=True,text=True)
            admin_request('users/'+test_actor,{'ban_duration':'876000h'},method='PUT')
            if result.returncode:raise SafeError('Commissioning identity disable failed; inspect locally.')
            print('PASS: fictional commissioning identity disabled and banned; audit evidence retained.')

if __name__=='__main__':
    try:main()
    except (SafeError,OSError,ValueError,KeyError,TypeError) as error:
        print('Commissioning stopped: '+(str(error) if isinstance(error,SafeError) else 'Configuration or response validation failed; details suppressed.'),file=sys.stderr)
        sys.exit(1)
