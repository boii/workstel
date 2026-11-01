# Hotel-hosted Supabase

Deploy the official Docker stack outside the Workstel source checkout. Pin and record the selected release/commit and image digests.
supabase.env.example is a configuration overlay, not a complete environment and not a turnkey deployment.
Do not commit real .env files, TLS private keys, database dumps, signing keys or admin credentials.
See docs/DEPLOYMENT.md for network, authentication, migration, audit and recovery requirements.

## Confirmed hotel host

The operator reports Debian GNU/Linux 13 (trixie) and Docker 29.9.2. These are reported versions, not yet verified on the server.
Run the read-only preflight using bash infra/preflight-debian.sh on the hotel server. It checks OS, architecture, memory, disk, daemon/Compose availability, candidate port conflicts and required commands without printing environment secrets or changing services.
Existing Docker services must be preserved. Install Supabase in a dedicated directory and Compose project; do not reuse or remove unrelated volumes/networks.
Remote access, actual HTTPS API hostname, server capacity and backup destination remain to be confirmed.
