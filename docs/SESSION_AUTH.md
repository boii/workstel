# Refresh-safe browser sessions

The production frontend uses the same-origin Cloudflare Pages Function at
`https://workstel.pages.dev/api/session` for password sign-in, OAuth PKCE token
exchange, refresh and local logout. Supabase still validates identities and the
existing `workstel_session` RPC still determines hotel/department access. This
change does not enable Google OAuth or change server permissions.

The real refresh token is AES-256-GCM encrypted by the Function and placed in a
`__Host-workstel-session` cookie with `HttpOnly`, `Secure`, `SameSite=Strict` and
`Path=/`. The encryption key remains in a Cloudflare encrypted secret binding.
The cookie has a fixed 12-hour lifetime from sign-in; rotating the refresh token
does not extend that deadline. A new password sign-in starts a new deadline.
Existing access tokens retain their Auth-issued expiry. Closing a tab does not
sign out. Staff must explicitly sign out on shared devices.

Only the short-lived access token and a non-secret refresh marker reach the SDK.
Both stay in memory. On reload the client calls the refresh endpoint with the
HttpOnly cookie, then revalidates the user and workspace permissions. The actual
refresh token, passwords and Vault values are never placed in localStorage or
sessionStorage. The existing temporary OAuth verifier remains in sessionStorage
for at most ten minutes. OAuth provider tokens are not returned by this endpoint.

All session requests require the exact production Origin. Cross-origin requests,
unsupported grants, malformed cookies and oversized input fail closed. Only
`/api/session` invokes the Function; other routes retain static Pages behavior.
Preview deployment origins cannot use production sessions. Function responses
are non-cacheable and contain safe errors. Upstream logout is scoped to the
current session and the cookie is cleared even if upstream revocation fails.
Local development needs a same-origin HTTPS endpoint with a separately approved
development origin; production origins must not be loosened for development.

## Google sign-in policy

Decision, 7 November 2026 (revised the same day): anyone with a Google account
may create a Workstel account with "Continue with Google". The hotel has no
Google Workspace admin access, so the OAuth client is External and accounts are
not limited to a domain. A new account has no hotel, department or module access
and sees "No workspace access yet. Contact your administrator." until a developer
opens Users, checks who it is and grants access. Grants are the activation step;
there is no separate approval state. Block accounts that should not be there.

Every other self-service sign-up stays refused. Migration
`202611070003_google_signup.sql` replaces `workstel_private.before_user_created`,
a Supabase Auth "Before User Created" hook. It admits a new user only when the
provider is `google` or when `app_metadata.workstel_admin_created` is `true`. Only
the service role can set that flag, and the Users backend sets it when a developer
creates an account. Email/password, magic link, phone, anonymous and any other
provider sign-ups are rejected with HTTP 403. The staff-domain list from
`202611070002_signup_domains.sql` is dropped.

Sign-up must only be opened together with the hook. Without it, turning
`GOTRUE_DISABLE_SIGNUP` off also opens public email/password registration.

To enable it on the hotel server:

1. Confirm that the pinned Auth release supports the Before User Created hook.
   If it does not, stop: keep sign-up disabled.
2. Install the hook with `bash infra/apply-signup-migration.sh` from the release
   checkout. It backs up the database first and changes no Auth setting.
3. In Google Cloud, configure the OAuth consent screen as External and publish it
   to production (in Testing only listed test users can sign in). Request only the
   default `openid`, `email` and `profile` scopes. Create a web client with the
   redirect URI `https://workstel.gabot.my.id/auth/v1/callback`.
