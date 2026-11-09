import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type Row = Record<string, unknown>;
type RpcResult = { data?: Row & Row[]; error?: string };

const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sales = 'aaaaaaaa-1111-4111-8111-111111111111',
  manager = '11111111-1111-4111-8111-111111111111';
let keyIndex = 0;
const nextKey = () => '00000000-0000-4000-8000-' + String(++keyIndex).padStart(12, '0');

test('activities carry visit outcomes, the report counts them, and rollback keeps a backup', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text unique,raw_app_meta_data jsonb not null default '{}',raw_user_meta_data jsonb not null default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;`,
    );
    for (const file of (await readdir('supabase/migrations')).sort())
      await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
    await db.query("insert into auth.users(id,email) values ($1,'manager@example.com')", [manager]);
    await db.query("insert into public.workstel_hotels values ($1,'Hotel')", [hotel]);
    await db.query(
      "insert into public.workstel_departments(id,hotel_id,code,name) values ($1,$2,'sales','Sales')",
      [sales, hotel],
    );
    await db.query(
      'insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read) values ($1,$2,$3,true)',
      [manager, hotel, sales],
    );
    await db.query(
      "insert into workstel_private.module_access(user_id,hotel_id,department_id,module_id,can_read,can_write,can_manage) values ($1,$2,$3,'sales-crm',true,true,true)",
      [manager, hotel, sales],
    );
    const as = async (user: string) => {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec('set role authenticated');
    };
    const rpc = async (name: string, args: unknown[]) =>
      (
        await db.query<{ r: RpcResult }>(
          'select public.' + name + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') as r',
          args,
        )
      ).rows[0].r;
    await as(manager);
    const accountId = (
      await rpc('sales_account_save', [
        hotel,
        sales,
        JSON.stringify({ name: 'PT Maju Jaya', type: 'corporate' }),
      ])
    ).data!.id as string;
    const today = (
      await db.query<{ d: string }>(
        "select to_char((now() at time zone 'Asia/Jakarta')::date,'YYYY-MM-DD') as d",
      )
    ).rows[0].d;
    const log = (extra: Row) =>
      rpc('sales_activity_log', [
        hotel,
        accountId,
        null,
        JSON.stringify({ type: 'visit', occurredOn: today, summary: 'Visit', ...extra }),
        nextKey(),
      ]);

    await t.test('face-to-face activities need a valid outcome', async () => {
      for (const extra of [
        {},
        { outcome: null },
        { outcome: '' },
        { outcome: 'negotiating' },
        { outcome: 5 },
        { outcome: 'booked', metWith: 'x'.repeat(101) },
        { outcome: 'booked', reference: 'Bad\u0007Ref' },
        { outcome: 'booked', extra: 1 },
      ])
        assert.equal((await log(extra)).error, 'INVALID_INPUT', JSON.stringify(extra));
      assert.equal((await log({ type: 'call', summary: 'Call' })).error, undefined);
      assert.equal(
        (
          await log({
            outcome: 'tentative',
            metWith: ' Budi (GM) ',
            reference: ' PRO-2026-11 ',
            summary: 'Site visit',
          })
        ).error,
        undefined,
      );
      assert.equal(
        (await log({ type: 'meeting', outcome: 'booked', summary: 'Contract' })).error,
        undefined,
      );
    });

    await t.test('the log and the report return the outcome fields', async () => {
      const list = (await rpc('sales_activities_list', [hotel, accountId])).data!;
      const visit = list.find((a) => a.summary === 'Site visit')!;
      assert.deepEqual(
        [visit.outcome, visit.met_with, visit.reference],
        ['tentative', 'Budi (GM)', 'PRO-2026-11'],
      );
      const call = list.find((a) => a.summary === 'Call')!;
      assert.deepEqual([call.outcome, call.met_with, call.reference], [null, '', '']);
      const report = await rpc('sales_entry_report', [hotel, null, null]);
      assert.deepEqual((report.data as unknown as Row).outcomes, {
        interested: 0,
        'need-proposal': 0,
        'proposal-sent': 0,
        tentative: 1,
        booked: 1,
        'no-response': 0,
        declined: 0,
      });
    });

    await t.test(
      'rollback backs up the values, drops the columns and restores logging',
      async () => {
        await db.exec('reset role');
        await db.exec(await readFile('infra/rollback-sales-visit-outcomes.sql', 'utf8'));
        const backup = (
          await db.query<Row>(
            'select outcome,met_with,reference from workstel_private.sales_activity_outcomes_backup order by outcome',
          )
        ).rows;
        assert.deepEqual(
          backup.map((b) => b.outcome),
          ['booked', 'tentative'],
        );
        const columns = (
          await db.query<{ n: number }>(
            "select count(*)::integer as n from information_schema.columns where table_schema='public' and table_name='sales_activities' and column_name in ('outcome','met_with','reference')",
          )
        ).rows[0].n;
        assert.equal(columns, 0);
        assert.equal(
          (
            await db.query<{ n: number }>(
              "select count(*)::integer as n from workstel_private.schema_migrations where version='202611090004'",
            )
          ).rows[0].n,
          0,
        );
        await as(manager);
        // The restored function logs without an outcome and refuses the new keys again.
        assert.equal((await log({ summary: 'After rollback' })).error, undefined);
        assert.equal((await log({ outcome: 'booked' })).error, 'INVALID_INPUT');
        const list = (await rpc('sales_activities_list', [hotel, accountId])).data!;
        assert.equal(list.length, 4);
        assert.equal('outcome' in list[0], false);
        const report = await rpc('sales_entry_report', [hotel, null, null]);
        assert.equal('outcomes' in (report.data as unknown as Row), false);
        await db.exec('reset role');
      },
    );
  } finally {
    await db.close();
  }
});
