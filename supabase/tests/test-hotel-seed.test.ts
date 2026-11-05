import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type Row = Record<string, unknown>;
type RpcResult = { data?: Row[]; error?: string; meta?: Row };

const hotel = '7e570000-0000-4000-8000-000000000001';
const tester = '11111111-1111-4111-8111-111111111111';
const realStaff = '22222222-2222-4222-8222-222222222222';

/** psql substitutes :'email'; PGlite has no psql, so the test substitutes it the same way. */
async function script(name: string, email = '') {
  const sql = await readFile('infra/' + name, 'utf8');
  return sql.replace(":'email'", "'" + email.replace(/'/g, "''") + "'");
}

test('test hotel seed covers every module and is removed cleanly', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text unique);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;`,
    );
    for (const file of (await readdir('supabase/migrations')).sort())
      await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
    await db.query('insert into auth.users values ($1,$2),($3,$4)', [
      tester,
      'tester@example.com',
      realStaff,
      'staff@example.com',
    ]);
    // A real hotel with its own staff must stay untouched by seeding and removal.
    await db.query(
      "insert into public.workstel_hotels values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Real Hotel')",
    );
    await db.query(
      "insert into public.workstel_departments(hotel_id,code,name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','front-office','Front Office')",
    );
    await db.query(
      "insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read) select $1,hotel_id,id,true from public.workstel_departments where hotel_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'",
      [realStaff],
    );

    // psql with ON_ERROR_STOP ends the session after an error; PGlite keeps it, so roll back.
    const refused = async (email: string, message: RegExp) => {
      await assert.rejects(db.exec(await script('seed-test-hotel.sql', email)), message);
      await db.exec('rollback');
    };
    await refused('missing@example.com', /No account/);
    await refused('staff@example.com', /access to another hotel/);
    await db.exec(await script('seed-test-hotel.sql', 'Tester@Example.com'));
    await refused('tester@example.com', /already exists/);

    // Derived columns agree with their history.
    const bins = await db.query<{ code: string; balance: string; last: string | null }>(
      `select i.code,i.balance::text,(select e.balance_after::text from public.bin_card_entries e where e.item_id=i.id order by e.created_at desc,e.id desc limit 1) as last
       from public.bin_card_items i where i.hotel_id=$1`,
      [hotel],
    );
    for (const row of bins.rows) assert.equal(Number(row.balance), Number(row.last ?? 0), row.code);
    const vehicles = await db.query<{ ok: boolean }>(
      `select v.last_result is not distinct from (select i.result from public.vehicle_inspections i where i.vehicle_id=v.id order by i.inspected_at desc limit 1) as ok
       from public.vehicle_units v where v.hotel_id=$1`,
      [hotel],
    );
    assert.ok(vehicles.rows.every((row) => row.ok));

    // Every module RPC answers for the test account and shows the intended variety.
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [tester]);
    async function rpc(name: string, args: unknown[]): Promise<RpcResult> {
      const result = await db.query<{ r: RpcResult }>(
        'select public.' + name + '(' + args.map((_, i) => '$' + (i + 1)).join(',') + ') as r',
        args,
      );
      return result.rows[0].r;
    }
    const units = await rpc('vehicle_list_units', [hotel, null, 'all', '', null, 100]);
    assert.equal(units.error, undefined);
    assert.equal(units.data!.length, 7);
    assert.deepEqual(
      new Set(units.data!.map((u) => u.last_result ?? 'never')),
      new Set(['pass', 'attention', 'never']),
    );
    const items = await rpc('bin_card_list_items', [hotel, null, 'all', '', false, null, 100]);
    assert.equal(items.error, undefined);
    assert.equal(new Set(items.data!.map((i) => i.unit)).size, 11);
    const documents = await rpc('documents_list', [hotel, null, 'active', null, '', null, 50]);
    assert.equal(documents.error, undefined);
    assert.ok(documents.meta?.nextCursor, 'documents should page');
    const deals = await rpc('sales_deals_list', [hotel, null, 'all', null, 'any', '', null, 100]);
    assert.equal(deals.error, undefined);
    assert.deepEqual(
      new Set(deals.data!.map((d) => d.stage)),
      new Set(['lead', 'proposal', 'negotiation', 'won', 'lost']),
    );
    const rooms = await rpc('room_turnaround_rooms_list', [hotel, null, true]);
    assert.equal(rooms.error, undefined);
    assert.equal(rooms.data!.length, 14);
    const vault = await rpc('vault_list_accounts', [hotel, null, 'all', '', null, 50]);
    assert.equal(vault.error, undefined);
    assert.equal(vault.data!.length, 5);
    await db.query("select set_config('request.jwt.claim.sub','',false)");

    // Removal deletes the test hotel only and keeps the audit history.
    const auditBefore = (
      await db.query<{ n: number }>('select count(*)::int as n from workstel_private.audit_events')
    ).rows[0].n;
    await db.exec(await script('remove-test-hotel.sql'));
    for (const table of [
      'public.vehicle_inspections',
      'public.bin_card_entries',
      'public.sales_activities',
      'public.documents_links',
      'public.room_turnaround_tasks',
      'public.vault_accounts',
      'workstel_private.staff_access',
      'public.workstel_departments',
    ])
      assert.equal(
        (
          await db.query<{ n: number }>(
            `select count(*)::int as n from ${table} where hotel_id=$1`,
            [hotel],
          )
        ).rows[0].n,
        0,
        table,
      );
    assert.equal(
      (
        await db.query<{ n: number }>(
          'select count(*)::int as n from workstel_private.staff_access',
        )
      ).rows[0].n,
      1,
    );
    const auditAfter = (
      await db.query<{ n: number }>('select count(*)::int as n from workstel_private.audit_events')
    ).rows[0].n;
    assert.ok(
      auditAfter > auditBefore,
      'grant removals are audited and nothing is deleted from audit',
    );
    // Append-only guards are active again after removal.
    const guards = await db.query<{ tgname: string; tgenabled: string }>(
      "select tgname,tgenabled from pg_trigger where tgname in ('sales_activities_append_only','bin_card_entries_append_only','vehicle_inspections_append_only')",
    );
    assert.equal(guards.rows.length, 3);
    assert.ok(
      guards.rows.every((row) => row.tgenabled === 'O'),
      JSON.stringify(guards.rows),
    );
    // Running removal twice is harmless, and the hotel can be seeded again.
    await db.exec(await script('remove-test-hotel.sql'));
    await db.exec(await script('seed-test-hotel.sql', 'tester@example.com'));
  } finally {
    await db.close();
  }
});
