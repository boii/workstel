#!/usr/bin/env bash
# Installs the Google sign-up hook (migrations 202611070002 and 202611070003) with a restricted
# local backup. It does not enable the hook, Google or public sign-up; see docs/SESSION_AUTH.md.
set -euo pipefail
umask 077
release_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
recorded() {
  docker exec -u postgres workstel-db psql -X -At --dbname=postgres --set=ON_ERROR_STOP=1 \
    -c "select exists(select 1 from workstel_private.schema_migrations where version='$1');"
}
if [[ "$(recorded 202611070003)" == t ]]; then printf 'Google sign-up hook is already installed.\n';exit 0;fi
install -d -m 700 /opt/workstel/backups
backup="/opt/workstel/backups/pre-google-signup-$(date -u +%Y%m%dT%H%M%SZ).dump"
docker exec -u postgres workstel-db pg_dump --dbname=postgres --format=custom > "$backup"
test -s "$backup"
docker exec -i -u postgres workstel-db pg_restore --list < "$backup" >/dev/null
for migration in 202611070002_signup_domains 202611070003_google_signup; do
  [[ "$(recorded "${migration%%_*}")" == t ]] && continue
  docker exec -i -u postgres workstel-db psql -X --set=ON_ERROR_STOP=1 --dbname=postgres \
    < "$release_dir/supabase/migrations/$migration.sql"
done
printf 'Google sign-up hook installed with restricted local backup. Sign-up is unchanged.\n'
