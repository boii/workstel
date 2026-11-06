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

Decision, 7 November 2026: public sign-up stays disabled
(`GOTRUE_DISABLE_SIGNUP: 'true'`). Google is a sign-in method for existing staff
accounts only. A developer creates each account through the admin API with the
staff member's Google email address and assigns access as usual. That staff
member then uses "Continue with Google", and Auth is expected to link the Google
identity to the existing account by its verified email. A Google account with no
matching Workstel account is refused because sign-up is disabled.

Linking while sign-up is disabled has not yet been verified on the pinned Auth
release. Verify it before telling staff to use Google.

To enable Google on the hotel server:

1. Create a Google OAuth web client with the redirect URI
   `https://workstel.gabot.my.id/auth/v1/callback`.
2. Put the client ID and secret in the server `.env` only. Never put them in this
   repository, frontend variables or chat.
3. Reference them from the auth service environment in the Compose overlay:
   `GOTRUE_EXTERNAL_GOOGLE_ENABLED`, `GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID`,
   `GOTRUE_EXTERNAL_GOOGLE_SECRET` and
   `GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI`. Keep `GOTRUE_DISABLE_SIGNUP: 'true'`.
   Recreate only the auth service.
4. The sign-in page shows the Google button automatically once Auth reports
   Google as enabled. No frontend deployment is needed.
5. In a real browser, confirm that a pre-created staff account signs in with
   Google and keeps its access, and that an unknown Google account is refused.

## Google sign-up domain restriction

This hook is optional defence in depth and is not required by the policy above.

Migration `202611070002_signup_domains.sql` adds
`workstel_private.before_user_created`, a Supabase Auth "Before User Created"
hook. When it is enabled, a new account created through Google (or any provider
other than email/password) is rejected with HTTP 403 unless its email domain
exactly matches a row in `workstel_private.signup_domains`. Subdomains must be
listed separately. With no rows, every external-provider sign-up is rejected.
Developer-created email/password accounts are unaffected, and an existing staff
account that signs in with Google under the same verified email is linked rather
than created, so it is unaffected too. A permitted sign-up still has no hotel,
department or module access until a developer assigns it.

To activate it after applying the migration:

1. Add the staff domain(s) in the Supabase SQL editor, in lowercase:
   `insert into workstel_private.signup_domains(domain) values ('hotel.example');`
2. The hotel stack is self-hosted, so there is no dashboard hook page. Add the
   hook to the auth service environment in the Compose overlay
   (`infra/docker-compose.workstel-auth.yml`) and recreate only the auth service:
   `GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED: 'true'` and
   `GOTRUE_HOOK_BEFORE_USER_CREATED_URI: pg-functions://postgres/workstel_private/before_user_created`.
   First confirm that the pinned Auth release supports this hook.
3. Confirm in a real browser that a staff-domain Google account can sign up and
   that an outside Google account is refused.

The production Auth service currently sets `GOTRUE_DISABLE_SIGNUP: 'true'`. While
that stays on, Auth refuses every new user, including Google ones, so the hook
has no effect. Turning it off would also reopen public email/password sign-up,
which this hook deliberately allows for the admin API path. Do not turn sign-up
back on until email/password self-registration is blocked separately.

The hook and the Google provider are not enabled by this repository, and the
steps above have not yet been verified against the production server.

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
