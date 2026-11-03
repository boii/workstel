#!/usr/bin/env bash
# Apply the reviewed operational module and department migrations to the existing hotel stack.
set -euo pipefail
umask 077
migrations_dir="${1:?Usage: bash apply-operations-modules.sh /path/to/supabase/migrations}"
files=(202611040001_module_access.sql 202611040002_vehicle_checklist.sql 202611040003_bin_card.sql 202611040004_accounting_department.sql 202611040005_hr_admin_departments.sql)
for file in "${files[@]}"; do
  [[ -f "$migrations_dir/$file" ]] || { printf 'ERROR: Missing migration %s.\n' "$file" >&2; exit 1; }
done
psql_query() { docker exec -u postgres workstel-db psql -X -At --dbname=postgres --set=ON_ERROR_STOP=1 -c "$1"; }
[[ "$(psql_query "select to_regclass('workstel_private.staff_access') is not null and to_regclass('workstel_private.schema_migrations') is not null;")" == t ]] \
  || { printf 'ERROR: The Workstel base schema and migration ledger are required first.\n' >&2; exit 1; }
if [[ "$(psql_query "select count(*) from workstel_private.schema_migrations where version in ('202611040001','202611040002','202611040003','202611040004','202611040005');")" == 5 ]]; then
  printf 'Operational modules are already installed. Nothing to do.\n'
  exit 0
fi
install -d -m 700 /opt/workstel/backups
backup="/opt/workstel/backups/pre-operations-modules-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker exec -u postgres workstel-db pg_dump --dbname=postgres --format=custom > "$backup"
test -s "$backup"
docker exec -i -u postgres workstel-db pg_restore --list < "$backup" > /dev/null
printf 'Restricted local backup created: %s\n' "$backup"
for file in "${files[@]}"; do
  version="${file%%_*}"
  if [[ "$(psql_query "select count(*) from workstel_private.schema_migrations where version='$version';")" == 1 ]]; then
    printf 'Skipping already applied %s.\n' "$file"
    continue
  fi
  docker exec -i -u postgres workstel-db psql -X --set=ON_ERROR_STOP=1 --dbname=postgres < "$migrations_dir/$file"
  printf 'Applied %s.\n' "$file"
done
printf 'Vehicle Checklist and Bin Card are installed. Grant access with infra/grant-module-access.sql.\n'
