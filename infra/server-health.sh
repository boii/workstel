#!/usr/bin/env bash
# Read-only health snapshot of the hotel Supabase host for latency investigations. Run it on
# the server during a slow period and again during a normal period, then compare:
#   bash infra/server-health.sh > health-$(date +%Y%m%d-%H%M).txt
# It never prints secrets, environment files or query text; only the PostgREST pool settings,
# which hold no credentials, are read from container configuration.
set -euo pipefail

db_container="${1:-workstel-db}"
section() { printf '\n== %s ==\n' "$1"; }

section 'Host'
date -Iseconds
uptime
awk '/^(MemTotal|MemAvailable|SwapTotal|SwapFree):/ {print}' /proc/meminfo
if command -v vmstat >/dev/null 2>&1; then
  printf '\nvmstat 1 5 (watch "wa" for disk wait and "si/so" for swapping):\n'
  vmstat 1 5
fi
if [[ -r /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor ]]; then
  printf '\nCPU frequency governor: %s\n' "$(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor)"
fi

section 'Containers'
docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.MemPerc}}'
printf '\nRestarts and uptime:\n'
docker ps --format '{{.Names}}' | while read -r name; do
  docker inspect -f '{{.Name}}	restarts={{.RestartCount}}	started={{.State.StartedAt}}' "$name"
done

section 'PostgREST pool settings'
rest="$(docker ps --format '{{.Names}} {{.Image}}' | awk '$2 ~ /postgrest/ {print $1; exit}')"
if [[ -n "$rest" ]]; then
  docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' "$rest" \
    | grep -E '^PGRST_DB_POOL[A-Z_]*=' || printf 'No PGRST_DB_POOL* settings: PostgREST defaults apply.\n'
else
  printf 'No PostgREST container found.\n'
fi

section 'Database'
psql_query() { docker exec -u postgres "$db_container" psql -X -At --dbname=postgres -c "$1"; }
printf 'Connections by state:\n'
psql_query "select coalesce(state,'background') || ': ' || count(*) from pg_stat_activity group by 1 order by 1;"
printf '\nLongest running statements (duration and state only):\n'
psql_query "select now() - query_start as running, state, wait_event_type from pg_stat_activity where state <> 'idle' and query_start is not null order by 1 desc limit 5;"
printf '\nCache hit ratio (low after a restart or idle period means cold reads):\n'
psql_query "select round(100.0 * sum(blks_hit) / nullif(sum(blks_hit) + sum(blks_read), 0), 2) || '%' from pg_stat_database;"
printf '\nshared_buffers: %s\n' "$(psql_query 'show shared_buffers;')"
if [[ "$(psql_query "select count(*) from pg_extension where extname = 'pg_stat_statements';")" == 1 ]]; then
  printf '\nSlowest Workstel RPCs by mean time (normalised, no parameter values):\n'
  psql_query "select round(mean_exec_time::numeric, 1) || ' ms  calls=' || calls || '  ' || substring(query from 'public\.[a-z_]+') from pg_stat_statements where query ~ 'public\.(vehicle|bin_card|documents|sales|room_turnaround|vault|workstel)_' order by mean_exec_time desc limit 10;"
else
  printf '\npg_stat_statements is not installed; per-query timings are unavailable.\n'
fi
