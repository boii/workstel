# Server latency investigation

On 5 November 2026, authenticated RPCs to `workstel.gabot.my.id` took 0.9–4.3 s in the afternoon and 60–200 ms that evening. DNS, TLS and the Cloudflare edge (CGK) took about 60 ms, and the CORS preflight is cached for an hour. The slowness is therefore intermittent and happens behind the edge. This runbook places it, then lists the matching fixes. Every step is read-only unless it is marked as a change.

## 1. Measure over time

On the hotel server, run the probe for at least six hours, including a quiet period such as the night or lunchtime:

```bash
SUPABASE_ANON_KEY=<publishable key from .env.production.local> \
  bash infra/latency-probe.sh --host workstel.gabot.my.id --local http://127.0.0.1:8000 \
  --rounds 72 --interval 300 | tee latency-$(date +%Y%m%d-%H%M).tsv
```

Each round times three paths:

| Path         | What it covers                                                                                                                               |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `cloudflare` | Browser route: Cloudflare edge, tunnel or proxy, Kong, then GoTrue or PostgREST.                                                             |
| `local`      | The same requests sent straight to Kong on the server, skipping Cloudflare.                                                                  |
| `database`   | `select 1` through `docker exec`. The number includes about 50–150 ms of `docker exec` overhead, so watch for jumps, not the absolute value. |

The `rpc-db` check sends an anonymous RPC. Postgres refuses it with a permission error (status 401), which still uses a pooled database connection without reading any records.

## 2. Snapshot the host

Take one snapshot during a slow period and one during a normal period, then compare them:

```bash
bash infra/server-health.sh > health-$(date +%Y%m%d-%H%M).txt
```

The snapshot covers host load, memory and swap, disk wait (`vmstat`), the CPU governor, container CPU, memory and restart counts, the PostgREST pool settings, database connections, the cache hit ratio and, if `pg_stat_statements` is installed, the slowest Workstel RPCs.

## 3. Read the results

| Pattern                                               | Likely cause                                                                  | Go to       |
| ----------------------------------------------------- | ----------------------------------------------------------------------------- | ----------- |
| `cloudflare` slow, `local` fast                       | Cloudflare tunnel or proxy, or the hotel uplink                               | 4a          |
| `cloudflare` and `local` both slow, `database` fast   | Kong or the PostgREST connection pool, often cold connections after idle time | 4b          |
| All three slow at the same time                       | Host resources: CPU, memory, swap or disk                                     | 4c          |
| Only the first round after a quiet period is slow     | Cold connections or cold cache                                                | 4b, then 4d |
| `rpc-db` slow and `auth-health` fast on the same path | Database side, not the gateway                                                | 4b, 4c      |
| One RPC slow in `pg_stat_statements`                  | The query itself                                                              | 4e          |

## 4. Fixes

### a. Edge or tunnel

- If `cloudflared` is used, check its version and logs for reconnects (`docker logs <cloudflared> --since 6h | grep -i -E "reconnect|error"`), and try the `http2` protocol instead of QUIC if the network drops UDP.
- Check the uplink: run `ping -c 20 1.1.1.1` and `mtr` from the server during a slow period.

### b. Gateway and connection pool (change)

- PostgREST closes idle pool connections; reconnecting costs an extra TLS handshake and authentication. Raise `PGRST_DB_POOL_MAX_IDLETIME`, for example to `600`, and keep `PGRST_DB_POOL` at or above `10`. Recreate only the `rest` service.
- Keep the pool warm: a cron job every 5 minutes on the server that runs the anonymous `rpc-db` request against `http://127.0.0.1:8000` takes no data and keeps one connection active.

### c. Host resources (change)

- Swap activity (`si`/`so` above 0) or `MemAvailable` below about 15% means the host needs more memory or fewer co-located services.
- Disk wait (`wa`) above about 10% means slow storage. On spinning disks, check that drive spin-down is disabled (`hdparm -C /dev/sdX`).
- A CPU governor of `powersave` on a low-power host can add latency after idle time. Consider `schedutil` or `performance`.
- Restart counts that keep rising point to crashes. Check `docker logs` for the restarting container.

### d. Cold database cache

- A cache hit ratio well below 99% after quiet periods means data is read from disk. Check that `shared_buffers` is about 25% of RAM within the container memory limit.

### e. A slow query

- Install `pg_stat_statements` (requires a database restart) and look at the slowest Workstel RPCs. Then run `EXPLAIN (ANALYZE, BUFFERS)` on that query in a maintenance window and add the missing index through a reviewed migration.

## 5. Measuring from the browser

Kong does not send `Timing-Allow-Origin`, so browsers only report total request time. Adding `Timing-Allow-Origin: https://workstel.pages.dev` to Kong's response headers (a change) would let the frontend separate network wait from server time in later checks. The header only exposes timings to that origin.
