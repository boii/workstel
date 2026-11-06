# Password Vault

The production implementation uses authenticated Supabase RPCs for account metadata and durable audit. The development demo uses in-memory sample records only.

## Layout contract

Use `VaultDialog.vue` for Vault overlays. It owns the compact title, close control,
scrollable body and fixed action footer. Standard forms and account details use 560px maximum width;
confirmations use 440px, and Audit log uses 960px. Account details open
as a bottom sheet on phones (`sheet`), and Audit log fills the mobile screen. Short forms remain content-sized with a
scrollable body when space is limited.

Shared styles use 20px horizontal gutters on desktop and 16px on mobile, 20/19px
dialog titles, 36px desktop actions and at least 44px mobile touch targets. Keep
primary actions at the right of the footer. Use the toolbar slot for audit
filters so controls remain visible while the body scrolls. Metadata forms keep
password guidance separate from editable account fields. The development demo
reuses the list and dialog layouts while retaining its explicit preview limits.

## Access model

Accounts are private to their original creator by default. Hotel/department administrative permissions do not grant account metadata access. Owners can explicitly grant read-only access to active staff at the same hotel by exact email, and revoke it. Recipients cannot edit, archive or reshare. Writes and access changes have optimistic version checks and transactional audit.

Private here describes application authorization, not end-to-end encryption against the server operator. Database operators remain trusted administrators. Never promise that a server administrator has no technical access.

Migrations 202611010002 and 202611010003 must be installed before the frontend enables the live Vault. Existing account rows become private to created_by; shares start empty. The session RPC advertises private-v1 only after the privacy functions are installed. Do not remove this compatibility gate to bypass a migration failure.

## Boundaries

Implemented metadata fields: name, username, HTTPS website, department and notes. Do not enter passwords or recovery codes in these fields. Encrypted password storage/reveal/copy are implemented behind an authenticated availability gate and remain disabled until the separately managed encryption service is commissioned and tested.

Staff use Workstel. Backend AES-256-GCM uses a protected server keyring with automatic startup. Key backup and rotation remain administrator responsibilities; see docs/VAULT_OPERATIONS.md.

See docs/DEPLOYMENT.md and docs/VAULT_BACKEND_DESIGN.md for setup and outstanding release requirements.

## Audit isolation

The Vault audit reader returns only `vault.*` events, with existing hotel/department permissions. Reader access is recorded as `vault.audit.read`. Platform session, staff-access and bootstrap events remain stored but are excluded from this API. Legacy `audit.read` records remain unchanged and are excluded because they have no module namespace. The frontend rejects responses containing non-Vault actions.

Apply `supabase/migrations/202611030001_module_audit_isolation.sql` after the existing migrations before releasing the updated frontend. This repository change alone does not update the live server.
