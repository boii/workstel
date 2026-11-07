#!/usr/bin/env bash
# Print only allowlisted, non-secret Auth settings.
set -euo pipefail
docker inspect workstel-auth --format '{{json .Config.Env}}' |
  python3 -c 'import json,sys
allowed={"API_EXTERNAL_URL","GOTRUE_SITE_URL","GOTRUE_URI_ALLOW_LIST","GOTRUE_DISABLE_SIGNUP","GOTRUE_EXTERNAL_EMAIL_ENABLED","GOTRUE_EXTERNAL_GOOGLE_ENABLED","GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI","GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED","GOTRUE_HOOK_BEFORE_USER_CREATED_URI"}
values={}
for item in json.load(sys.stdin):
    key,_,value=item.partition("=")
    if key in allowed:
        values[key]=value
for key in sorted(allowed):
    print(key+"="+values.get(key,"<unset>"))
'
