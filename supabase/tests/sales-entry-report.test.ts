import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type Row = Record<string, unknown>;
type Report = {
  totals: Row;
  people: Row[];
  entries: Row[];
};
type RpcResult = { data?: Report; error?: string; meta?: Row };

const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sales = 'aaaaaaaa-1111-4111-8111-111111111111',
  events = 'aaaaaaaa-2222-4222-8222-222222222222';
const manager = '11111111-1111-4111-8111-111111111111',
  rina = '22222222-2222-4222-8222-222222222222',
  agus = '33333333-3333-4333-8333-333333333333',
  salesAccount = 'bbbbbbbb-1111-4111-8111-111111111111',
  eventsAccount = 'bbbbbbbb-2222-4222-8222-222222222222';

test('the entry report counts timing per person for managers only', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text unique,raw_app_meta_data jsonb not null default '{}',raw_user_meta_data jsonb not null default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;`,
    );
    for (const file of (await readdir('supabase/migrations')).sort())
      await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
    await db.query(
      `insert into auth.users(id,email,raw_app_meta_data,raw_user_meta_data) values
       ($1,'manager@example.com','{}','{}'),
       ($2,'rina@example.com','{"provider":"google"}','{"full_name":"Rina Wijaya"}'),
       ($3,'agus.santoso@example.com','{}','{}')`,
      [manager, rina, agus],
    );
    await db.query("insert into public.workstel_hotels values ($1,'Hotel')", [hotel]);
    await db.query(
      "insert into public.workstel_departments(id,hotel_id,code,name) values ($1,$3,'sales','Sales'),($2,$3,'front-office','Events')",
      [sales, events, hotel],
    );
    const grant = async (user: string, department: string, manage: boolean) => {
      await db.query(
        'insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read) values ($1,$2,$3,true)',
        [user, hotel, department],
      );
      await db.query(
        "insert into workstel_private.module_access(user_id,hotel_id,department_id,module_id,can_read,can_write,can_manage) values ($1,$2,$3,'sales-crm',true,true,$4)",
        [user, hotel, department, manage],
      );
    };
    await grant(manager, sales, true);
    await grant(rina, sales, false);
    await grant(agus, sales, false);
    await grant(agus, events, true);
    await db.query(
      `insert into public.sales_accounts(id,hotel_id,department_id,name,account_type,created_by,updated_by) values
       ($1,$3,$4,'PT Maju Jaya','corporate',$6,$6),($2,$3,$5,'Wedding Co','wedding',$6,$6)`,
      [salesAccount, eventsAccount, hotel, sales, events, manager],
    );
    // Activities in October 2026 (hotel time), written straight to the table with fixed times.
    const activity = (
      user: string,
      account: string,
      department: string,
      occurred: string,
      recorded: string,
    ) =>
      db.query(
        `insert into public.sales_activities(hotel_id,department_id,account_id,activity_type,occurred_on,summary,created_at,created_by,idempotency_key)
         values ($1,$2,$3,'visit',$4,'x',($5::timestamp at time zone 'Asia/Jakarta'),$6,gen_random_uuid())`,
        [hotel, department, account, occurred, recorded, user],
      );
    await activity(rina, salesAccount, sales, '2026-10-05', '2026-10-05 16:00'); // on time
    await activity(rina, salesAccount, sales, '2026-10-05', '2026-10-07 09:00'); // late, 2 days
    await activity(agus, salesAccount, sales, '2026-10-01', '2026-10-09 10:00'); // backdated, 8
    await activity(agus, salesAccount, sales, '2026-09-28', '2026-10-01 00:30'); // backdated, 3
    await activity(agus, salesAccount, sales, '2026-10-30', '2026-11-01 08:00'); // November
    await activity(agus, eventsAccount, events, '2026-10-02', '2026-10-02 10:00'); // events
    await activity(rina, salesAccount, sales, '2026-09-30', '2026-09-30 23:30'); // September

    const as = async (user: string) => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec('set role authenticated');
    };
    const report = async (department: string | null, month: string | null = '2026-10-15') =>
      (
        await db.query<{ r: RpcResult }>('select public.sales_entry_report($1,$2,$3) as r', [
          hotel,
          department,
          month,
        ])
      ).rows[0].r;

    await t.test('a manager sees totals, people and late entries for the month', async () => {
      await as(manager);
      const result = await report(null);
      assert.equal(result.error, undefined);
      assert.equal(result.meta?.month, '2026-10');
      assert.equal(result.meta?.entriesTotal, 3);
      assert.deepEqual(result.data!.totals, { total: 4, on_time: 1, late: 1, backdated: 2 });
      assert.deepEqual(
        result.data!.people.map((p) => [p.name, p.email, p.total, p.on_time, p.late, p.backdated]),
        [
          ['agus.santoso', 'agus.santoso@example.com', 2, 0, 0, 2],
          ['Rina Wijaya', 'rina@example.com', 2, 1, 1, 0],
        ],
      );
      assert.deepEqual(
        result.data!.entries.map((e) => [
          e.entry_delay_days,
          e.entry_timing,
          e.recorded_on,
          e.account_name,
        ]),
        [
          [8, 'backdated', '2026-10-09', 'PT Maju Jaya'],
          [3, 'backdated', '2026-10-01', 'PT Maju Jaya'],
          [2, 'late', '2026-10-07', 'PT Maju Jaya'],
        ],
      );
      // Activity text never leaves through the report.
      assert.equal('summary' in result.data!.entries[0], false);
    });

    await t.test('the report covers only departments the caller manages', async () => {
      await as(agus);
      const own = await report(null);
      assert.deepEqual(own.data!.totals, { total: 1, on_time: 1, late: 0, backdated: 0 });
      assert.equal((await report(sales)).error, 'ACCESS_DENIED');
      await as(rina);
      assert.equal((await report(null)).error, 'ACCESS_DENIED');
      await as(manager);
      assert.equal((await report(events)).error, 'ACCESS_DENIED');
    });

    await t.test('future months are refused and every read is audited', async () => {
      await as(manager);
      assert.equal((await report(null, '2099-01-01')).error, 'INVALID_INPUT');
      const current = await report(null, null);
      assert.equal(current.error, undefined);
      await db.exec('reset role');
      const audit = (
        await db.query<{ outcome: string; n: number }>(
          "select outcome,count(*)::integer as n from workstel_private.audit_events where action='sales-crm.entry-report' group by outcome order by outcome",
        )
      ).rows;
      assert.deepEqual(
        audit.map((a) => [a.outcome, a.n]),
        [
          ['denied', 3],
          ['success', 3],
        ],
      );
    });

    await t.test('the rollback script removes the function and its ledger row', async () => {
      await db.exec('reset role');
      await db.exec(await readFile('infra/rollback-sales-entry-report.sql', 'utf8'));
      const left = (
        await db.query<{ f: boolean; v: number }>(
          "select to_regprocedure('public.sales_entry_report(uuid,uuid,date)') is not null as f,(select count(*)::integer from workstel_private.schema_migrations where version='202611090003') as v",
        )
      ).rows[0];
      assert.deepEqual(left, { f: false, v: 0 });
      assert.equal(
        (await db.query('select 1 from public.sales_activities')).rows.length,
        7,
        'activities are untouched',
      );
    });
  } finally {
    await db.close();
  }
});
