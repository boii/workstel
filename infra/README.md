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

## Test hotel with dummy data

`seed-test-hotel.sql` creates a separate **Workstel Test Hotel** (fixed ID `7e570000-0000-4000-8000-000000000001`) with dummy records for every implemented module. `remove-test-hotel.sql` deletes it again. Use it to review UI and UX states against the real server without touching hotel records.

1. On the Users page, create a dedicated test account, for example `ui.test@<hotel domain>`. Give it no department access. The app opens the first hotel in a user's access list and has no hotel switcher, so the test account must not belong to a real hotel. The seed refuses an account that already has access to another hotel.
2. Seed the hotel and grant the test account access to it:
   `docker exec -i -u postgres workstel-db psql -X --set=ON_ERROR_STOP=1 --dbname=postgres -v email=ui.test@hotel.example < seed-test-hotel.sql`
3. Sign in as the test account.
4. To reset, run `remove-test-hotel.sql` and then seed again. To remove everything, run `remove-test-hotel.sql` only.

What the seed covers:

| Module            | Variants                                                                                                                                                                                                                                                                                                                   |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Access            | Full rights in Front Office, Sales, IT and Housekeeping. Edit without archive or manage in Engineering. Read-only in Accounting. No access to Human Resource or Admin and General.                                                                                                                                         |
| Vehicle Checklist | Pass, needs attention and never inspected; archived; 100-character name and 20-character plate; empty odometer; every fuel level and long notes; a second department (Engineering) with write-only access.                                                                                                                 |
| Bin Card          | All 11 units; low stock, zero stock and minimum 0; decimals (kg, l, m); receipt, issue and adjustment entries; item with no entries; archived item; long code, name and location; a 65-entry ledger for "Load more"; read-only Housekeeping items.                                                                         |
| Documents & SOPs  | Every category; archived; long title, URL and description; empty description; read-only Sales documents; 55 active links so the list pages.                                                                                                                                                                                |
| Sales CRM         | Every account type; with and without contact details; archived account; long name and notes. Every deal stage, including won this month and earlier, lost with reason, value 0 and 1.25 billion IDR, no dates, and follow-ups overdue, today, within 7 days, later and none. Every activity type, with and without a deal. |
| Room Turnaround   | Floors 1, 2 and 10, plus villas without a floor; empty room type; archived room; one running timer; finished cleanings from 3 minutes to 2 h 15 min with and without pauses; a cancelled task; history over several days.                                                                                                  |
| Password Vault    | Metadata only, with no secret values: active and archived accounts, an empty website, long notes, and an IT account shared with Front Office.                                                                                                                                                                              |

Seeding and removal write the access changes to the audit log (`staff.access.*`, `staff.module-access.*`). Audit events are append-only, so the test hotel's audit history remains after removal. During removal, the append-only guards on vehicle inspections, Bin Card entries and sales activities are disabled for that transaction only. `supabase/tests/test-hotel-seed.test.ts` runs both scripts against all migrations.

## Latency investigation

See [SERVER_LATENCY.md](SERVER_LATENCY.md). `latency-probe.sh` times the same requests through Cloudflare, directly on the server and against the database. `server-health.sh` takes a read-only snapshot of the host, containers, PostgREST pool and database. Both scripts are read-only and never print secrets.
