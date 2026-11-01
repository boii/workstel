#!/usr/bin/env python3
"""Enable the secret service only if its interactive HTTPS commissioning passes."""
import argparse
import os
from pathlib import Path
import subprocess
import sys
import time

class CommissionError(Exception):
    pass

def update_flag(contents,enabled):
    lines=contents.splitlines()
    matches=[i for i,line in enumerate(lines) if line.startswith('WORKSTEL_SECRET_SERVICE_ENABLED=')]
    if len(matches)!=1 or lines[matches[0]].split('=',1)[1] not in ('true','false'):
        raise CommissionError('Expected exactly one literal secret-service flag. Environment values were not displayed.')
    lines[matches[0]]='WORKSTEL_SECRET_SERVICE_ENABLED='+('true' if enabled else 'false')
    return '\n'.join(lines)+'\n'

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--email',required=True)
    parser.add_argument('--operator',action='store_true',help='Commission using a fictional scoped test identity created by the server administrator.')
    args=parser.parse_args()
    if not args.operator and not sys.stdin.isatty():raise CommissionError('Use an interactive administrator terminal.')
    release=Path(__file__).resolve().parent.parent
    target=Path('/opt/workstel/.env.workstel-vault')
    if target.is_symlink():raise CommissionError('The application environment is a symlink; review it manually.')
    original=target.read_text(encoding='utf8')
    update_flag(original,False)
    command=['docker','compose','-p','workstel','-f','docker-compose.yml','-f','docker-compose.local.yml','-f','docker-compose.workstel-auth.yml','-f','docker-compose.workstel-vault.yml']
    def run(arguments):
        result=subprocess.run(command+arguments,cwd='/opt/workstel',capture_output=True,text=True)
        if result.returncode:raise CommissionError('Function Compose operation failed; sensitive resolved configuration was suppressed. Inspect service status locally.')
    def write(enabled):
        temporary=target.with_name(target.name+'.commissioning')
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w',encoding='utf8') as stream:stream.write(update_flag(original,enabled))
        os.replace(temporary,target)
    run(['config','--quiet'])
    success=False;attempted=False
    try:
        write(True);attempted=True
        run(['up','-d','--no-deps','functions'])
        print('Controlled commissioning window started. Waiting for the function runtime; no credentials are displayed.',flush=True)
        for _ in range(15):
            state=subprocess.run(['docker','inspect','workstel-edge-functions','--format','{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}'],capture_output=True,text=True)
            if state.returncode==0 and state.stdout.strip() in ('healthy','running'):break
            time.sleep(2)
        result=subprocess.run([sys.executable,str(release/'infra/verify_secret_service.py'),'--email',args.email]+(['--operator'] if args.operator else []))
        if result.returncode:raise CommissionError('Encrypted commissioning did not pass.')
        success=True
        print('Encrypted service commissioning passed. Secret operations remain enabled.')
        print('Off-VM backups are deferred by operator choice; sharing with a second real staff account and recovery drills still need separate validation.')
    finally:
        if attempted and not success:
            try:
                write(False);run(['up','-d','--no-deps','functions'])
                print('Secret operations disabled after unsuccessful commissioning. Metadata remains available.')
            except (CommissionError,OSError):
                print('ATTENTION: Automatic disable could not be confirmed. Set the server secret-service flag false and recreate functions using all four Compose files. Do not accept real passwords.',file=sys.stderr)

if __name__=='__main__':
    try:main()
    except (CommissionError,OSError,ValueError,subprocess.SubprocessError) as error:
        print('Commissioning stopped: '+(str(error) if isinstance(error,CommissionError) else 'Local operation failed; sensitive details suppressed.'),file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        print('Commissioning cancelled. Review the disable result above.',file=sys.stderr)
        sys.exit(130)
