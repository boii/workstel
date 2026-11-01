# OpenBao and encrypted password commissioning

This is an administrator workflow. Staff only use Workstel. Never send initialization output, unseal keys, operator tokens, application environment files or backups to chat.

Status (1 November 2026): commissioned on the hotel server. OpenBao 2.7.2 is initialized/unsealed, configure_openbao.py passed, migration 202611010004 is recorded, and commission_secret_service.py passed all 17 checks over the public HTTPS endpoint. WORKSTEL_SECRET_SERVICE_ENABLED=true. Sharing with a second real staff account, key rotation, restore drills and off-VM backups remain unvalidated.

## Commissioning findings

- The OpenBao container must run as the host workstel-kms UID/GID (WORKSTEL_KMS_UID/GID) and bypass the image entrypoint, which tries to chown read-only mounts.
- The Supabase edge runtime ignores DENO_CERT and cannot read files outside the function bundle. The installer writes the public CA as WORKSTEL_OPENBAO_CA_PEM_B64; the function trusts it only for OpenBao requests.
- Cloudflare's browser integrity check rejects the default Python-urllib User-Agent (error 1010); the verifier sends its own User-Agent.
- After a host reboot, Docker may start before eth1 has 10.10.10.108, so workstel-envoy (api-gw) and workstel-pooler fail to bind and the public API returns 502. Recreate api-gw with all four Compose files and unseal OpenBao after every reboot. A permanent boot-order fix is pending.

## 1. Prepare the isolated key manager

From the extracted release directory on Debian:

```bash
bash infra/start-openbao.sh
```

The helper does not replace existing /opt/workstel-openbao data. It creates a dedicated TLS CA and server certificate, an explicit existing Docker network binding, persistent Raft/audit directories and a separate Compose project. Only loopback port 8200 is published. TLS verification stays enabled; the certificate has the internal Docker name and loopback IP. OpenBao is capped at 512 MB with container swap disabled. Its CA signing key is not mounted into the container. Keep the CA/recovery material protected separately from the application database.

The starter pulls the official OpenBao 2.7.2 release and pins its observed RepoDigest in the local environment before starting the container. No digest is invented in this repository.

## 2. Initialize and unseal — operator only

```bash
docker exec -it workstel-openbao bao operator init -key-shares=3 -key-threshold=2

docker exec -it workstel-openbao bao operator unseal
docker exec -it workstel-openbao bao operator unseal

docker exec workstel-openbao bao status
```

Initialization displays three sensitive unseal shares and an initial root token in the operator's terminal. Preserve the shares independently of this VM before continuing. The two unseal commands must use two different shares, entered into the hidden prompts. Do not use keys as command arguments. Never paste initialization output here. Report only Initialized/Sealed status. A restart seals this single-node service again and requires operator unsealing. This deployment provides no high availability.

## 3. Configure least-privilege application credentials

```bash
python3 infra/configure_openbao.py
```

The helper requests the operator token with hidden input. It creates a non-exportable AES-256-GCM transit key, a policy scoped to that named key's encrypt/decrypt operations and self token revocation, and an AppRole. It validates an actual fictional encrypt/decrypt round trip and saves only scoped application credentials to a root-only /opt/workstel/.env.workstel-vault. It never persists the operator token. Secret IDs expire after 30 days; schedule monitored rotation with --rotate and recreate the function service afterward. Root credentials must remain outside the application, with a documented administrative authentication/recovery procedure; revoke the bootstrap root token once that procedure is tested.

## 4. Install the service while it remains disabled

```bash
bash infra/apply-secret-migration.sh
python3 infra/install_secret_service.py

cd /opt/workstel
docker compose -p workstel \
  -f docker-compose.yml -f docker-compose.local.yml \
  -f docker-compose.workstel-auth.yml -f docker-compose.workstel-vault.yml \
  config --quiet

docker compose -p workstel \
  -f docker-compose.yml -f docker-compose.local.yml \
  -f docker-compose.workstel-auth.yml -f docker-compose.workstel-vault.yml \
  up -d --no-deps functions
```

