#!/usr/bin/env python3
"""Switch the existing hotel deployment to local AES-GCM, preserving legacy rows.

Run as the server operator. Requires Debian python3-cryptography. Never prints
credentials, ciphertext, plaintext, database output or resolved Compose settings.
Leaves secret operations disabled until HTTPS commissioning succeeds separately.
"""
import base64
import json
import os
from pathlib import Path
import ssl
import subprocess
import sys
import urllib.request
from datetime import datetime, timezone
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from commission_secret_service import update_flag

ROOT = Path('/opt/workstel')
COMPOSE = ['docker', 'compose', '-p', 'workstel', '-f', 'docker-compose.yml', '-f', 'docker-compose.local.yml', '-f', 'docker-compose.workstel-auth.yml', '-f', 'docker-compose.workstel-vault.yml']

def run(command, **kwargs):
    result = subprocess.run(command, capture_output=True, **kwargs)
    if result.returncode:
        raise RuntimeError('Server operation failed; sensitive output suppressed. Secret operations must remain disabled.')
    return result.stdout

def sql(statement):
    return run(['docker', 'exec', '-i', '-u', 'postgres', 'workstel-db', 'psql', '-X', '-At', '--dbname=postgres', '--set=ON_ERROR_STOP=1'], input=statement.encode()).decode().strip()

def main():
    os.umask(0o077)
    release = Path(__file__).resolve().parent.parent
    environment = ROOT / '.env.workstel-vault'
    if environment.is_symlink():
        raise RuntimeError('Application environment must not be a symlink.')
    settings = environment.read_text()
    old = dict(line.split('=', 1) for line in settings.splitlines() if '=' in line and not line.startswith('#'))
    backup = ROOT / 'backups' / ('pre-local-encryption-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(parents=True, mode=0o700)
    # Back up before changing the flag or source. Dump and old keys stay server-only.
    dump = run(['docker', 'exec', '-u', 'postgres', 'workstel-db', 'pg_dump', '--dbname=postgres', '--format=custom'])
    (backup / 'database.dump').write_bytes(dump)
    run(['docker', 'exec', '-i', '-u', 'postgres', 'workstel-db', 'pg_restore', '--list'], input=dump)
    (backup / 'application.env').write_text(settings)
    if Path('/opt/workstel-openbao').exists():
        run(['tar', '-czf', str(backup / 'legacy-key-manager.tar.gz'), '-C', '/opt', 'workstel-openbao'])
    temporary = environment.with_name(environment.name + '.switching')
    with temporary.open('x') as stream:
        stream.write(update_flag(settings, False))
    os.replace(temporary, environment)
    run(COMPOSE + ['up', '-d', '--no-deps', '--force-recreate', 'functions'], cwd=ROOT)
    # No user requests can reach the old secret service while converting.
    run([sys.executable, str(release / 'infra/install_secret_service.py')])
    rows = json.loads(sql("select coalesce(json_agg(json_build_object('id',a.id,'hotel',a.hotel_id,'owner',a.owner_id,'ciphertext',s.ciphertext)),'[]') from workstel_private.vault_secrets s join public.vault_accounts a on a.id=s.account_id;"))
    ring = json.loads((ROOT / 'keys/vault-keyring.json').read_text())
    active = ring['active']
    cipher = AESGCM(base64.b64decode(ring['keys'][active], validate=True))
    updates = []
    token = None
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPSHandler(context=ssl.create_default_context(cafile='/opt/workstel-openbao/tls/ca.crt'))) if any(row['ciphertext'].startswith('vault:') for row in rows) else None
    def bao(path, body):
        headers = {'Content-Type': 'application/json'}
        if token:
            headers['X-Vault-Token'] = token
        req = urllib.request.Request('https://127.0.0.1:8200/v1/' + path, data=json.dumps(body).encode(), headers=headers)
        with opener.open(req, timeout=20) as response:
            payload = response.read(262145)
            if len(payload) > 262144:
                raise RuntimeError('Legacy response exceeded limit.')
            return json.loads(payload) if payload else {}
    try:
        if opener:
            token = bao('auth/approle/login', {'role_id': old['WORKSTEL_OPENBAO_ROLE_ID'], 'secret_id': old['WORKSTEL_OPENBAO_SECRET_ID']})['auth']['client_token']
        for row in rows:
            context = row['hotel'] + ':' + row['id'] + ':' + row['owner']
            if row['ciphertext'].startswith('workstel:aesgcm:v1:'):
                _, _, _, kid, payload = row['ciphertext'].split(':')
                packed = base64.b64decode(payload, validate=True)
                AESGCM(base64.b64decode(ring['keys'][kid], validate=True)).decrypt(packed[:12], packed[12:], ('workstel:aesgcm:v1:' + kid + ':' + context).encode())
                continue
            raw = base64.b64decode(bao('transit/decrypt/workstel-passwords', {'ciphertext': row['ciphertext'], 'associated_data': base64.b64encode(('workstel:v1:' + context).encode()).decode()})['data']['plaintext'], validate=True)
            if not isinstance(json.loads(raw).get('password'), str):
                raise RuntimeError('Legacy secret payload is invalid.')
            nonce = os.urandom(12)
            aad = ('workstel:aesgcm:v1:' + active + ':' + context).encode()
            packed = nonce + cipher.encrypt(nonce, raw, aad)
            if cipher.decrypt(packed[:12], packed[12:], aad) != raw:
                raise RuntimeError('Conversion verification failed.')
            ciphertext = 'workstel:aesgcm:v1:' + active + ':' + base64.b64encode(packed).decode()
            # UUIDs originate in typed PostgreSQL columns; ciphertext is generated base64.
            updates.append("update workstel_private.vault_secrets set ciphertext='" + ciphertext + "' where account_id='" + row['id'] + "';")
            updates.append("insert into workstel_private.audit_events(actor_id,hotel_id,department_id,resource_id,action,outcome,correlation_id) select owner_id,hotel_id,department_id,id,'vault.secret.encryption-migration','success',gen_random_uuid() from public.vault_accounts where id='" + row['id'] + "';")
            raw = None
    finally:
        if token:
            bao('auth/token/revoke-self', {})
            token = None
    if sql("select exists(select 1 from workstel_private.schema_migrations where version='202611010005');") != 't':
        migration = (release / 'supabase/migrations/202611010005_local_encryption.sql').read_text()
        # One transaction holds the table lock across conversion and schema replacement.
        sql('begin; lock table workstel_private.vault_secrets in access exclusive mode; alter table workstel_private.vault_secrets drop constraint vault_secrets_ciphertext_check; alter table workstel_private.vault_secrets add constraint vault_secrets_ciphertext_check check(length(ciphertext)<=65536) not valid; ' + '\n'.join(updates) + migration.removeprefix('begin;'))
    run(COMPOSE + ['config', '--quiet'], cwd=ROOT)
    run(COMPOSE + ['up', '-d', '--no-deps', '--force-recreate', 'functions'], cwd=ROOT)
    print('PASS: legacy rows preserved and verified; local AES-GCM schema/function installed.')
    print('Secret operations remain disabled. Commission HTTPS before removing the legacy container.')

if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Switch stopped; sensitive details suppressed. Keep secrets disabled and inspect the protected server backup locally.', file=sys.stderr)
        sys.exit(1)
