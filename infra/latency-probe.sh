#!/usr/bin/env bash
# Read-only latency probe for the hotel Supabase stack. It times the same requests through
# Cloudflare and directly on the server, plus a direct database query, so a slow period can be
# placed at the edge or tunnel, the API gateway or pool, or the database host.
#
# Run on the hotel server, ideally for a few hours that include an idle period:
#   SUPABASE_ANON_KEY=<public publishable key> bash infra/latency-probe.sh \
#     --host workstel.gabot.my.id --local http://127.0.0.1:8000 --rounds 72 --interval 300 \
#     | tee latency-$(date +%Y%m%d-%H%M).tsv
# The anon key is the public key already shipped in the web bundle. It is read from the
# environment and never printed. No data is written and no user session is used.
set -euo pipefail

host=''
local_url=''
rounds=12
interval=300
db_container='workstel-db'

usage() {
  printf 'Usage: SUPABASE_ANON_KEY=... %s --host HOST [--local URL] [--rounds N] [--interval SECONDS] [--db CONTAINER]\n' "$0" >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --host) host="${2:-}"; shift 2 ;;
    --local) local_url="${2:-}"; shift 2 ;;
    --rounds) rounds="${2:-}"; shift 2 ;;
    --interval) interval="${2:-}"; shift 2 ;;
    --db) db_container="${2:-}"; shift 2 ;;
    *) usage ;;
  esac
done
[[ -n "$host" && -n "${SUPABASE_ANON_KEY:-}" ]] || usage
[[ "$rounds" =~ ^[0-9]+$ && "$interval" =~ ^[0-9]+$ ]] || usage

# Prints time to first byte in milliseconds and the HTTP status for one request.
probe() {
  local method="$1" url="$2" result
  local args=(-s -o /dev/null --max-time 20 -X "$method"
    -H "apikey: ${SUPABASE_ANON_KEY}" -H 'Content-Type: application/json'
    -w '%{time_starttransfer} %{http_code}')
  if [[ $# -ge 3 ]]; then args+=(-d "$3"); fi
  # A timeout or connection error still prints the -w line, with status 000.
  result="$(curl "${args[@]}" "$url" || true)"
  [[ -n "$result" ]] || result='20 000'
  # A failed request (status 000) has no meaningful time.
  awk '{ if ($2 == "000") printf "-\t%s", $2; else printf "%d\t%s", $1 * 1000, $2 }' <<<"$result"
}

# An anonymous RPC call is refused by Postgres permissions, so it still takes a pooled
# database connection without reading any records.
rpc_body='{}'
printf 'time\tpath\tcheck\tms\tstatus\n'
for ((round = 1; round <= rounds; round++)); do
  now="$(date -Iseconds)"
  printf '%s\tcloudflare\tauth-health\t%s\n' "$now" "$(probe GET "https://$host/auth/v1/health")"
  printf '%s\tcloudflare\trpc-db\t%s\n' "$now" "$(probe POST "https://$host/rest/v1/rpc/workstel_session" "$rpc_body")"
  if [[ -n "$local_url" ]]; then
    printf '%s\tlocal\tauth-health\t%s\n' "$now" "$(probe GET "$local_url/auth/v1/health")"
    printf '%s\tlocal\trpc-db\t%s\n' "$now" "$(probe POST "$local_url/rest/v1/rpc/workstel_session" "$rpc_body")"
  fi
  if command -v docker >/dev/null 2>&1 && docker inspect "$db_container" >/dev/null 2>&1; then
    start="$(date +%s%N)"
    if docker exec -u postgres "$db_container" psql -X -At --dbname=postgres -c 'select 1' >/dev/null 2>&1; then
      printf '%s\tdatabase\tselect-1\t%d\tok\n' "$now" $((($(date +%s%N) - start) / 1000000))
    else
      printf '%s\tdatabase\tselect-1\t-\tfailed\n' "$now"
    fi
  fi
  if ((round < rounds)); then sleep "$interval"; fi
done
