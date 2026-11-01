#!/usr/bin/env bash
set -euo pipefail
umask 077
release_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
private="$(docker exec -u postgres workstel-db psql -X -At --dbname=postgres --set=ON_ERROR_STOP=1 -c "select exists(select 1 from workstel_private.schema_migrations where version='202611010003');")"
[[ "$private" == t ]] || { printf 'ERROR: Commission the private Vault release first.\n' >&2; exit 1; }
applied="$(docker exec -u postgres workstel-db psql -X -At --dbname=postgres --set=ON_ERROR_STOP=1 -c "select exists(select 1 from workstel_private.schema_migrations where version='202611010004');")"
if [[ "$applied" == t ]]; then printf 'Secret boundary migration is already recorded.\n';exit 0;fi
install -d -m 700 /opt/workstel/backups
backup="/opt/workstel/backups/pre-secret-boundary-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker exec -u postgres workstel-db pg_dump --dbname=postgres --format=custom > "$backup"
test -s "$backup"
docker exec -i -u postgres workstel-db pg_restore --list < "$backup" >/dev/null
docker exec -i -u postgres workstel-db psql -X --set=ON_ERROR_STOP=1 --dbname=postgres < "$release_dir/supabase/migrations/202611010004_secret_boundary.sql"
printf 'Encrypted secret schema installed with restricted local backup. No password endpoint was enabled.\n'
