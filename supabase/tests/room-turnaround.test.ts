import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type Row = Record<string, unknown>;
type RpcResult = { data?: Row & Row[]; error?: string; meta?: Row };

test('Room Turnaround times each room cleaning per module grants', async (t) => {
  const db = new PGlite();
  const supervisor = '11111111-1111-4111-8111-111111111111',
    attendant = '22222222-2222-4222-8222-222222222222',
    second = '33333333-3333-4333-8333-333333333333',
    reader = '44444444-4444-4444-8444-444444444444',
    outsider = '55555555-5555-4555-8555-555555555555';
  const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
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
    for (const [index, user] of [supervisor, attendant, second, reader, outsider].entries())
      await db.query('insert into auth.users values ($1,$2)', [
        user,
        'user' + index + '@example.com',
      ]);
    await db.query("insert into public.workstel_hotels values ($1,'Hotel')", [hotel]);
    await db.query(
      "insert into public.workstel_departments(hotel_id,code,name) values ($1,'front-office','Front Office')",
      [hotel],
    );
    // 0011 creates the Housekeeping department for existing hotels; 0012 narrows the module.
    for (const migration of ['202611040011_housekeeping', '202611040012_housekeeping_timer'])
      await db.exec(await readFile('supabase/migrations/' + migration + '.sql', 'utf8'));
    const department = async (code: string) =>
      (
        await db.query<{ id: string }>(
          'select id from public.workstel_departments where hotel_id=$1 and code=$2',
          [hotel, code],
        )
      ).rows[0].id;
    const hk = await department('housekeeping');
    const frontOffice = await department('front-office');
    const grant = async (user: string, dept: string, write: boolean, manage: boolean) => {
      await db.query(
        'insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read) values ($1,$2,$3,true)',
        [user, hotel, dept],
      );
      await db.query(
        "insert into workstel_private.module_access(user_id,hotel_id,department_id,module_id,can_read,can_write,can_manage) values ($1,$2,$3,'housekeeping',true,$4,$5)",
        [user, hotel, dept, write, manage],
      );
    };
    await grant(supervisor, hk, true, true);
    await grant(attendant, hk, true, false);
    await grant(second, hk, true, false);
    await grant(reader, hk, false, false);
    await grant(outsider, frontOffice, true, true);
    // Grants made under the old module ID move with the 0013 rename.
    await db.exec(await readFile('supabase/migrations/202611040013_room_turnaround.sql', 'utf8'));
    // Profiles, then the attendant display names that read them.
    for (const migration of [
      '202611050002_user_profiles',
      '202611070001_room_turnaround_attendant_names',
    ])
      await db.exec(await readFile('supabase/migrations/' + migration + '.sql', 'utf8'));
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
    const room = async (number: string) =>
      (await rpc('room_turnaround_rooms_list', [hotel])).data!.find(
        (r) => r.room_number === number,
      )!;
    const backdate = async (
      taskId: string,
      startedMinutesAgo: number,
      pausedMinutesAgo?: number,
    ) => {
      await db.exec('reset role');
      await db.query(
        'update public.room_turnaround_tasks set started_at=clock_timestamp()-make_interval(mins=>$2::int), paused_at=case when $3::int is null then paused_at else clock_timestamp()-make_interval(mins=>$3::int) end where id=$1',
        [taskId, startedMinutesAgo, pausedMinutesAgo ?? null],
      );
    };

    await t.test('the module, grants and tables carry the new name', async () => {
      await db.exec('reset role');
      const ids = await db.query<{ id: string }>(
        "select distinct module_id as id from workstel_private.module_access union select module_id from workstel_private.installed_modules where module_id like '%turnaround%' or module_id='housekeeping'",
      );
      assert.deepEqual(
        ids.rows.map((row) => row.id),
        ['room-turnaround'],
      );
      const old = await db.query(
        "select 1 from pg_proc where proname like 'housekeeping_%' union all select 1 from information_schema.tables where table_name like 'housekeeping_%'",
      );
      assert.equal(old.rows.length, 0);
      assert.ok((await department('housekeeping')).length);
    });

    await t.test('the room status and inspection parts are gone', async () => {
      await db.exec('reset role');
      const leftovers = await db.query<{ name: string }>(
        "select proname as name from pg_proc where proname in ('housekeeping_inspect','housekeeping_room_set_status') union all select table_name from information_schema.tables where table_name='housekeeping_inspections' union all select column_name from information_schema.columns where table_name='room_turnaround_rooms' and column_name like 'status%'",
      );
      assert.deepEqual(leftovers.rows, []);
    });

    await t.test('supervisors manage the room list', async () => {
      await as(attendant);
      assert.equal(
        (
          await rpc('room_turnaround_rooms_import', [
            hotel,
            hk,
            JSON.stringify([{ roomNumber: '101' }]),
          ])
        ).error,
        'ACCESS_DENIED',
      );
      await as(supervisor);
      const imported = await rpc('room_turnaround_rooms_import', [
        hotel,
        hk,
        JSON.stringify([
          { roomNumber: '101', floor: '1', roomType: 'Deluxe' },
          { roomNumber: '102', floor: '1' },
          { roomNumber: '201', floor: '2' },
          { roomNumber: '101' },
        ]),
      ]);
      assert.deepEqual(imported.data, { added: 3, skipped: 1 });
      assert.equal(
        (await rpc('room_turnaround_room_save', [hotel, hk, JSON.stringify({ roomNumber: '102' })]))
          .error,
        'DUPLICATE_ROOM',
      );
      await as(reader);
      const list = await rpc('room_turnaround_rooms_list', [hotel]);
      assert.deepEqual(
        list.data!.map((r) => r.room_number),
        ['101', '102', '201'],
      );
      assert.equal(list.data![0].open_task, null);
      assert.equal(list.data![0].last_done, null);
      assert.ok(list.meta?.now);
    });

    await t.test('a cleaning is timed on the server, excluding pauses', async () => {
      await as(reader);
      assert.equal(
        (await rpc('room_turnaround_task_start', [hotel, (await room('101')).id, 'departure']))
          .error,
        'ACCESS_DENIED',
      );
      await as(attendant);
      assert.equal(
        (await rpc('room_turnaround_task_start', [hotel, (await room('101')).id, 'turndown']))
          .error,
        'INVALID_INPUT',
      );
      const started = await rpc('room_turnaround_task_start', [
        hotel,
        (await room('101')).id,
        'departure',
      ]);
      const taskId = String(started.data?.id);
      assert.equal(started.data?.mine, true);
      assert.equal(
        (await rpc('room_turnaround_task_start', [hotel, (await room('102')).id, 'make-up'])).error,
        'ATTENDANT_BUSY',
      );
      await as(second);
      assert.equal(
        (await rpc('room_turnaround_task_start', [hotel, (await room('101')).id, 'other'])).error,
        'ROOM_BUSY',
      );
      assert.equal(
        (await rpc('room_turnaround_task_update', [hotel, taskId, 'finish'])).error,
        'ACCESS_DENIED',
      );
      await as(attendant);
      assert.ok((await rpc('room_turnaround_task_update', [hotel, taskId, 'pause'])).data);
      assert.equal(
        (await rpc('room_turnaround_task_update', [hotel, taskId, 'pause'])).error,
        'TASK_CLOSED',
      );
      // 30 minutes since start, of which the last 10 were paused.
      await backdate(taskId, 30, 10);
      await as(attendant);
      assert.ok((await rpc('room_turnaround_task_update', [hotel, taskId, 'resume'])).data);
      const finished = await rpc('room_turnaround_task_update', [hotel, taskId, 'finish']);
      assert.equal(finished.data?.status, 'done');
      const seconds = Number(finished.data?.duration_seconds);
      assert.ok(seconds >= 1195 && seconds <= 1205, String(seconds));
      const after = await room('101');
      assert.equal(after.open_task, null);
      assert.equal((after.last_done as Row).task_type, 'departure');
      assert.equal((after.last_done as Row).duration_seconds, seconds);
    });

    await t.test('supervisors can close anyone’s task; cancel keeps no duration', async () => {
      await as(second);
      const task = await rpc('room_turnaround_task_start', [
        hotel,
        (await room('102')).id,
        'make-up',
      ]);
      await as(supervisor);
      const cancelled = await rpc('room_turnaround_task_update', [hotel, task.data?.id, 'cancel']);
      assert.equal(cancelled.data?.status, 'cancelled');
      assert.equal(cancelled.data?.duration_seconds, null);
      await as(second);
      const again = await rpc('room_turnaround_task_start', [
        hotel,
        (await room('102')).id,
        'make-up',
      ]);
      await backdate(String(again.data?.id), 15);
      await as(second);
      await rpc('room_turnaround_task_update', [hotel, again.data?.id, 'finish']);
    });

    await t.test('history per day and per room, and the daily summary', async () => {
      // Backdated starts straddle two Jakarta days when the suite runs just after midnight,
      // so move every task, keeping their spacing, to noon of a fixed hotel day.
      const today = '2026-01-15';
      await db.exec('reset role');
      await db.query(
        "with shift as (select ($1::date+time '12:00') at time zone 'Asia/Jakarta'-min(started_at) as by from public.room_turnaround_tasks where hotel_id=$2) update public.room_turnaround_tasks set started_at=started_at+shift.by,paused_at=paused_at+shift.by,finished_at=finished_at+shift.by from shift where hotel_id=$2",
        [today, hotel],
      );
      // The attendant sets a display name; the second attendant has no profile.
      await as(attendant);
      assert.ok(
        (
          await rpc('workstel_profile_save', [
            { displayName: 'Siti Rahma', jobTitle: 'Room attendant', extension: '+62 777' },
          ])
        ).data,
      );
      await as(reader);
      const history = await rpc('room_turnaround_tasks_list', [hotel, null, today]);
      const names = new Map(history.data!.map((row) => [row.attendant_email, row.attendant_name]));
      assert.equal(names.get('user1@example.com'), 'Siti Rahma');
      assert.equal(names.get('user2@example.com'), 'user2');
      // Only the display name leaves the profile.
      const shown = JSON.stringify(history);
      assert.ok(!shown.includes('Room attendant') && !shown.includes('+62 777'));
      assert.equal(history.data!.length, 3);
      assert.ok(history.data!.every((row) => typeof row.room_number === 'string'));
      const page = await rpc('room_turnaround_tasks_list', [hotel, null, today, null, null, 2]);
      const rest = await rpc('room_turnaround_tasks_list', [
        hotel,
        null,
        today,
        null,
        page.meta?.nextCursor,
        2,
      ]);
      assert.equal(page.data!.length + rest.data!.length, 3);
      const perRoom = await rpc('room_turnaround_tasks_list', [
        hotel,
        null,
        null,
        (await room('101')).id,
      ]);
      assert.equal(perRoom.data!.length, 1);
      assert.equal(
        (await rpc('room_turnaround_tasks_list', [hotel, null, '2000-01-01'])).data!.length,
        0,
      );
      const summary = (await rpc('room_turnaround_summary', [hotel, null, today])).data!;
      assert.deepEqual(summary.totals, {
        done: 2,
        rooms: 2,
        avg_seconds: (summary.totals as Row).avg_seconds,
      });
      const types = summary.task_types as Record<string, Row>;
      assert.equal(types.departure.done, 1);
      assert.equal(types['make-up'].done, 1);
      assert.ok(Number(types['make-up'].avg_seconds) >= 895);
      const people = summary.attendants as Row[];
      assert.deepEqual(
        people.map((p) => p.email),
        ['user1@example.com', 'user2@example.com'],
      );
      assert.deepEqual(
        people.map((p) => p.name),
        ['Siti Rahma', 'user2'],
      );
      // The helper stays private to the server.
      await assert.rejects(
        db.query('select workstel_private.staff_display_name($1)', [attendant]),
        /permission denied/,
      );
    });

    await t.test('other departments and switched-off modules see nothing', async () => {
      await as(outsider);
      assert.deepEqual((await rpc('room_turnaround_rooms_list', [hotel])).data, []);
      assert.equal((await rpc('room_turnaround_summary', [hotel, hk])).error, 'ACCESS_DENIED');
      await db.exec('reset role');
      await db.exec(
        "update workstel_private.installed_modules set enabled=false where module_id='room-turnaround'",
      );
      await as(reader);
      assert.equal((await rpc('room_turnaround_rooms_list', [hotel])).error, 'ACCESS_DENIED');
    });

    await t.test('tables stay closed to clients and changes are audited', async () => {
      await as(reader);
      await assert.rejects(
        db.query('select * from public.room_turnaround_tasks'),
        /permission denied/,
      );
      await db.exec('reset role');
      const actions = (
        await db.query<{ action: string }>(
          "select distinct action||':'||outcome as action from workstel_private.audit_events where action like 'room-turnaround.%'",
        )
      ).rows.map((row) => row.action);
      for (const expected of [
        'room-turnaround.room.import:success',
        'room-turnaround.task.start:success',
        'room-turnaround.task.pause:success',
        'room-turnaround.task.resume:success',
        'room-turnaround.task.done:success',
        'room-turnaround.task.cancel:success',
        'room-turnaround.write:denied',
        'room-turnaround.rooms.list:denied',
      ])
        assert.ok(actions.includes(expected), expected);
    });
  } finally {
    await db.close();
  }
});

