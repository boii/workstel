# Private Vault server update

Run only on the existing Workstel hotel server. This package contains no environment file, API key, password, database backup or private key.

1. Verify the downloaded archive checksum before extracting it.
2. Extract into a dedicated release directory, not over the running Supabase Compose files.
3. Run bash infra/apply-private-migration.sh from the extracted directory.
4. Run python3 infra/verify_production.py --email YOUR_APPROVED_ADMIN_EMAIL.

The migration takes a restricted local backup, validates that the archive can be listed, and applies the audit/privacy changes atomically. Existing records become private to their original creators; shares start empty. Existing passwords and Supabase services are not reset. The helper skips an already recorded private release.

The verifier requests the admin password interactively without printing it and signs out its own session. It creates fictional account metadata and retains it archived for audit evidence. Share only PASS/FAIL summaries, never passwords, environment files or backups.

This release commissions metadata privacy and explicit read-only sharing. It does not activate encrypted password storage/reveal. The later local AES-GCM secret-service release and remaining recovery work are documented in docs/VAULT_OPERATIONS.md.
