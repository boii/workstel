import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type Row = Record<string, unknown>;
type RpcResult = { data?: Row & Row[]; error?: string; meta?: Row };

const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  housekeeping = 'aaaaaaaa-1111-4111-8111-111111111111',
  frontOffice = 'aaaaaaaa-2222-4222-8222-222222222222',
  manager = '11111111-1111-4111-8111-111111111111',
  supervisor = '22222222-2222-4222-8222-222222222222',
  worker = '55555555-5555-4555-8555-555555555555',
  stranger = '66666666-6666-4666-8666-666666666666',
  otherManager = '77777777-7777-4777-8777-777777777777';

test('Casual Attendance self check-in links accounts and follows department settings', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text unique,raw_app_meta_data jsonb not null default '{}',raw_user_meta_data jsonb not null default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;`,
    );
    for (const file of (await readdir('supabase/migrations')).sort())
      await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
    for (const [index, user] of [manager, supervisor, worker, stranger, otherManager].entries())
      await db.query('insert into auth.users(id,email) values ($1,$2)', [
        user,
        'user' + index + '@example.com',
      ]);
    await db.query("insert into public.workstel_hotels values ($1,'Hotel')", [hotel]);
    for (const [id, code, name] of [
      [housekeeping, 'housekeeping', 'Housekeeping'],
      [frontOffice, 'front-office', 'Front Office'],
    ])
      await db.query(
        'insert into public.workstel_departments(id,hotel_id,code,name) values ($1,$2,$3,$4)',
        [id, hotel, code, name],
      );
    const grant = async (user: string, dept: string, write: boolean, manage: boolean) => {
      await db.query(
        'insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read) values ($1,$2,$3,true) on conflict do nothing',
        [user, hotel, dept],
      );
      await db.query(
        "insert into workstel_private.module_access(user_id,hotel_id,department_id,module_id,can_read,can_write,can_manage) values ($1,$2,$3,'casual-attendance',true,$4,$5)",
        [user, hotel, dept, write, manage],
      );
    };
    await grant(manager, housekeeping, true, true);
    await grant(supervisor, housekeeping, true, false);
    await grant(otherManager, frontOffice, true, true);

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
    const audit = async (action: string, outcome: string) => {
      await db.exec('reset role');
      const rows = await db.query(
        'select 1 from workstel_private.audit_events where action=$1 and outcome=$2',
        [action, outcome],
      );
      return rows.rows.length;
    };

    await as(manager);
    const saved = await rpc('casual_attendance_save_person', [
      hotel,
      housekeeping,
      JSON.stringify({
        name: 'Rina Kartika',
        type: 'casual',
        origin: '',
        startDate: '2026-01-01',
        endDate: null,
        // Morning shift keeps the work date on today at any hour.
        shift: 'morning',
        notes: '',
      }),
    ]);
    const rina = saved.data!.id as string;
    let code = '';

    await t.test('only a manager of the department creates a link code', async () => {
      await as(supervisor);
      assert.equal(
        (await rpc('casual_attendance_person_link', [hotel, rina, 'code'])).error,
        'ACCESS_DENIED',
      );
      await as(otherManager);
      assert.equal(
        (await rpc('casual_attendance_person_link', [hotel, rina, 'code'])).error,
        'ACCESS_DENIED',
      );
      await as(manager);
      const first = await rpc('casual_attendance_person_link', [hotel, rina, 'code']);
      const second = await rpc('casual_attendance_person_link', [hotel, rina, 'code']);
      code = second.data!.code as string;
      assert.match(code, /^[A-HJKMNP-Z2-9]{6}$/);
      assert.ok(Date.parse(second.data!.expires_at as string) > Date.now());
      // A new code replaces the unused one, and only its hash is stored.
      await db.exec('reset role');
      const stored = await db.query<{ n: number; plain: number }>(
        "select count(*)::int as n,count(*) filter (where position($1 in encode(code_hash,'escape'))>0)::int as plain from public.casual_attendance_link_codes",
        [code],
      );
      assert.equal(stored.rows[0].n, 1);
      assert.equal(stored.rows[0].plain, 0);
      if (first.data!.code !== code) {
        await as(worker);
        assert.equal(
          (await rpc('casual_attendance_redeem_link_code', [first.data!.code])).error,
          'CODE_INVALID',
        );
      }
      assert.equal(await audit('casual-attendance.person.link-code', 'denied'), 2);
    });

    await t.test('an unlinked account sees linked=false and cannot check in', async () => {
      await as(worker);
      const status = await rpc('casual_attendance_self_status', []);
      assert.equal(status.data!.linked, false);
      assert.equal(
        (await rpc('casual_attendance_self_mark', ['check_in', null])).error,
        'NOT_LINKED',
      );
    });

    await t.test('wrong codes are limited to five in fifteen minutes', async () => {
      await as(stranger);
      for (let i = 0; i < 5; i += 1)
        assert.equal(
          (await rpc('casual_attendance_redeem_link_code', ['ZZZZZZ'])).error,
          'CODE_INVALID',
        );
      // Even the right code is refused while the limit applies.
      assert.equal(
        (await rpc('casual_attendance_redeem_link_code', [code])).error,
        'TOO_MANY_ATTEMPTS',
      );
    });

    await t.test('the right code links once and cannot be reused', async () => {
      await as(worker);
      const linked = await rpc('casual_attendance_redeem_link_code', [
        code.toLowerCase().slice(0, 3) + '-' + code.slice(3),
      ]);
      assert.equal(linked.data!.linked, true);
      assert.equal((linked.data!.person as Row).name, 'Rina Kartika');
      assert.equal(linked.data!.self_enabled, false);
      await as(supervisor);
      assert.equal((await rpc('casual_attendance_redeem_link_code', [code])).error, 'CODE_INVALID');
      await as(manager);
      assert.equal(
        (await rpc('casual_attendance_person_link', [hotel, rina, 'code'])).error,
        'ALREADY_LINKED',
      );
      const people = await rpc('casual_attendance_list_people', [
        hotel,
        housekeeping,
        null,
        'current',
        '',
        null,
        50,
      ]);
      assert.equal(people.data![0].linked, true);
      // The link grants no staff access or module grant.
      await as(worker);
      assert.equal(
        (await rpc('casual_attendance_day', [hotel, housekeeping, linked.data!.work_date])).error,
        'ACCESS_DENIED',
      );
    });

    await t.test('self check-in stays off until the department switches it on', async () => {
      await as(worker);
      assert.equal(
        (await rpc('casual_attendance_self_mark', ['check_in', null])).error,
        'SELF_DISABLED',
      );
      await as(supervisor);
      assert.equal(
        (
          await rpc('casual_attendance_save_settings', [
            hotel,
            housekeeping,
            JSON.stringify({ selfEnabled: true, confirmation: 'always' }),
            0,
          ])
        ).error,
        'ACCESS_DENIED',
      );
      await as(manager);
      assert.equal(
        (
          await rpc('casual_attendance_save_settings', [
            hotel,
            housekeeping,
            JSON.stringify({ selfEnabled: true, confirmation: 'sometimes' }),
            0,
          ])
        ).error,
        'INVALID_INPUT',
      );
      assert.equal(
        (
          await rpc('casual_attendance_save_settings', [
            hotel,
            housekeeping,
            JSON.stringify({ selfEnabled: true, confirmation: 'always' }),
            0,
          ])
        ).data!.version,
        1,
      );
      assert.equal(
        (
          await rpc('casual_attendance_save_settings', [
            hotel,
            housekeeping,
            JSON.stringify({ selfEnabled: true, confirmation: 'always' }),
            0,
          ])
        ).error,
        'VERSION_CONFLICT',
      );
      const settings = await rpc('casual_attendance_settings', [hotel, null]);
      assert.deepEqual(
        settings.data!.map((row) => [row.department_name, row.self_enabled, row.confirmation]),
        [['Housekeeping', true, 'always']],
      );
    });

    let recordId = '';
    let workDate = '';
    await t.test('check-in and check-out use the server clock and need review', async () => {
      await as(worker);
      const checkedIn = await rpc('casual_attendance_self_mark', ['check_in', null]);
      assert.equal(checkedIn.data!.source, 'self');
      assert.equal(checkedIn.data!.verification, 'needs_review');
      recordId = checkedIn.data!.id as string;
      workDate = checkedIn.data!.work_date as string;
      assert.equal(
        (await rpc('casual_attendance_self_mark', ['check_in', null])).error,
        'ALREADY_MARKED',
      );
      assert.equal(
        (await rpc('casual_attendance_self_mark', ['check_in', '{"lat":1}'])).error,
        'INVALID_INPUT',
      );
      const checkedOut = await rpc('casual_attendance_self_mark', ['check_out', null]);
      assert.ok(checkedOut.data!.check_out);
      assert.equal(
        (await rpc('casual_attendance_self_mark', ['check_out', null])).error,
        'NOT_CHECKED_IN',
      );
      const status = await rpc('casual_attendance_self_status', []);
      assert.equal((status.data!.history as Row[]).length, 1);
      await db.exec('reset role');
      const events = await db.query('select result from public.casual_attendance_self_events');
      assert.equal(events.rows.length, 2);
      await assert.rejects(db.exec('delete from public.casual_attendance_self_events'));
      assert.equal(await audit('casual-attendance.attendance.self-check-in', 'success'), 1);
    });

    await t.test('supervisors approve or reject, and the recap follows', async () => {
      await as(supervisor);
      const day = await rpc('casual_attendance_day', [hotel, housekeeping, workDate]);
      const record = day.data![0].record as Row;
      assert.equal(record.verification, 'needs_review');
      const rejected = await rpc('casual_attendance_mark', [
        hotel,
        rina,
        workDate,
        'reject',
        record.version,
        'Not on site',
      ]);
      assert.equal(rejected.data!.verification, 'rejected');
      assert.equal(rejected.data!.review_note, 'Not on site');
      assert.equal(
        (
          await rpc('casual_attendance_mark', [
            hotel,
            rina,
            workDate,
            'reject',
            rejected.data!.version,
            '',
          ])
        ).error,
        'NOT_REVIEWABLE',
      );
      const recap = await rpc('casual_attendance_recap', [
        hotel,
        housekeeping,
        null,
        workDate,
        workDate,
        'view',
      ]);
      assert.equal(recap.data![0].present, 0);
      assert.equal(recap.data![0].rejected, 1);
      assert.equal(recap.data![0].minutes, 0);
      const approved = await rpc('casual_attendance_mark', [
        hotel,
        rina,
        workDate,
        'approve',
        rejected.data!.version,
        '',
      ]);
      assert.equal(approved.data!.verification, 'verified');
      assert.equal(approved.data!.id, recordId);
      const after = await rpc('casual_attendance_recap', [
        hotel,
        housekeeping,
        null,
        workDate,
        workDate,
        'view',
      ]);
      assert.equal(after.data![0].present, 1);
      assert.equal(after.data![0].needs_review, 0);
    });

    await t.test('unlinking ends self check-in', async () => {
      await as(manager);
      assert.equal(
        (await rpc('casual_attendance_person_link', [hotel, rina, 'unlink'])).data,
        null,
      );
      assert.equal(
        (await rpc('casual_attendance_person_link', [hotel, rina, 'unlink'])).error,
        'NOT_LINKED',
      );
      await as(worker);
      assert.equal((await rpc('casual_attendance_self_status', [])).data!.linked, false);
      assert.equal(
        (await rpc('casual_attendance_self_mark', ['check_out', null])).error,
        'NOT_LINKED',
      );
      assert.equal(await audit('casual-attendance.person.unlink', 'success'), 1);
    });

    await t.test('switching the module off denies self calls', async () => {
      await db.exec('reset role');
      await db.query(
        "update workstel_private.installed_modules set enabled=false where module_id='casual-attendance'",
      );
      await as(worker);
      assert.equal((await rpc('casual_attendance_self_status', [])).error, 'ACCESS_DENIED');
      assert.equal(
        (await rpc('casual_attendance_redeem_link_code', ['ABCDEF'])).error,
        'ACCESS_DENIED',
      );
    });
  } finally {
    await db.close();
  }
});