test('the simplifying migration refuses to drop recorded inspections', async () => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text unique);create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;`,
    );
    for (const migration of [
      '202611010001_vault_metadata',
      '202611010002_audit_visibility',
      '202611040001_module_access',
      '202611040006_module_switch',
      '202611040009_documents',
      '202611040010_sales_crm',
      '202611040011_housekeeping',
    ])
      await db.exec(await readFile('supabase/migrations/' + migration + '.sql', 'utf8'));
    await db.exec(
      "insert into auth.users values ('11111111-1111-4111-8111-111111111111','a@example.com');insert into public.workstel_hotels values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Hotel');insert into public.workstel_departments(hotel_id,code,name) values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','housekeeping','Housekeeping');",
    );
    await db.exec(
      "insert into public.housekeeping_rooms(hotel_id,department_id,room_number,created_by,updated_by) select hotel_id,id,'101','11111111-1111-4111-8111-111111111111','11111111-1111-4111-8111-111111111111' from public.workstel_departments;insert into public.housekeeping_inspections(hotel_id,department_id,room_id,result,inspector_id) select hotel_id,department_id,id,'pass',created_by from public.housekeeping_rooms;",
    );
    await assert.rejects(
      db.exec(await readFile('supabase/migrations/202611040012_housekeeping_timer.sql', 'utf8')),
      /would remove/,
    );
  } finally {
    await db.close();
  }
});