4. In the server `.env` only (never in this repository, frontend variables or
   chat), set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_ENABLED=true`,
   `SIGNUP_HOOK_ENABLED=true` and `DISABLE_SIGNUP=false`. The Compose overlay
   (`infra/docker-compose.workstel-auth.yml`) maps them to the Auth settings.
5. Recreate only the auth service and run `infra/check-auth-config.sh`.
6. Verify straight away, and set `DISABLE_SIGNUP=true` again if any check fails:
   - `POST /auth/v1/signup` with an email and password returns 403.
   - A new Google account can sign in, appears in Users and has no access.
   - A developer can still create an account from Users.
   - An existing staff account that signs in with Google under the same email
     keeps its access.
7. The sign-in page shows the Google button once Auth reports Google as enabled.
   No frontend deployment is needed.

### Server commands

Run these on the hotel server from the release checkout, after it holds this
change. Edit `.env` with an editor; never put the client secret in a command.

```bash
# Compose files, project folder and Auth image of the running auth service.
dir=$(docker inspect workstel-auth --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}')
files=$(docker inspect workstel-auth --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}')
docker inspect workstel-auth --format '{{.Config.Image}}'
echo "$dir"; echo "$files"
# The overlay among them must be this release's version.
grep -l SIGNUP_HOOK_ENABLED ${files//,/ }
compose() { (cd "$dir" && docker compose $(printf -- '-f %s ' ${files//,/ }) "$@"); }
```

Stage 1, Google sign-in for existing accounts only. Add the client ID and secret
to `$dir/.env` with `GOOGLE_ENABLED=true`, leaving sign-up disabled, then:

```bash
compose up -d --no-deps --force-recreate auth
bash infra/check-auth-config.sh
```

Stage 2, open sign-up for Google. Run `bash infra/apply-signup-migration.sh`,
set `SIGNUP_HOOK_ENABLED=true` and `DISABLE_SIGNUP=false` in `$dir/.env`, recreate
auth as above, then probe email/password sign-up. It must print `403`:

```bash
anon=$(grep '^ANON_KEY=' "$dir/.env" | cut -d= -f2-)
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://workstel.gabot.my.id/auth/v1/signup \
  -H "apikey: $anon" -H 'content-type: application/json' \
  -d "{\"email\":\"signup-probe@example.com\",\"password\":\"Probe-$(openssl rand -hex 12)\"}"
```

Any other result means the hook is not active: set `DISABLE_SIGNUP=true`,
recreate auth, and delete `signup-probe@example.com` if it was created.

Anyone can create accounts, so the Users list fills with strangers over time; it
shows the first 500 accounts by email. Leaving the hotel still requires blocking
the Workstel account, because Google cannot be disabled centrally here.

Both stages were applied to the hotel server on 7 November 2026 (see
DEPLOYMENT.md). On the pinned Auth release (`supabase/gotrue:v2.197.0`) the hook
does not run for accounts created through the admin API, so developer-created
accounts work with or without the `workstel_admin_created` flag; the flag stays
so the rule holds if a later release starts running it there.

## Cloudflare runtime configuration

Before deploying, configure these **production Pages secret bindings**, separate
from frontend build variables:

- `SESSION_ENCRYPTION_KEY`: 32 cryptographically random bytes encoded as base64url.
- `SESSION_SUPABASE_URL`: the HTTPS Supabase origin, with no trailing slash.
- `SESSION_SUPABASE_PUBLIC_KEY`: the public anon/publishable key; never a service key.

Use `wrangler pages secret bulk --project-name workstel` with JSON through stdin
or the Cloudflare dashboard. Do not print secret values or put them in source,
frontend variables, release packages or shell arguments. Preserve the encryption
key across deployments. Replacing it invalidates every existing session cookie;
it does not affect Vault encryption keys or stored passwords.

Run `npm run format`, `npm run check`, `npm run build:production`, then deploy
`dist` from the repository root so Wrangler includes `functions/api/session.ts`.
Run `node scripts/verify-pages-deployment.mjs` after deployment.

## Acceptance

Automated tests cover SDK sign-in, restoration with a new client, refresh,
encrypted-cookie rotation, logout, cross-origin denial, tampering, wrong keys,
body limits and safe upstream failures. These tests use fictional credentials
and mocked Auth responses. Production acceptance must separately confirm login,
refresh, expiry and logout in a real staff browser. Never claim that mocked
tests prove production authentication.

### Local verification — 2 November 2026

`npm run format`, `npm run check`, `npm run build:production` and
`wrangler pages functions build` passed. Desktop and 390px mobile sign-in UI
were inspected; the mobile document measured 390px with no horizontal overflow.
The initial session-restoration indicator rendered. The static preview has no
live session Function, so no authenticated browser restoration was claimed.

The operator explicitly approved committing, pushing to `main` and updating
Cloudflare after the session configuration approval request. The three production
session bindings were uploaded to Cloudflare project `workstel`; the random
encryption key was generated in memory and piped directly without printing or
saving it. Real staff login/refresh/logout acceptance remains unverified.

The GitHub Actions deployment workflow is included in this release, but automatic
deployment remains blocked by the GitHub account billing restriction and missing
`CLOUDFLARE_API_TOKEN` repository secret. A direct Wrangler production deployment
is required until those external prerequisites are resolved.
