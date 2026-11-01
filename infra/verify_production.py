#!/usr/bin/env python3
"""Interactive production commissioning. Uses fictional metadata; never prints tokens."""
import argparse
import getpass
import json
from pathlib import Path
import sys
import urllib.error
import urllib.request
import uuid

class SafeError(Exception):
    pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def read_public_key(path):
    values = {}
    for line in Path(path).read_text(encoding='utf-8-sig').splitlines():
        key, separator, value = line.strip().partition('=')
        if separator and key in ('ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'):
            value = value.strip().strip('"\'')
            if value and '$' not in value and not any(c.isspace() for c in value):
                values[key] = value
    result = values.get('ANON_KEY') or values.get('SUPABASE_PUBLISHABLE_KEY')
    if not result:
        raise SafeError('A literal public ANON_KEY or SUPABASE_PUBLISHABLE_KEY is required in the server environment file.')
    return result

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--email', required=True)
    parser.add_argument('--env-file', default='/opt/workstel/.env')
    parser.add_argument('--hotel-id')
    args = parser.parse_args()
    if not sys.stdin.isatty():
        raise SafeError('Use an interactive terminal for hidden password entry.')
    key = read_public_key(args.env_file)
    password = getpass.getpass('Admin password (hidden): ')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    token = None
    created = None
    selected = None
    version = None
    count = 0
    def request(path, body=None, authenticated=True, method='POST', permitted_status=()):
        headers = {'apikey': key, 'Content-Type': 'application/json'}
        if authenticated and token:
            headers['Authorization'] = 'Bearer ' + token
        req = urllib.request.Request('http://127.0.0.1:8000' + path, data=json.dumps(body).encode() if body is not None else None, headers=headers, method=method)
        try:
            with opener.open(req, timeout=20) as response:
                payload = response.read(2_000_000)
                return json.loads(payload) if payload else {}
        except urllib.error.HTTPError as error:
            if error.code in permitted_status:
                return {'expected_http_status': error.code}
            raise SafeError('Request failed with HTTP ' + str(error.code) + '; response contents suppressed.') from None
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
            raise SafeError('Network or response validation failed; details suppressed.') from None
    def rpc(name, body):
        return request('/rest/v1/rpc/' + name, body)
    def require(condition, label):
        nonlocal count
        if not condition:
            raise SafeError('FAIL: ' + label)
        count += 1
        print('PASS: ' + label)
    try:
        auth = request('/auth/v1/token?grant_type=password', {'email': args.email, 'password': password}, authenticated=False)
        password = ''
        token = auth.get('access_token')
        require(isinstance(token, str) and bool(token), 'Email/password sign-in')
        auth = None
        session = rpc('workstel_session', {})
        require(session.get('meta', {}).get('vaultPolicy') == 'private-v1', 'Private Vault server policy commissioned')
        assignments = session.get('data', [])
        candidates = [a for a in assignments if a.get('canRead') and a.get('canWrite') and a.get('canArchive') and a.get('canAudit') and (not args.hotel_id or a['hotelId'] == args.hotel_id)]
        require(bool(candidates), 'Explicit read/write/archive/audit membership')
        hotels = {a['hotelId'] for a in candidates}
        if len(hotels) != 1:
            raise SafeError('Multiple hotels available; rerun with an explicit --hotel-id.')
        selected = candidates[0]
        hotel = selected['hotelId']
        department = selected['departmentId']
        anonymous = request('/rest/v1/rpc/workstel_session', {}, authenticated=False, permitted_status=(401,403))
        require(anonymous.get('expected_http_status') in (401,403), 'Anonymous workspace access denied')
        direct = request('/rest/v1/vault_accounts?select=id&limit=1', method='GET', permitted_status=(401,403))
        require(direct.get('expected_http_status') in (401,403), 'Direct table access denied')
        denied = rpc('vault_list_accounts', {'p_hotel_id': str(uuid.uuid4())})
        require(denied.get('error') == 'ACCESS_DENIED', 'Unknown hotel scope denied')
        denied = rpc('vault_list_accounts', {'p_hotel_id': hotel, 'p_department_id': str(uuid.uuid4())})
        require(denied.get('error') == 'ACCESS_DENIED', 'Unknown department scope denied')
        marker = str(uuid.uuid4())
        sample = {'name': 'Workstel commissioning ' + marker, 'username': 'fictional-test-account', 'website': 'https://example.org', 'notes': 'Automated commissioning record. No credentials. Retained archived for audit evidence.'}
        saved = rpc('vault_write_metadata', {'p_hotel_id': hotel, 'p_department_id': department, 'p_input': sample})
        created = saved.get('data', {}).get('id')
        version = saved.get('data', {}).get('version')
        require(isinstance(created, str) and version == 1, 'Create fictional metadata')
        found = rpc('vault_list_accounts', {'p_hotel_id': hotel, 'p_search': marker, 'p_status': 'all'})
        require(any(a.get('id') == created for a in found.get('data', [])), 'Read created account')
        base = {'p_hotel_id': hotel, 'p_department_id': department, 'p_account_id': created}
        conflict = rpc('vault_write_metadata', {**base, 'p_input': sample, 'p_expected_version': 0})
        require(conflict.get('error') == 'VERSION_CONFLICT', 'Stale edit rejected')
        updated = rpc('vault_write_metadata', {**base, 'p_input': {**sample, 'name': sample['name'] + ' verified'}, 'p_expected_version': version})
        version = updated.get('data', {}).get('version')
        require(version == 2, 'Update with version check')
        for action, expected in [('archive', 3), ('restore', 4), ('archive', 5)]:
            result = rpc('vault_write_metadata', {**base, 'p_input': {}, 'p_expected_version': version, 'p_action': action})
            version = result.get('data', {}).get('version')
            require(version == expected, action.capitalize() + ' with version check')
        audit = rpc('vault_list_audit', {'p_hotel_id': hotel, 'p_department_id': department, 'p_limit': 100})
        records = [a for a in audit.get('data', []) if a.get('resource_id') == created]
        actions = {a.get('action') for a in records if a.get('outcome') == 'success'}
        require({'vault.metadata.save','vault.metadata.archive','vault.metadata.restore'}.issubset(actions), 'Durable audit for tested mutations')
        require(all(a.get('actor_id') and a.get('correlation_id') for a in records), 'Audit actor and reference IDs')
        print('Commissioning passed: ' + str(count) + ' checks. Fictional account remains archived.')
        print('This does not certify encryption, Google OAuth, external browser networking or backup restore.')
    finally:
        password = ''
        # Never delete operational or audit records. Leave an interrupted test recoverable.
        if token:
            try:
                request('/auth/v1/logout')
                print('Test session signed out.')
            except SafeError:
                print('Session sign-out could not be confirmed; no credentials were displayed.')
        token = None

if __name__ == '__main__':
    try:
        main()
    except (SafeError, OSError, ValueError, KeyError, TypeError) as error:
        print('Commissioning stopped: ' + (str(error) if isinstance(error, SafeError) else 'Local configuration or response validation failed; details suppressed.'), file=sys.stderr)
        sys.exit(1)
