#!/usr/bin/env bash
# Apply reviewed privacy migrations to the existing hotel stack, preserving all records.
set -euo pipefail
umask 077
release_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
for migration in 202611010002_audit_visibility 202611010003_private_vault; do
  test -f "$release_dir/supabase/migrations/$migration.sql" || { printf 'ERROR: Release package is incomplete.\n' >&2; exit 1; }
done
present="$(docker exec -u postgres workstel-db psql -X -At --dbname=postgres --set=ON_ERROR_STOP=1 -c "select to_regclass('workstel_private.staff_access') is not null;")"
[[ "$present" == t ]] || { printf 'ERROR: Initial Workstel schema is missing.\n' >&2; exit 1; }
history="$(docker exec -u postgres workstel-db psql -X -At --dbname=postgres --set=ON_ERROR_STOP=1 -c "select to_regclass('workstel_private.schema_migrations') is not null;")"
if [[ "$history" == t ]]; then
  applied="$(docker exec -u postgres workstel-db psql -X -At --dbname=postgres --set=ON_ERROR_STOP=1 -c "select exists(select 1 from workstel_private.schema_migrations where version='202611010003');")"
  if [[ "$applied" == t ]]; then
    printf 'Private Vault migration is already recorded. No schema changes were made.\n'
    exit 0
  fi
fi
install -d -m 700 /opt/workstel/backups
backup="/opt/workstel/backups/pre-private-vault-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker exec -u postgres workstel-db pg_dump --dbname=postgres --format=custom > "$backup"
test -s "$backup"
docker exec -i -u postgres workstel-db pg_restore --list < "$backup" > /dev/null
printf 'Restricted local backup created: %s\n' "$backup"
# Both reviewed changes commit atomically. Strip only their outer transaction wrappers.
{
  printf 'begin;\n'
  for migration in 202611010002_audit_visibility 202611010003_private_vault; do
    sed '/^begin;$/d; /^commit;$/d' "$release_dir/supabase/migrations/$migration.sql"
  done
  printf '\ncommit;\n'
} | docker exec -i -u postgres workstel-db psql -X --set=ON_ERROR_STOP=1 --dbname=postgres
printf 'Private Vault migration completed. Existing accounts belong to their original creators; sharing starts empty.\n'
printf 'Run verify_production.py next. Do not share the backup or server environment.\n'
