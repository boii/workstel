#!/usr/bin/env bash
# Apply only the reviewed additive audit migration to the existing hotel stack.
set -euo pipefail
umask 077
migration_file="${1:?Usage: bash apply-audit-migration.sh /path/to/202611010002_audit_visibility.sql}"
[[ -f "$migration_file" && "$(basename "$migration_file")" == 202611010002_audit_visibility.sql ]] || { printf 'ERROR: Expected audit migration file.\n' >&2; exit 1; }
exists="$(docker exec -u postgres workstel-db psql -X -At --dbname=postgres --set=ON_ERROR_STOP=1 -c "select to_regclass('workstel_private.staff_access') is not null;")"
[[ "$exists" == t ]] || { printf 'ERROR: Initial Workstel schema is missing.\n' >&2; exit 1; }
install -d -m 700 /opt/workstel/backups
backup="/opt/workstel/backups/pre-audit-release-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker exec -u postgres workstel-db pg_dump --dbname=postgres --format=custom > "$backup"
test -s "$backup"
docker exec -i -u postgres workstel-db pg_restore --list < "$backup" > /dev/null
printf 'Restricted local backup created: %s\n' "$backup"
docker exec -i -u postgres workstel-db psql -X --set=ON_ERROR_STOP=1 --dbname=postgres < "$migration_file"
printf 'Audit visibility migration completed. Existing accounts and records were preserved.\n'
