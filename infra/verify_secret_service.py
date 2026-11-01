#!/usr/bin/env python3
"""Verify the real HTTPS secret service with fictional data; never display secrets."""
import argparse
import getpass
import json
import secrets
import sys
import urllib.error
import urllib.request
import uuid
from verify_production import read_public_key, NoRedirect, SafeError

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--email',required=True)
    args=parser.parse_args()
    if not sys.stdin.isatty():raise SafeError('Use an interactive terminal.')
    key=read_public_key('/opt/workstel/.env')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
    token=None;count=0;created=None
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
    password=getpass.getpass('Workstel admin password (hidden): ')
    fictional='Fictional-試験-'+secrets.token_urlsafe(32)
    try:
        auth,_=request('/auth/v1/token?grant_type=password',{'email':args.email,'password':password},authenticated=False)
        password='';token=auth.get('access_token');auth=None
        require(isinstance(token,str) and bool(token),'Actual HTTPS sign-in')
        status,headers=secret('status',{})
        require(status.get('data',{}).get('available') is True,'Initialized, unsealed KMS and secret schema available')
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
        written,_=secret('write',payload);require(written.get('data',{}).get('version')==1,'Actual Transit-encrypted password written')
        repeated,_=secret('write',payload);require(repeated.get('data',{}).get('version')==1,'Idempotent retry does not overwrite the committed password')
        stale,_=secret('write',{**payload,'requestId':str(uuid.uuid4())},expected=(409,));require(stale.get('expected_status')==409,'Stale secret update rejected')
        revealed,headers=secret('reveal',{'accountId':created})
        require(revealed.get('data',{}).get('password')==fictional,'Actual Transit decryption matches fictional value')
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
            try:request('/auth/v1/logout')
            except SafeError:print('Test sign-out could not be confirmed; token was not displayed.')
        token=None

if __name__=='__main__':
    try:main()
    except (SafeError,OSError,ValueError,KeyError,TypeError) as error:
        print('Commissioning stopped: '+(str(error) if isinstance(error,SafeError) else 'Configuration or response validation failed; details suppressed.'),file=sys.stderr)
        sys.exit(1)
