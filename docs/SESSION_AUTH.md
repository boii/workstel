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

## Google sign-up domain restriction

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
2. In Supabase **Authentication → Hooks**, add a **Before User Created** hook of
   type Postgres function, and select `workstel_private.before_user_created`.
3. Confirm in a real browser that a staff-domain Google account can sign up and
   that an outside Google account is refused.

The hook and the Google provider are not enabled by this repository, and the
steps above have not yet been verified against the production project.

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