The installation helper discovers the actual function bind mount and refuses targets outside /opt/workstel or symlink escapes. It preserves the shared function router. The additional Compose overlay trusts only the generated public CA certificate; it does not disable TLS or global JWT verification. Keep all four Compose files in subsequent operations. Do not print a fully resolved Compose configuration because it can contain secrets.

## 5. Controlled acceptance before enabling staff password operations

Review the installed gateway/function router and verify /functions/v1/workstel-vault routes to this module with authorization forwarded. Configure the exact frontend origin and a body-free gateway/Auth logging policy. Enable WORKSTEL_SECRET_SERVICE_ENABLED only for a controlled commissioning window, recreate functions, and test status, fictional password write/reveal, wrong credentials, stale authentication, recipient sharing/revocation, version conflicts, no-store responses and audit while using the real HTTPS endpoint. The frontend reveals password actions only when authenticated status confirms both the private metadata policy and a healthy initialized/unsealed KMS plus the secret schema.

The service validates the staff token with Supabase Auth before using signed JWT claims. Only original password/OAuth/MFA authentication timestamps count toward the five-minute step-up window; refresh timestamps do not renew it. Staff/anonymous roles cannot call the service-only ciphertext RPCs. PostgreSQL owns permission/version/rate checks and transactional audit. Ciphertext never enters metadata lists. OpenBao associated data binds each ciphertext to hotel, account and owner. Reveal rechecks access/version and commits audit after decryption and before returning plaintext. The client hides plaintext after 30 seconds, blur/tab hiding, dialog close, logout or navigation, and copies only on an explicit click. Clipboard history remains device-controlled.

Do not accept real passwords until this acceptance passes. If the service, KMS, recent authentication or durable audit is unavailable, operations fail closed. Test key rotation and isolated restore with the protected unseal material; never test force-restore against the live instance.

## Deferred operational work

The operator elected to defer off-VM backups on 1 November 2026. Local backups are not disaster recovery. Document that VM/disk loss can lose both ciphertext and KMS state, and track off-host encrypted backups, restore drills, audit log retention, disk/certificate/credential-expiry alerts and a restart/unseal procedure. The TLS server certificate expires after one year and scoped secret IDs after 30 days. Do not describe this deployment as highly available or fully recovery-validated.

## Primary references

- https://openbao.org/docs/install/
- https://github.com/openbao/openbao/releases/tag/v2.7.2
- https://openbao.org/docs/secrets/transit/
- https://openbao.org/docs/configuration/audit/
- https://openbao.org/docs/audit/
- https://supabase.com/docs/guides/auth/jwt-fields
- https://docs.deno.com/runtime/reference/env_variables/

## Automated commissioning gate

After the isolated key manager is initialized/unsealed, configure_openbao.py has passed, and step 4 is installed, run:

```bash
python3 infra/commission_secret_service.py --email YOUR_APPROVED_ADMIN_EMAIL
```

This creates a controlled enablement window, recreates only the functions service with all four Compose files, and runs verify_secret_service.py using a hidden Workstel password prompt. The verifier uses the actual public HTTPS endpoint and a random fictional Unicode password, never prints the value, checks authenticated status, CORS, anonymous denial, ciphertext-free inspection, encryption/decryption, idempotent retry, stale updates, no-store headers, archived-account denial and durable audit. Its fictional account remains archived. If verification fails or is cancelled, the commissioning helper attempts to disable the service and recreate the function runtime; any unconfirmed disable is explicitly reported. Do not treat an interrupted script as successful commissioning.

The bootstrap helper also tests actual associated-data mismatch rejection, restricted application policy and persistent redacted OpenBao audit output. AppRole rotation revokes the prior recorded secret-ID accessor after writing the new restricted environment; recreate functions promptly during a maintenance window. The installer refuses live source replacement while the environment flag is enabled.

The dedicated OpenBao container runs as the workstel-kms non-login system user, not a human user's common UID. Docker Compose syntax is validated locally; the local Docker daemon is unavailable, so container startup and runtime TLS acceptance must be verified on the hotel server.
