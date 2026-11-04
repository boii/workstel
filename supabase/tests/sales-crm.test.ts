import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type Row = Record<string, unknown>;
type RpcResult = { data?: Row & Row[]; error?: string; meta?: Row };

test('Sales CRM accounts, deals and activities follow module grants per department', async (t) => {
  const db = new PGlite();
  const manager = '11111111-1111-4111-8111-111111111111',
    writer = '22222222-2222-4222-8222-222222222222',
    reader = '33333333-3333-4333-8333-333333333333',
    outsider = '44444444-4444-4444-8444-444444444444';
  const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    sales = 'aaaaaaaa-1111-4111-8111-111111111111',
    frontOffice = 'aaaaaaaa-2222-4222-8222-222222222222';
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text unique);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;`,
    );
    for (const migration of [
      '202611010001_vault_metadata',
      '202611010002_audit_visibility',
      '202611040001_module_access',
      '202611040006_module_switch',
      '202611040009_documents',
      '202611040010_sales_crm',
    ])
      await db.exec(await readFile('supabase/migrations/' + migration + '.sql', 'utf8'));
    for (const [index, user] of [manager, writer, reader, outsider].entries())
      await db.query('insert into auth.users values ($1,$2)', [
        user,
        'user' + index + '@example.com',
      ]);
    await db.query("insert into public.workstel_hotels values ($1,'Hotel')", [hotel]);
    await db.query(
      "insert into public.workstel_departments(id,hotel_id,code,name) values ($1,$3,'sales','Sales & Marketing'),($2,$3,'front-office','Front Office')",
      [sales, frontOffice, hotel],
    );
    const grant = async (user: string, department: string, write: boolean, manage: boolean) => {
      await db.query(
        'insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read) values ($1,$2,$3,true)',
        [user, hotel, department],
      );
      await db.query(
        "insert into workstel_private.module_access(user_id,hotel_id,department_id,module_id,can_read,can_write,can_manage) values ($1,$2,$3,'sales-crm',true,$4,$5)",
        [user, hotel, department, write, manage],
      );
    };
    await grant(manager, sales, true, true);
    await grant(writer, sales, true, false);
    await grant(reader, sales, false, false);
    await grant(outsider, frontOffice, true, true);
    async function as(user: string) {
      await db.exec('reset role');
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
      await db.exec('set role authenticated');
    }
    async function rpc(name: string, args: unknown[] = []): Promise<RpcResult> {
      const result = await db.query<{ r: RpcResult }>(
        'select public.' + name + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') as r',
        args,
      );
      return result.rows[0].r;
    }
    const today = (
      await db.query<{ d: string }>(
        "select to_char((now() at time zone 'Asia/Jakarta')::date,'YYYY-MM-DD') as d",
      )
    ).rows[0].d;
    const shift = (days: number) =>
      new Date(Date.parse(today + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
    const account = (extra: Row = {}) =>
      JSON.stringify({
        name: 'PT Maju Jaya',
        type: 'corporate',
        contactName: 'Budi',
        contactPhone: '+62 812-3456',
        contactEmail: ' Budi@Example.com ',
        ...extra,
      });
    const deal = (accountId: string, extra: Row = {}) =>
      JSON.stringify({
        accountId,
        title: 'Annual meeting',
        segment: 'mice',
        stage: 'lead',
        value: 85000000,
        roomNights: 120,
        arrivalDate: shift(30),
        departureDate: shift(32),
        nextFollowUp: shift(-1),
        ...extra,
      });
    let accountId = '';
    let dealId = '';

    await t.test('writers add accounts; readers only read', async () => {
      await as(reader);
      assert.equal(
        (await rpc('sales_account_save', [hotel, sales, account()])).error,
        'ACCESS_DENIED',
      );
      await as(writer);
      for (const [extra, code] of [
        [{ contactEmail: 'not-an-email' }, 'INVALID_EMAIL'],
        [{ contactPhone: 'call me' }, 'INVALID_PHONE'],
        [{ type: 'friend' }, 'INVALID_INPUT'],
        [{ name: ' ' }, 'INVALID_INPUT'],
      ] as const)
        assert.equal((await rpc('sales_account_save', [hotel, sales, account(extra)])).error, code);
      accountId = String((await rpc('sales_account_save', [hotel, sales, account()])).data?.id);
      await as(reader);
      const [row] = (await rpc('sales_accounts_list', [hotel])).data!;
      assert.equal(row.name, 'PT Maju Jaya');
      assert.equal(row.contact_email, 'budi@example.com');
      assert.equal(row.department_name, 'Sales & Marketing');
      assert.equal(row.open_deals, 0);
    });

    await t.test('deals validate dates, values and the lost reason', async () => {
      await as(writer);
      for (const [extra, code] of [
        [{ departureDate: shift(10) }, 'INVALID_INPUT'],
        [{ arrivalDate: null }, 'INVALID_INPUT'],
        [{ value: 10.5 }, 'INVALID_INPUT'],
        [{ value: -1 }, 'INVALID_INPUT'],
        [{ roomNights: 0 }, 'INVALID_INPUT'],
        [{ nextFollowUp: '2026-02-30' }, 'INVALID_INPUT'],
        [{ stage: 'lost' }, 'LOST_REASON_REQUIRED'],
        [{ secret: 'x' }, 'INVALID_INPUT'],
      ] as const)
        assert.equal(
          (await rpc('sales_deal_save', [hotel, deal(accountId, extra)])).error,
          code,
          JSON.stringify(extra),
        );
      dealId = String((await rpc('sales_deal_save', [hotel, deal(accountId)])).data?.id);
      await rpc('sales_deal_save', [
        hotel,
        deal(accountId, {
          title: 'Wedding',
          segment: 'wedding',
          value: 40000000,
          nextFollowUp: shift(3),
        }),
      ]);
      await rpc('sales_deal_save', [
        hotel,
        deal(accountId, { title: 'Later', value: 1000000, nextFollowUp: null }),
      ]);
      await as(reader);
      const deals = (await rpc('sales_deals_list', [hotel])).data!;
      assert.deepEqual(
        deals.map((d) => d.title),
        ['Annual meeting', 'Wedding', 'Later'],
      );
      assert.equal(deals[0].account_name, 'PT Maju Jaya');
      assert.equal(deals[0].value_amount, 85000000);
      assert.equal(
        (await rpc('sales_deals_list', [hotel, null, 'open', null, 'overdue'])).data!.length,
        1,
      );
      assert.equal(
        (await rpc('sales_deals_list', [hotel, null, 'open', null, 'week'])).data!.length,
        1,
      );
      const paged = await rpc('sales_deals_list', [hotel, null, 'open', null, 'any', '', null, 2]);
      assert.equal(paged.data!.length, 2);
      const rest = await rpc('sales_deals_list', [
        hotel,
        null,
        'open',
        null,
        'any',
        '',
        paged.meta?.nextCursor,
        2,
      ]);
      assert.deepEqual(
        rest.data!.map((d) => d.title),
        ['Later'],
      );
      const summary = (await rpc('sales_summary', [hotel])).data!;
      assert.equal(summary.open_count, 3);
      assert.equal(summary.open_value, 126000000);
      assert.equal(summary.overdue, 1);
      assert.equal(summary.due_week, 1);
      assert.equal((summary.stages as Row & { lead: Row }).lead.count, 3);
    });

    await t.test(
      'closing a deal records closed_at, clears follow-up and counts as won',
      async () => {
        await as(writer);
        assert.equal(
          (await rpc('sales_deal_save', [hotel, deal(accountId, { stage: 'won' }), dealId, 9]))
            .error,
          'VERSION_CONFLICT',
        );
        assert.ok(
          (await rpc('sales_deal_save', [hotel, deal(accountId, { stage: 'won' }), dealId, 1]))
            .data,
        );
        await as(reader);
        const [won] = (await rpc('sales_deals_list', [hotel, null, 'won'])).data!;
        assert.equal(won.next_follow_up, null);
        assert.ok(won.closed_at);
        const summary = (await rpc('sales_summary', [hotel])).data!;
        assert.equal(summary.open_count, 2);
        assert.equal(summary.won_month_count, 1);
        assert.equal(summary.won_month_value, 85000000);
        await as(writer);
        assert.ok(
          (
            await rpc('sales_deal_save', [
              hotel,
              deal(accountId, { stage: 'negotiation' }),
              dealId,
              2,
            ])
          ).data,
        );
        await as(reader);
        const [reopened] = (await rpc('sales_deals_list', [hotel, null, 'negotiation'])).data!;
        assert.equal(reopened.closed_at, null);
      },
    );

    await t.test(
      'activities are logged once, newest first, and can move the follow-up',
      async () => {
        const key = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
        const activity = (extra: Row = {}) =>
          JSON.stringify({
            type: 'call',
            occurredOn: today,
            summary: ' Sent revised rate ',
            ...extra,
          });
        await as(reader);
        assert.equal(
          (await rpc('sales_activity_log', [hotel, accountId, null, activity(), key])).error,
          'ACCESS_DENIED',
        );
        await as(writer);
        assert.equal(
          (
            await rpc('sales_activity_log', [
              hotel,
              accountId,
              null,
              activity({ occurredOn: shift(1) }),
              key,
            ])
          ).error,
          'INVALID_INPUT',
        );
        assert.equal(
          (
            await rpc('sales_activity_log', [
              hotel,
              accountId,
              null,
              activity({ nextFollowUp: shift(5) }),
              key,
            ])
          ).error,
          'INVALID_INPUT',
        );
        const first = await rpc('sales_activity_log', [
          hotel,
          accountId,
          dealId,
          activity({ nextFollowUp: shift(5) }),
          key,
        ]);
        assert.equal(first.data?.replayed, false);
        const again = await rpc('sales_activity_log', [
          hotel,
          accountId,
          dealId,
          activity({ nextFollowUp: shift(5) }),
          key,
        ]);
        assert.equal(again.data?.replayed, true);
        assert.equal(again.data?.id, first.data?.id);
        await rpc('sales_activity_log', [
          hotel,
          accountId,
          null,
          activity({ type: 'visit', occurredOn: shift(-3), summary: 'Office visit' }),
          'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        ]);
        await as(reader);
        const list = (await rpc('sales_activities_list', [hotel, accountId])).data!;
        assert.deepEqual(
          list.map((a) => a.summary),
          ['Sent revised rate', 'Office visit'],
        );
        assert.equal(list[0].deal_title, 'Annual meeting');
        assert.equal(list[0].created_by_email, 'user1@example.com');
        assert.equal(
          (await rpc('sales_activities_list', [hotel, accountId, dealId])).data!.length,
          1,
        );
        const [moved] = (await rpc('sales_deals_list', [hotel, null, 'negotiation'])).data!;
        assert.equal(moved.next_follow_up, shift(5));
        assert.equal(moved.version, 4);
        await db.exec('reset role');
        await assert.rejects(
          db.exec("update public.sales_activities set summary='x'"),
          /append-only/,
        );
      },
    );

    await t.test(
      'archiving an account needs manage and blocks new deals and activities',
      async () => {
        await as(writer);
        assert.equal(
          (await rpc('sales_account_save', [hotel, sales, null, accountId, 1, 'archive'])).error,
          'ACCESS_DENIED',
        );
        await as(manager);
        assert.ok(
          (await rpc('sales_account_save', [hotel, sales, null, accountId, 1, 'archive'])).data,
        );
        assert.equal(
          (await rpc('sales_account_save', [hotel, frontOffice, account(), accountId, 2])).error,
          'ACCESS_DENIED',
        );
        assert.equal(
          (await rpc('sales_deal_save', [hotel, deal(accountId)])).error,
          'ACCOUNT_ARCHIVED',
        );
        assert.equal(
          (
            await rpc('sales_activity_log', [
              hotel,
              accountId,
              null,
              JSON.stringify({ type: 'note', occurredOn: today, summary: 'x' }),
              'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
            ])
          ).error,
          'ACCOUNT_ARCHIVED',
        );
        await as(reader);
        assert.deepEqual((await rpc('sales_accounts_list', [hotel])).data, []);
        assert.deepEqual((await rpc('sales_deals_list', [hotel])).data, []);
        assert.equal(
          (await rpc('sales_deals_list', [hotel, null, 'all', accountId])).data!.length,
          3,
        );
        assert.equal((await rpc('sales_summary', [hotel])).data!.open_count, 0);
      },
    );

    await t.test('other departments and switched-off modules see nothing', async () => {
      await as(outsider);
      assert.deepEqual((await rpc('sales_accounts_list', [hotel, null, 'all'])).data, []);
      assert.deepEqual((await rpc('sales_deals_list', [hotel, null, 'all'])).data, []);
      assert.equal((await rpc('sales_activities_list', [hotel, accountId])).error, 'ACCESS_DENIED');
      assert.equal(
        (await rpc('sales_deal_save', [hotel, deal(accountId), dealId, 4])).error,
        'ACCESS_DENIED',
      );
      assert.equal((await rpc('sales_summary', [hotel, sales])).error, 'ACCESS_DENIED');
      await db.exec('reset role');
      await db.exec(
        "update workstel_private.installed_modules set enabled=false where module_id='sales-crm'",
      );
      await as(reader);
      assert.equal((await rpc('sales_accounts_list', [hotel])).error, 'ACCESS_DENIED');
      assert.equal((await rpc('sales_summary', [hotel])).error, 'ACCESS_DENIED');
    });

    await t.test('tables stay closed to clients and changes are audited', async () => {
      await as(reader);
      await assert.rejects(db.query('select * from public.sales_deals'), /permission denied/);
      await db.exec('reset role');
      const actions = (
        await db.query<{ action: string }>(
          "select distinct action||':'||outcome as action from workstel_private.audit_events where action like 'sales-crm.%'",
        )
      ).rows.map((row) => row.action);
      for (const expected of [
        'sales-crm.account.save:success',
        'sales-crm.account.archive:success',
        'sales-crm.deal.save:success',
        'sales-crm.deal.won:success',
        'sales-crm.activity.log:success',
        'sales-crm.write:denied',
        'sales-crm.accounts.list:denied',
        'sales-crm.summary:success',
      ])
        assert.ok(actions.includes(expected), expected);
    });
  } finally {
    await db.close();
  }
});
