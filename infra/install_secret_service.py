#!/usr/bin/env python3
"""Install only the Workstel secret function and reviewed Compose overlay."""
import json
from pathlib import Path
import shutil
import subprocess
import sys
from datetime import datetime,timezone

def main():
    release=Path(__file__).resolve().parent.parent
    root=Path('/opt/workstel').resolve()
    for path in [root/'.env.workstel-vault',Path('/opt/workstel-openbao/tls/ca.crt')]:
        if not path.is_file():raise RuntimeError('Prepare the key manager and scoped application credentials first.')
    settings=(root/'.env.workstel-vault').read_text(encoding='utf8')
    if any(line.strip()=='WORKSTEL_SECRET_SERVICE_ENABLED=true' for line in settings.splitlines()):raise RuntimeError('Disable secret operations and recreate the function service before replacing its source.')
    result=subprocess.run(['docker','inspect','workstel-edge-functions'],capture_output=True,text=True,check=True)
    container=json.loads(result.stdout)[0]
    cert=next((item.partition('=')[2] for item in container['Config'].get('Env',[]) if item.startswith('DENO_CERT=')),None)
    if cert and cert!='/etc/workstel/openbao-ca.crt':raise RuntimeError('Existing custom CA configuration requires a reviewed merged trust bundle; it was not replaced.')
    mounts=[m for m in container['Mounts'] if m['Destination']=='/home/deno/functions' and m['Type']=='bind']
    if len(mounts)!=1:raise RuntimeError('Expected one explicit bind mount for the function directory. No files were copied.')
    base=Path(mounts[0]['Source']).resolve()
    target=base/'workstel-vault'
    if not base.is_relative_to(root) or (target.exists() and target.is_symlink()) or not target.resolve().is_relative_to(root):raise RuntimeError('Function target must stay within /opt/workstel without a symlink escape.')
    backup=root/'backups'/('function-source-'+datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(mode=0o700,parents=True)
    target.mkdir(mode=0o755,exist_ok=True)
    for name in ['index.ts','handler.ts']:
        destination=target/name
        if destination.is_symlink():raise RuntimeError('Existing function source is a symlink; review it manually.')
        if destination.exists():shutil.copy2(destination,backup/name)
        shutil.copyfile(release/'backend/vault'/name,destination)
        destination.chmod(0o644)
    overlay=root/'docker-compose.workstel-vault.yml'
    if overlay.is_symlink():raise RuntimeError('Compose overlay is a symlink; review it manually.')
    if overlay.exists():shutil.copy2(overlay,backup/overlay.name)
    shutil.copyfile(release/'infra/docker-compose.workstel-vault.yml',overlay)
    overlay.chmod(0o600)
    print('Workstel function source and additive Compose overlay installed. Existing function router was preserved.')
    print('No service was restarted. Secret operations remain disabled until explicitly commissioned.')

if __name__=='__main__':
    try:main()
    except (RuntimeError,OSError,ValueError,KeyError,subprocess.SubprocessError) as error:
        print('Installation stopped: '+(str(error) if isinstance(error,RuntimeError) else 'Local inspection or file installation failed; sensitive output suppressed.'),file=sys.stderr)
        sys.exit(1)
