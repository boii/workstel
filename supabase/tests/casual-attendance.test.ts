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
  reader = '33333333-3333-4333-8333-333333333333',
  outsider = '44444444-4444-4444-8444-444444444444';

test('Casual Attendance records days per module grants with server times', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text unique,raw_app_meta_data jsonb not null default '{}',raw_user_meta_data jsonb not null default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;`,
    );
    for (const file of (await readdir('supabase/migrations')).sort())
      await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
    for (const [index, user] of [manager, supervisor, reader, outsider].entries())
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
    await grant(manager, frontOffice, true, true);
    await grant(supervisor, housekeeping, true, false);
    await grant(reader, housekeeping, false, false);
    await grant(outsider, frontOffice, true, true);

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
    const shift = async (days: number) =>
      (
        await db.query<{ d: string }>(
          "select to_char((now() at time zone 'Asia/Jakarta')::date + $1::integer,'YYYY-MM-DD') as d",
          [days],
        )
      ).rows[0].d;
    const today = await shift(0);
    const yesterday = await shift(-1);
    const person = (fields: Row = {}) =>
      JSON.stringify({
        name: 'Rina Kartika',
        type: 'casual',
        origin: 'PT Mitra Kerja',
        startDate: '2026-01-01',
        endDate: null,
        shift: 'morning',
        notes: '',
        ...fields,
      });

    let rinaId = '';
    await t.test('only managers add people, with validated input', async () => {
      await as(supervisor);
      assert.equal(
        (await rpc('casual_attendance_save_person', [hotel, housekeeping, person()])).error,
        'ACCESS_DENIED',
      );
      await as(manager);
      assert.equal(
        (
          await rpc('casual_attendance_save_person', [
            hotel,
            housekeeping,
            person({ startDate: '2026-02-30' }),
          ])
        ).error,
        'INVALID_INPUT',
      );
      assert.equal(
        (
          await rpc('casual_attendance_save_person', [
            hotel,
            housekeeping,
            person({ startDate: '2026-05-01', endDate: '2026-04-01' }),
          ])
        ).error,
        'INVALID_INPUT',
      );
      assert.equal(
        (await rpc('casual_attendance_save_person', [hotel, housekeeping, person({ type: 'x' })]))
          .error,
        'INVALID_INPUT',
      );
      const saved = await rpc('casual_attendance_save_person', [hotel, housekeeping, person()]);
      rinaId = saved.data!.id as string;
      assert.ok(rinaId);
      await rpc('casual_attendance_save_person', [
        hotel,
        housekeeping,
        person({ name: 'Old Trainee', type: 'trainee', endDate: '2026-02-01' }),
      ]);
    });

    await t.test('reading follows department grants and the period filter', async () => {
      await as(reader);
      const current = await rpc('casual_attendance_list_people', [
        hotel,
        null,
        null,
        'current',
        '',
        null,
        50,
      ]);
      assert.deepEqual(
        (current.data as Row[]).map((row) => row.name),
        ['Rina Kartika'],
      );
      const ended = await rpc('casual_attendance_list_people', [
        hotel,
        null,
        null,
        'ended',
        '',
        null,
        50,
      ]);
      assert.deepEqual(
        (ended.data as Row[]).map((row) => row.name),
        ['Old Trainee'],
      );
      await as(outsider);
      assert.equal(
        (
          await rpc('casual_attendance_list_people', [
            hotel,
            housekeeping,
            null,
            'all',
            '',
            null,
            50,
          ])
        ).error,
        'ACCESS_DENIED',
      );
      const own = await rpc('casual_attendance_list_people', [
        hotel,
        null,
        null,
        'all',
        '',
        null,
        50,
      ]);
      assert.equal((own.data as Row[]).length, 0, 'other departments stay hidden');
    });

    await t.test('check-in and check-out use the server clock with versions', async () => {
      await as(reader);
      assert.equal(
        (await rpc('casual_attendance_mark', [hotel, rinaId, today, 'check_in', null, ''])).error,
        'ACCESS_DENIED',
      );
      await as(supervisor);
      const checkedIn = await rpc('casual_attendance_mark', [
        hotel,
        rinaId,
        today,
        'check_in',
        null,
        '',
      ]);
      const record = checkedIn.data!;
      assert.equal(record.status, 'present');
      assert.ok(record.check_in);
      assert.equal(record.check_out, null);
      assert.equal(
        (await rpc('casual_attendance_mark', [hotel, rinaId, today, 'check_in', null, ''])).error,
        'VERSION_CONFLICT',
      );
      assert.equal(
        (await rpc('casual_attendance_mark', [hotel, rinaId, today, 'check_in', 1, ''])).error,
        'ALREADY_MARKED',
      );
      const out = await rpc('casual_attendance_mark', [hotel, rinaId, today, 'check_out', 1, '']);
      assert.ok(out.data!.check_out);
      assert.equal(
        (await rpc('casual_attendance_mark', [hotel, rinaId, today, 'reset', 2, ''])).error,
        'RECORD_CLOSED',
      );
      const reopened = await rpc('casual_attendance_mark', [hotel, rinaId, today, 'reopen', 2, '']);
      assert.equal(reopened.data!.check_out, null);
      const reset = await rpc('casual_attendance_mark', [hotel, rinaId, today, 'reset', 3, '']);
      assert.equal(reset.data, null);
      assert.equal(reset.error, undefined);
    });

    await t.test('days outside the open windows are refused', async () => {
      await as(supervisor);
      assert.equal(
        (
          await rpc('casual_attendance_mark', [
            hotel,
            rinaId,
            await shift(-3),
            'check_in',
            null,
            '',
          ])
        ).error,
        'DAY_CLOSED',
      );
      assert.equal(
        (await rpc('casual_attendance_mark', [hotel, rinaId, await shift(40), 'leave', null, '']))
          .error,
        'DAY_CLOSED',
      );
      assert.equal(
        (await rpc('casual_attendance_mark', [hotel, rinaId, '2025-12-31', 'absent', null, '']))
          .error,
        'NOT_SCHEDULED',
      );
      const leave = await rpc('casual_attendance_mark', [
        hotel,
        rinaId,
        await shift(2),
        'leave',
        null,
        ' Family matter ',
      ]);
      assert.equal(leave.data!.status, 'leave');
      assert.equal(leave.data!.note, 'Family matter');
    });

    await t.test('managers correct times with a kept history', async () => {
      await as(supervisor);
      assert.equal(
        (
          await rpc('casual_attendance_correct', [
            hotel,
            rinaId,
            yesterday,
            '07:10',
            '15:05',
            'Forgot',
            null,
          ])
        ).error,
        'ACCESS_DENIED',
      );
      await as(manager);
      assert.equal(
        (
          await rpc('casual_attendance_correct', [
            hotel,
            rinaId,
            yesterday,
            '7:10',
            null,
            'Forgot',
            null,
          ])
        ).error,
        'INVALID_INPUT',
      );
      assert.equal(
        (
          await rpc('casual_attendance_correct', [
            hotel,
            rinaId,
            yesterday,
            '07:10',
            '15:05',
            '  ',
            null,
          ])
        ).error,
        'INVALID_INPUT',
      );
      const corrected = await rpc('casual_attendance_correct', [
        hotel,
        rinaId,
        yesterday,
        '07:10',
        '15:05',
        'Forgot to check in',
        null,
      ]);
      assert.equal(corrected.data!.corrected, true);
      assert.equal(corrected.data!.status, 'present');
      await db.exec('reset role');
      const history = await db.query<{ n: number }>(
        'select count(*)::integer as n from public.casual_attendance_corrections where person_id=$1',
        [rinaId],
      );
      assert.equal(history.rows[0].n, 1);
      await assert.rejects(
        db.query('delete from public.casual_attendance_corrections where person_id=$1', [rinaId]),
        /append-only/,
      );
    });

    await t.test('the day list and recap count attendance per person', async () => {
      await as(reader);
      const day = await rpc('casual_attendance_day', [hotel, housekeeping, yesterday]);
      const rows = day.data as Row[];
      assert.deepEqual(
        rows.map((row) => row.name),
        ['Rina Kartika'],
        'ended people are not expected',
      );
      assert.equal((rows[0].record as Row).corrected, true);
      const recap = await rpc('casual_attendance_recap', [
        hotel,
        null,
        null,
        await shift(-10),
        await shift(5),
        'view',
      ]);
      const [rina] = recap.data as Row[];
      assert.equal(rina.present, 1);
      assert.equal(rina.late, 1, '07:10 is more than five minutes late');
      assert.equal(rina.leave, 1);
      assert.equal(rina.minutes, 475);
      assert.equal(
        (
          await rpc('casual_attendance_recap', [
            hotel,
            null,
            null,
            '2026-01-01',
            '2026-04-01',
            'view',
          ])
        ).error,
        'RANGE_TOO_LONG',
      );
      await rpc('casual_attendance_recap', [hotel, null, null, yesterday, today, 'export']);
      await db.exec('reset role');
      const actions = (
        await db.query<{ action: string }>(
          "select action from workstel_private.audit_events where action like 'casual-attendance.%' and outcome='success'",
        )
      ).rows.map((row) => row.action);
      for (const action of [
        'casual-attendance.person.save',
        'casual-attendance.attendance.check-in',
        'casual-attendance.attendance.check-out',
        'casual-attendance.attendance.correct',
        'casual-attendance.recap.export',
      ])
        assert.ok(actions.includes(action), action + ' is audited');
    });

    await t.test('people with attendance stay in their department', async () => {
      await as(manager);
      const list = await rpc('casual_attendance_list_people', [
        hotel,
        housekeeping,
        null,
        'current',
        'rina',
        null,
        50,
      ]);
      const version = (list.data as Row[])[0].version as number;
      assert.equal(
        (
          await rpc('casual_attendance_save_person', [
            hotel,
            frontOffice,
            person(),
            rinaId,
            version,
            'save',
          ])
        ).error,
        'DEPARTMENT_LOCKED',
      );
      assert.equal(
        (
          await rpc('casual_attendance_save_person', [
            hotel,
            housekeeping,
            null,
            rinaId,
            version + 5,
            'archive',
          ])
        ).error,
        'VERSION_CONFLICT',
      );
    });

    await t.test('switching the module off denies every call', async () => {
      await db.exec('reset role');
      await db.query(
        "update workstel_private.installed_modules set enabled=false where module_id='casual-attendance'",
      );
      await as(manager);
      assert.equal(
        (await rpc('casual_attendance_day', [hotel, housekeeping, today])).error,
        'ACCESS_DENIED',
      );
    });
  } finally {
    await db.close();
  }
});
