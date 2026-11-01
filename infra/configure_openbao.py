#!/usr/bin/env python3
"""Configure a dedicated OpenBao Transit AppRole using hidden operator input."""
import argparse
import getpass
import json
import os
from pathlib import Path
import ssl
import sys
import urllib.error
import urllib.request

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

class SetupError(Exception):
    pass

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--rotate',action='store_true',help='Replace existing scoped application credentials; does not change encryption keys.')
    args=parser.parse_args()
    if not sys.stdin.isatty(): raise SetupError('Use an interactive terminal.')
    target=Path('/opt/workstel/.env.workstel-vault')
    if target.exists() and not args.rotate: raise SetupError('Application environment already exists. Use --rotate only for an intentional credential rotation.')
    old_accessor_path=Path('/opt/workstel-openbao/application-secret-accessor')
    old_accessor=old_accessor_path.read_text(encoding='utf8').strip() if args.rotate and old_accessor_path.exists() else None
    policy=(Path(__file__).parent/'openbao/workstel-policy.hcl').read_text(encoding='utf-8-sig')
    context=ssl.create_default_context(cafile='/opt/workstel-openbao/tls/ca.crt')
    opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),urllib.request.HTTPSHandler(context=context),NoRedirect())
    root=getpass.getpass('OpenBao operator token (hidden; never stored): ')
    if not root.strip(): raise SetupError('Operator token is required.')
    def api(path,body=None,method='GET',optional=False,token=None,expected_status=()):
        headers={'X-Vault-Token':root if token is None else token,'Content-Type':'application/json'}
        req=urllib.request.Request('https://127.0.0.1:8200/v1/'+path,headers=headers,data=json.dumps(body).encode() if body is not None else None,method=method)
        try:
            with opener.open(req,timeout=15) as response:
                payload=response.read(1_000_000)
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as error:
            if error.code in expected_status:return {'expected_status':error.code}
            if optional and error.code==404:return None
            raise SetupError('OpenBao request failed with HTTP '+str(error.code)+'; response suppressed.') from None
        except (urllib.error.URLError,TimeoutError,json.JSONDecodeError):
            raise SetupError('OpenBao connection or response failed; details suppressed.') from None
    mounts=api('sys/mounts')
    if 'transit/' not in mounts.get('data',mounts):api('sys/mounts/transit',{'type':'transit'},'POST')
    key=api('transit/keys/workstel-passwords',optional=True)
    if key is None:
        api('transit/keys/workstel-passwords',{'type':'aes256-gcm96','exportable':False,'allow_plaintext_backup':False},'POST')
    else:
        info=key.get('data',{})
        if info.get('type')!='aes256-gcm96' or info.get('exportable') is not False or info.get('allow_plaintext_backup') is not False:
            raise SetupError('Existing transit key does not match the reviewed non-exportable AES-GCM policy. No key was replaced.')
    auth=api('sys/auth')
    if 'approle/' not in auth.get('data',auth):api('sys/auth/approle',{'type':'approle'},'POST')
    api('sys/policies/acl/workstel-transit',{'policy':policy},'PUT')
    api('auth/approle/role/workstel',{'token_policies':['workstel-transit'],'token_no_default_policy':True,'token_ttl':'5m','token_max_ttl':'10m','secret_id_ttl':'720h','secret_id_num_uses':0},'POST')
    role=api('auth/approle/role/workstel/role-id')['data']['role_id']
    credential=api('auth/approle/role/workstel/secret-id',{},'POST')['data']
    secret=credential['secret_id']
    login=api('auth/approle/login',{'role_id':role,'secret_id':secret},'POST',token='')
    scoped=login['auth']['client_token']
    # A fictional round trip checks the actual Transit engine and associated-data binding.
    import base64
    plain=base64.b64encode(b'Workstel fictional commissioning value').decode()
    associated=base64.b64encode(b'workstel:commissioning').decode()
    encrypted=api('transit/encrypt/workstel-passwords',{'plaintext':plain,'associated_data':associated},'POST',token=scoped)
    decrypted=api('transit/decrypt/workstel-passwords',{'ciphertext':encrypted['data']['ciphertext'],'associated_data':associated},'POST',token=scoped)
    if decrypted.get('data',{}).get('plaintext')!=plain: raise SetupError('Transit round-trip validation failed.')
    wrong=base64.b64encode(b'workstel:wrong-account-binding').decode()
    denied=api('transit/decrypt/workstel-passwords',{'ciphertext':encrypted['data']['ciphertext'],'associated_data':wrong},'POST',token=scoped,expected_status=(400,))
    if denied.get('expected_status')!=400:raise SetupError('Associated-data isolation validation failed.')
    denied=api('sys/audit',token=scoped,expected_status=(403,))
    if denied.get('expected_status')!=403:raise SetupError('Application credentials unexpectedly have audit-administration access.')
    api('auth/token/revoke-self',{},'POST',token=scoped)
    audit=Path('/opt/workstel-openbao/logs/audit.jsonl')
    if not audit.is_file() or audit.stat().st_size==0:raise SetupError('The configured persistent audit device has no evidence.')
    with audit.open('rb') as stream:
        stream.seek(max(0,audit.stat().st_size-131072))
        tail=stream.read().decode('utf8',errors='replace')
    if any(value and value in tail for value in [plain,root,secret]):raise SetupError('Audit output contains an unprotected sensitive test value. Application credentials were not installed.')
    for value in (role,secret,credential['secret_id_accessor']):
        if not isinstance(value,str) or not value or any(c.isspace() for c in value):raise SetupError('Invalid credential response.')
    # The service stays disabled until its schema, runtime and recovery are commissioned.
    contents='\n'.join(['WORKSTEL_SECRET_SERVICE_ENABLED=false','WORKSTEL_OPENBAO_URL=https://workstel-openbao:8200','WORKSTEL_FRONTEND_ORIGIN=https://workstel.pages.dev','WORKSTEL_OPENBAO_ROLE_ID='+role,'WORKSTEL_OPENBAO_SECRET_ID='+secret,''])
    temporary=target.with_name(target.name+'.new')
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf8') as stream:stream.write(contents)
    os.replace(temporary,target)
    if old_accessor:
        api('auth/approle/role/workstel/secret-id-accessor/destroy',{'secret_id_accessor':old_accessor},'POST')
    accessor=Path('/opt/workstel-openbao/application-secret-accessor')
    fd=os.open(accessor,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w',encoding='utf8') as stream:stream.write(credential['secret_id_accessor']+'\n')
    root='';secret='';scoped=''
    print('PASS: Actual Transit encrypt/decrypt round trip, associated-data isolation, restricted application policy and persistent redacted audit.')
    print('Scoped AppRole credentials saved in a root-only server environment file. Values were not displayed.')
    print('The secret service remains disabled. AppRole secret ID expires after 30 days; plan rotation and monitoring.')
    print('Operator/recovery credentials were not written to the application environment.')

if __name__=='__main__':
    try:main()
    except (SetupError,OSError,ValueError,KeyError,TypeError) as error:
        print('Setup stopped: '+(str(error) if isinstance(error,SetupError) else 'Local configuration or response validation failed; details suppressed.'),file=sys.stderr)
        sys.exit(1)
