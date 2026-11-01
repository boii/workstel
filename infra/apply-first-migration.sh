#!/usr/bin/env bash
# Run on the hotel server. Makes a local restricted backup before applying the first migration.
set -euo pipefail
umask 077
migration_file="${1:?Usage: bash apply-first-migration.sh /path/to/202611010001_vault_metadata.sql}"
if [[ ! -f "$migration_file" ]]; then
  printf 'ERROR: Migration file not found.\n' >&2
  exit 1
fi
existing="$(docker exec -u postgres workstel-db psql -X -At --dbname=postgres -c "select exists(select 1 from (values (to_regclass('public.workstel_hotels')),(to_regclass('public.workstel_departments')),(to_regclass('public.vault_accounts')),(to_regclass('workstel_private.staff_access')),(to_regclass('workstel_private.audit_events'))) as t(object_id) where object_id is not null);")"
if [[ "$existing" != f ]]; then
  printf 'STOP: Workstel tables already exist or schema inspection was inconclusive. Review migration history; do not reapply this initialization.\n' >&2
  exit 1
fi
install -d -m 700 /opt/workstel/backups
backup="/opt/workstel/backups/pre-workstel-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker exec -u postgres workstel-db pg_dump --dbname=postgres --format=custom > "$backup"
test -s "$backup"
docker exec -i -u postgres workstel-db pg_restore --list < "$backup" > /dev/null
printf 'Restricted local backup created: %s\n' "$backup"
docker exec -i -u postgres workstel-db psql -X --set=ON_ERROR_STOP=1 --dbname=postgres < "$migration_file"
docker exec -u postgres workstel-db psql -X --set=ON_ERROR_STOP=1 --dbname=postgres -c "notify pgrst, 'reload schema';"
printf 'Initial metadata migration completed. Staff access must still be provisioned. Do not share the database backup.\n'
