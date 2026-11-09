import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type Row = Record<string, unknown>;
type RpcResult = { data?: Row & Row[]; error?: string };

const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  sales = 'aaaaaaaa-1111-4111-8111-111111111111';
const users = {
  google: '11111111-1111-4111-8111-111111111111',
  admin: '22222222-2222-4222-8222-222222222222',
  password: '33333333-3333-4333-8333-333333333333',
  blank: '44444444-4444-4444-8444-444444444444',
  control: '55555555-5555-4555-8555-555555555555',
  long: '66666666-6666-4666-8666-666666666666',
  unnamed: '77777777-7777-4777-8777-777777777777',
};

test('new accounts are named at sign-up and Sales CRM shows the logger by name', async (t) => {
  const db = new PGlite();
  try {
    // auth.users carries the metadata columns GoTrue fills, so the sign-up trigger can read them.
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text unique,raw_app_meta_data jsonb not null default '{}',raw_user_meta_data jsonb not null default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;`,
    );
    for (const file of (await readdir('supabase/migrations')).sort())
      await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
    const addUser = (id: string, email: string, app: Row, meta: Row) =>
      db.query('insert into auth.users values ($1,$2,$3,$4)', [
        id,
        email,
        JSON.stringify(app),
        JSON.stringify(meta),
      ]);
    const nameOf = async (id: string) =>
      (
        await db.query<{ n: string | null }>(
          'select (select display_name from workstel_private.user_profiles where user_id=$1) as n',
          [id],
        )
      ).rows[0].n;

    await t.test('Google and developer-created accounts get a cleaned display name', async () => {
      await addUser(
        users.google,
        'rina@example.com',
        { provider: 'google' },
        { full_name: '  Rina   Wijaya ', name: 'Rina' },
      );
      await addUser(
        users.admin,
        'agus@example.com',
        { provider: 'email', workstel_admin_created: true },
        { full_name: 'Agus Santoso' },
      );
      await addUser(
        users.long,
        'long@example.com',
        { provider: 'google' },
        { name: 'x'.repeat(90) },
      );
      assert.equal(await nameOf(users.google), 'Rina Wijaya');
      assert.equal(await nameOf(users.admin), 'Agus Santoso');
      assert.equal(await nameOf(users.long), 'x'.repeat(80));
    });

    await t.test('other accounts and unusable names are created without a name', async () => {
      await addUser(
        users.password,
        'self@example.com',
        { provider: 'email' },
        { full_name: 'Self Named' },
      );
      await addUser(users.blank, 'blank@example.com', { provider: 'google' }, { full_name: '  ' });
      await addUser(
        users.control,
        'ctl@example.com',
        { provider: 'google' },
        { full_name: 'Bad\u0007Name' },
      );
      await addUser(users.unnamed, 'dewi.lestari@example.com', { provider: 'google' }, {});
      for (const id of [users.password, users.blank, users.control, users.unnamed])
        assert.equal(await nameOf(id), null);
      assert.equal(
        (await db.query('select 1 from auth.users')).rows.length,
        Object.keys(users).length,
      );
    });

    await t.test('clients cannot call the naming functions', async () => {
      for (const fn of [
        'workstel_private.signup_display_name(jsonb)',
        'workstel_private.name_new_user()',
      ])
        for (const role of ['anon', 'authenticated'])
          assert.equal(
            (
              await db.query<{ ok: boolean }>('select has_function_privilege($1,$2,$3) as ok', [
                role,
                fn,
                'execute',
              ])
            ).rows[0].ok,
            false,
          );
    });

    await t.test('the activity log names the logger, or falls back to the email', async () => {
      await db.query("insert into public.workstel_hotels values ($1,'Hotel')", [hotel]);
      await db.query(
        "insert into public.workstel_departments(id,hotel_id,code,name) values ($1,$2,'sales','Sales & Marketing')",
        [sales, hotel],
      );
      for (const user of [users.google, users.unnamed]) {
        await db.query(
          'insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read) values ($1,$2,$3,true)',
          [user, hotel, sales],
        );
        await db.query(
          "insert into workstel_private.module_access(user_id,hotel_id,department_id,module_id,can_read,can_write,can_manage) values ($1,$2,$3,'sales-crm',true,true,false)",
          [user, hotel, sales],
        );
      }
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
      await as(users.google);
      const saved = await rpc('sales_account_save', [
        hotel,
        sales,
        JSON.stringify({ name: 'PT Maju Jaya', type: 'corporate' }),
      ]);
      const accountId = saved.data!.id as string;
      const today = (
        await db.query<{ d: string }>(
          "select to_char((now() at time zone 'Asia/Jakarta')::date,'YYYY-MM-DD') as d",
        )
      ).rows[0].d;
      const log = (summary: string, key: string) =>
        rpc('sales_activity_log', [
          hotel,
          accountId,
          null,
          JSON.stringify({ type: 'call', occurredOn: today, summary }),
          key,
        ]);
      assert.equal((await log('By Rina', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc')).error, undefined);
      await as(users.unnamed);
      assert.equal((await log('By Dewi', 'dddddddd-dddd-4ddd-8ddd-dddddddddddd')).error, undefined);
      const list = (await rpc('sales_activities_list', [hotel, accountId])).data!;
      const byName = Object.fromEntries(list.map((a) => [a.summary, a.created_by_name]));
      assert.deepEqual(byName, { 'By Rina': 'Rina Wijaya', 'By Dewi': 'dewi.lestari' });
      // The profile's other fields never leave it.
      for (const row of list)
        for (const field of ['job_title', 'extension', 'locale']) assert.equal(field in row, false);
      await db.exec('reset role');
    });
  } finally {
    await db.close();
  }
});
