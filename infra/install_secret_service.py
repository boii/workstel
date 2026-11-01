#!/usr/bin/env python3
"""Install only the Workstel secret function and reviewed Compose overlay."""
import json
import os
import base64
import secrets
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime,timezone

def main():
    release=Path(__file__).resolve().parent.parent
    root=Path('/opt/workstel').resolve()
    for path in [root/'.env.workstel-vault']:
        if not path.is_file():raise RuntimeError('Prepare the application environment first.')
    settings=(root/'.env.workstel-vault').read_text(encoding='utf8')
    if any(line.strip()=='WORKSTEL_SECRET_SERVICE_ENABLED=true' for line in settings.splitlines()):raise RuntimeError('Disable secret operations and recreate the function service before replacing its source.')
    result=subprocess.run(['docker','inspect','workstel-edge-functions'],capture_output=True,text=True,check=True)
    container=json.loads(result.stdout)[0]
    mounts=[m for m in container['Mounts'] if m['Destination']=='/home/deno/functions' and m['Type']=='bind']
    if len(mounts)!=1:raise RuntimeError('Expected one explicit bind mount for the function directory. No files were copied.')
    base=Path(mounts[0]['Source']).resolve()
    target=base/'workstel-vault'
    if not base.is_relative_to(root) or (target.exists() and target.is_symlink()) or not target.resolve().is_relative_to(root):raise RuntimeError('Function target must stay within /opt/workstel without a symlink escape.')
    backup=root/'backups'/('function-source-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(mode=0o700,parents=True)
    target.mkdir(mode=0o755,exist_ok=True)
    target.chmod(0o755)  # mkdir mode is reduced by the caller's umask.
    for name in ['index.ts','handler.ts','crypto.ts']:
        destination=target/name
        if destination.is_symlink():raise RuntimeError('Existing function source is a symlink; review it manually.')
        if destination.exists():shutil.copy2(destination,backup/name)
        shutil.copyfile(release/'backend/vault'/name,destination)
        destination.chmod(0o644)
    keydir=root/'keys'
    if keydir.is_symlink():raise RuntimeError('Key directory must not be a symlink.')
    keydir.mkdir(mode=0o700,exist_ok=True)
    keydir.chmod(0o700)
    keyfile=keydir/'vault-keyring.json'
    if keyfile.is_symlink():raise RuntimeError('Key file must not be a symlink.')
    if not keyfile.exists():
        fd=os.open(keyfile,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w',encoding='utf8') as stream:
            json.dump({'active':'k1','keys':{'k1':base64.b64encode(secrets.token_bytes(32)).decode()}},stream)
    keyfile.chmod(0o600)
    ring=json.loads(keyfile.read_text(encoding='utf8'))
    if ring.get('active') not in ring.get('keys',{}) or any(len(base64.b64decode(k,validate=True))!=32 for k in ring['keys'].values()):
        raise RuntimeError('Existing keyring is invalid; it was not replaced.')
    environment=root/'.env.workstel-vault'
    if environment.is_symlink():raise RuntimeError('Application environment is a symlink; review it manually.')
    lines=[line for line in settings.splitlines() if not line.startswith('WORKSTEL_OPENBAO_') and not line.startswith('WORKSTEL_VAULT_KEYRING=')]
    shutil.copy2(environment,backup/environment.name)
    temporary=environment.with_name(environment.name+'.new')
    if temporary.exists():temporary.unlink()
    fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w',encoding='utf8') as stream:stream.write('\n'.join(lines)+'\n')
    os.replace(temporary,environment)
    overlay=root/'docker-compose.workstel-vault.yml'
    if overlay.is_symlink():raise RuntimeError('Compose overlay is a symlink; review it manually.')
    if overlay.exists():shutil.copy2(overlay,backup/overlay.name)
    shutil.copyfile(release/'infra/docker-compose.workstel-vault.yml',overlay)
    overlay.chmod(0o600)
    shutil.copyfile(release/'infra/start-vault.sh',root/'start-vault.sh')
    (root/'start-vault.sh').chmod(0o600)
    print('Workstel function source and additive Compose overlay installed. Existing function router was preserved.')
    print('No service was restarted. Secret operations remain disabled until explicitly commissioned.')

if __name__=='__main__':
    try:main()
    except (RuntimeError,OSError,ValueError,KeyError,subprocess.SubprocessError) as error:
        print('Installation stopped: '+(str(error) if isinstance(error,RuntimeError) else 'Local inspection or file installation failed; sensitive output suppressed.'),file=sys.stderr)
        sys.exit(1)
