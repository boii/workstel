import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type Row = Record<string, unknown>;
type RpcResult = { data?: Row & Row[]; error?: string; meta?: Row };

test('Housekeeping rooms, timed tasks and inspections follow module grants', async (t) => {
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
    // The migration creates the Housekeeping department for existing hotels.
    await db.exec(await readFile('supabase/migrations/202611040011_housekeeping.sql', 'utf8'));
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
    const rooms = async () => (await rpc('housekeeping_rooms_list', [hotel])).data!;
    const room = async (number: string) => (await rooms()).find((r) => r.room_number === number)!;
    const backdate = async (
      taskId: string,
      startedMinutesAgo: number,
      pausedMinutesAgo?: number,
    ) => {
      await db.exec('reset role');
      await db.query(
        'update public.housekeeping_tasks set started_at=clock_timestamp()-make_interval(mins=>$2::int), paused_at=case when $3::int is null then paused_at else clock_timestamp()-make_interval(mins=>$3::int) end where id=$1',
        [taskId, startedMinutesAgo, pausedMinutesAgo ?? null],
      );
    };

    await t.test('the department exists and supervisors manage the room master', async () => {
      assert.ok(hk);
      await as(attendant);
      assert.equal(
        (await rpc('housekeeping_room_save', [hotel, hk, JSON.stringify({ roomNumber: '101' })]))
          .error,
        'ACCESS_DENIED',
      );
      await as(supervisor);
      assert.equal(
        (await rpc('housekeeping_room_save', [hotel, hk, JSON.stringify({ roomNumber: '10 1' })]))
          .error,
        'INVALID_INPUT',
      );
      assert.ok(
        (
          await rpc('housekeeping_room_save', [
            hotel,
            hk,
            JSON.stringify({ roomNumber: '101', floor: '1', roomType: 'Deluxe' }),
          ])
        ).data,
      );
      assert.equal(
        (await rpc('housekeeping_room_save', [hotel, hk, JSON.stringify({ roomNumber: '101' })]))
          .error,
        'DUPLICATE_ROOM',
      );
      const imported = await rpc('housekeeping_rooms_import', [
        hotel,
        hk,
        JSON.stringify([
          { roomNumber: '101' },
          { roomNumber: '102', floor: '1' },
          { roomNumber: '201', floor: '2', roomType: 'Suite' },
          { roomNumber: 'g01', floor: 'G' },
        ]),
      ]);
      assert.deepEqual(imported.data, { added: 3, skipped: 1 });
      await as(reader);
      const list = await rooms();
      assert.deepEqual(
        list.map((r) => r.room_number),
        ['101', '102', '201', 'G01'],
      );
      assert.equal(list[0].status, 'vacant-dirty');
      assert.equal(list[0].department_name, 'Housekeeping');
    });

    await t.test('a departure clean is timed on the server, excluding pauses', async () => {
      await as(attendant);
      assert.equal(
        (await rpc('housekeeping_task_start', [hotel, (await room('101')).id, 'make-up'])).error,
        'WRONG_ROOM_STATUS',
      );
      const started = await rpc('housekeeping_task_start', [
        hotel,
        (await room('101')).id,
        'departure',
      ]);
      const taskId = String(started.data?.id);
      assert.equal(started.data?.mine, true);
      assert.equal(
        (await rpc('housekeeping_task_start', [hotel, (await room('102')).id, 'departure'])).error,
        'ATTENDANT_BUSY',
      );
      await as(second);
      assert.equal(
        (await rpc('housekeeping_task_start', [hotel, (await room('101')).id, 'deep-clean'])).error,
        'ROOM_BUSY',
      );
      assert.equal(
        (await rpc('housekeeping_task_update', [hotel, taskId, 'finish'])).error,
        'ACCESS_DENIED',
      );
      await as(attendant);
      assert.ok((await rpc('housekeeping_task_update', [hotel, taskId, 'pause'])).data);
      assert.equal(
        (await rpc('housekeeping_task_update', [hotel, taskId, 'pause'])).error,
        'TASK_CLOSED',
      );
      // 30 minutes since start, of which the last 10 were paused.
      await backdate(taskId, 30, 10);
      await as(attendant);
      assert.ok((await rpc('housekeeping_task_update', [hotel, taskId, 'resume'])).data);
      const finished = await rpc('housekeeping_task_update', [
        hotel,
        taskId,
        'finish',
        'done',
        'Towels restocked',
      ]);
      assert.equal(finished.data?.status, 'done');
      const seconds = Number(finished.data?.duration_seconds);
      assert.ok(seconds >= 1195 && seconds <= 1205, String(seconds));
      assert.equal(finished.data?.notes, 'Towels restocked');
      const after = await room('101');
      assert.equal(after.status, 'vacant-clean');
      assert.equal(after.open_task, null);
      assert.ok(after.last_cleaned_at);
    });

    await t.test('supervisors inspect: redo sends the room back, pass makes it ready', async () => {
      await as(attendant);
      const target = await room('101');
      assert.equal(
        (await rpc('housekeeping_inspect', [hotel, target.id, 'pass', target.version])).error,
        'ACCESS_DENIED',
      );
      await as(supervisor);
      assert.equal(
        (await rpc('housekeeping_inspect', [hotel, target.id, 'redo', target.version, ' '])).error,
        'NOTE_REQUIRED',
      );
      const redo = await rpc('housekeeping_inspect', [
        hotel,
        target.id,
        'redo',
        target.version,
        'Dust under bed',
      ]);
      assert.equal(redo.data?.status, 'vacant-dirty');
      await as(attendant);
      const again = await rpc('housekeeping_task_start', [hotel, target.id, 'departure']);
      await rpc('housekeeping_task_update', [hotel, again.data?.id, 'finish']);
      await as(supervisor);
      const clean = await room('101');
      assert.equal(
        (await rpc('housekeeping_inspect', [hotel, clean.id, 'pass', clean.version - 1])).error,
        'VERSION_CONFLICT',
      );
      assert.equal(
        (await rpc('housekeeping_inspect', [hotel, clean.id, 'pass', clean.version])).data?.status,
        'vacant-ready',
      );
    });

    await t.test('room status changes, make-up room, DND and out of order', async () => {
      await as(attendant);
      let target = await room('101');
      assert.equal(
        (
          await rpc('housekeeping_room_set_status', [
            hotel,
            target.id,
            'vacant-ready',
            target.version,
          ])
        ).error,
        'ACCESS_DENIED',
      );
      assert.equal(
        (await rpc('housekeeping_room_set_status', [hotel, target.id, 'occupied', target.version]))
          .data?.status,
        'occupied',
      );
      target = await room('101');
      const makeUp = await rpc('housekeeping_task_start', [hotel, target.id, 'make-up']);
      assert.equal(
        (
          await rpc('housekeeping_room_set_status', [
            hotel,
            target.id,
            'vacant-dirty',
            target.version,
          ])
        ).error,
        'TASK_OPEN',
      );
      assert.equal(
        (await rpc('housekeeping_task_update', [hotel, makeUp.data?.id, 'finish', 'refused'])).data
          ?.status,
        'refused',
      );
      assert.equal((await room('101')).status, 'occupied');
      const dnd = await rpc('housekeeping_task_start', [
        hotel,
        target.id,
        'make-up',
        'dnd',
        'DND sign at 10:00',
      ]);
      assert.equal(dnd.data?.status, 'dnd');
      assert.equal(dnd.data?.duration_seconds, 0);
      assert.equal(
        (await rpc('housekeeping_task_start', [hotel, (await room('102')).id, 'departure', 'dnd']))
          .error,
        'INVALID_INPUT',
      );
      const other = await room('201');
      assert.equal(
        (
          await rpc('housekeeping_room_set_status', [
            hotel,
            other.id,
            'out-of-order',
            other.version,
          ])
        ).error,
        'NOTE_REQUIRED',
      );
      assert.ok(
        (
          await rpc('housekeeping_room_set_status', [
            hotel,
            other.id,
            'out-of-order',
            other.version,
            'AC leaking',
          ])
        ).data,
      );
      assert.equal(
        (await rpc('housekeeping_task_start', [hotel, other.id, 'deep-clean'])).error,
        'WRONG_ROOM_STATUS',
      );
    });

    await t.test('history and summary report one hotel day', async () => {
      await as(supervisor);
      const today = (
        await db.query<{ d: string }>(
          "select to_char((now() at time zone 'Asia/Jakarta')::date,'YYYY-MM-DD') as d",
        )
      ).rows[0].d;
      const history = await rpc('housekeeping_tasks_list', [hotel, null, today]);
      assert.equal(history.data!.length, 4);
      assert.ok(history.data!.every((row) => typeof row.room_number === 'string'));
      const page = await rpc('housekeeping_tasks_list', [hotel, null, today, null, null, 3]);
      const rest = await rpc('housekeeping_tasks_list', [
        hotel,
        null,
        today,
        null,
        page.meta?.nextCursor,
        3,
      ]);
      assert.equal(page.data!.length + rest.data!.length, 4);
      assert.equal(
        (await rpc('housekeeping_tasks_list', [hotel, null, '2000-01-01'])).data!.length,
        0,
      );
      const summary = (await rpc('housekeeping_summary', [hotel, null, today])).data!;
      const statuses = summary.statuses as Row;
      assert.equal(statuses.occupied, 1);
      assert.equal(statuses['out-of-order'], 1);
      assert.equal(statuses['vacant-dirty'], 2);
      const departure = (summary.task_types as Record<string, Row>).departure;
      assert.equal(departure.done, 2);
      assert.equal((summary.task_types as Record<string, Row>)['make-up'].declined, 2);
      assert.deepEqual(summary.inspections, { pass: 1, redo: 1 });
      assert.equal((summary.attendants as Row[])[0].email, 'user1@example.com');
      assert.equal((summary.attendants as Row[])[0].done, 2);
    });

    await t.test('supervisors can close a stuck task; cancel keeps no duration', async () => {
      await as(second);
      const task = await rpc('housekeeping_task_start', [
        hotel,
        (await room('102')).id,
        'departure',
      ]);
      await as(supervisor);
      const cancelled = await rpc('housekeeping_task_update', [hotel, task.data?.id, 'cancel']);
      assert.equal(cancelled.data?.status, 'cancelled');
      assert.equal(cancelled.data?.duration_seconds, null);
      assert.equal((await room('102')).status, 'vacant-dirty');
    });

    await t.test('other departments and switched-off modules see nothing', async () => {
      await as(outsider);
      assert.deepEqual(await rooms(), []);
      assert.equal(
        (
          await rpc('housekeeping_task_start', [
            hotel,
            (
              await (async () => {
                await as(reader);
                return room('102');
              })()
            ).id,
            'departure',
          ])
        ).error,
        'ACCESS_DENIED',
      );
      await as(outsider);
      assert.equal((await rpc('housekeeping_summary', [hotel, hk])).error, 'ACCESS_DENIED');
      await db.exec('reset role');
      await db.exec(
        "update workstel_private.installed_modules set enabled=false where module_id='housekeeping'",
      );
      await as(reader);
      assert.equal((await rpc('housekeeping_rooms_list', [hotel])).error, 'ACCESS_DENIED');
    });

    await t.test(
      'tables stay closed, inspections are append-only and changes are audited',
      async () => {
        await as(reader);
        await assert.rejects(
          db.query('select * from public.housekeeping_tasks'),
          /permission denied/,
        );
        await db.exec('reset role');
        await assert.rejects(
          db.exec("update public.housekeeping_inspections set reason='x'"),
          /append-only/,
        );
        const actions = (
          await db.query<{ action: string }>(
            "select distinct action||':'||outcome as action from workstel_private.audit_events where action like 'housekeeping.%'",
          )
        ).rows.map((row) => row.action);
        for (const expected of [
          'housekeeping.room.save:success',
          'housekeeping.room.import:success',
          'housekeeping.room.status:success',
          'housekeeping.task.start:success',
          'housekeeping.task.pause:success',
          'housekeeping.task.done:success',
          'housekeeping.task.dnd:success',
          'housekeeping.task.refused:success',
          'housekeeping.task.cancel:success',
          'housekeeping.inspection.pass:success',
          'housekeeping.inspection.redo:success',
          'housekeeping.write:denied',
          'housekeeping.rooms.list:denied',
        ])
          assert.ok(actions.includes(expected), expected);
      },
    );
  } finally {
    await db.close();
  }
});
