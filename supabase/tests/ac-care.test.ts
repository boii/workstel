import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type Row = Record<string, unknown>;
type RpcResult = { data?: Row & Row[]; error?: string; meta?: Row };

const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  engineering = 'aaaaaaaa-1111-4111-8111-111111111111',
  frontOffice = 'aaaaaaaa-2222-4222-8222-222222222222',
  chief = '11111111-1111-4111-8111-111111111111',
  techA = '22222222-2222-4222-8222-222222222222',
  techB = '33333333-3333-4333-8333-333333333333',
  reader = '44444444-4444-4444-8444-444444444444',
  outsider = '55555555-5555-4555-8555-555555555555';

const allOk = (kind: string) => {
  const items: Record<string, string[]> = {
    filter: ['filter'],
    routine: ['filter', 'evaporator', 'drain', 'noise'],
    major: ['filter', 'evaporator', 'drain', 'noise', 'condenser', 'leak'],
  };
  return Object.fromEntries(items[kind].map((item) => [item, 'ok']));
};

test('AC Care schedules, claims and service records follow module grants', async (t) => {
  const db = new PGlite();
  try {
    await db.exec(
      `create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text unique,raw_app_meta_data jsonb not null default '{}',raw_user_meta_data jsonb not null default '{}');create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;`,
    );
    for (const file of (await readdir('supabase/migrations')).sort())
      await db.exec(await readFile('supabase/migrations/' + file, 'utf8'));
    for (const [index, user] of [chief, techA, techB, reader, outsider].entries())
      await db.query('insert into auth.users(id,email) values ($1,$2)', [
        user,
        'user' + index + '@example.com',
      ]);
    await db.query("insert into public.workstel_hotels values ($1,'Hotel')", [hotel]);
    for (const [id, code, name] of [
      [engineering, 'engineering', 'Engineering'],
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
        "insert into workstel_private.module_access(user_id,hotel_id,department_id,module_id,can_read,can_write,can_manage) values ($1,$2,$3,'ac-care',true,$4,$5)",
        [user, hotel, dept, write, manage],
      );
    };
    await grant(chief, engineering, true, true);
    await grant(techA, engineering, true, false);
    await grant(techB, engineering, true, false);
    await grant(reader, engineering, false, false);
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
    const list = async () => (await rpc('ac_care_units_list', [hotel, null, false])).data!;
    const unit = async (code: string) => (await list()).find((row) => row.code === code)!;
    const schedule = (row: Row, type: string) =>
      (row.schedule as Row[]).find((entry) => entry.type === type)!;
    const record = (id: string, input: Row, key = crypto.randomUUID()) =>
      rpc('ac_care_service_record', [hotel, id, input, key]);
    const service = (kind: string, extra: Row = {}) => ({
      serviceType: kind,
      items: allOk(kind),
      returnTemp: null,
      supplyTemp: null,
      pressurePsi: null,
      currentAmp: null,
      refrigerantAdded: false,
      notes: '',
      ...extra,
    });

    await t.test('only supervisors maintain the unit register', async () => {
      const input = { code: ' 512-a ', location: 'Room 512', area: 'Floor 5', refrigerant: 'r32' };
      await as(techA);
      assert.equal(
        (await rpc('ac_care_unit_save', [hotel, engineering, input, null, null, 'save'])).error,
        'ACCESS_DENIED',
      );
      await as(outsider);
      assert.equal(
        (await rpc('ac_care_unit_save', [hotel, engineering, input, null, null, 'save'])).error,
        'ACCESS_DENIED',
      );
      await as(chief);
      assert.ok(
        (await rpc('ac_care_unit_save', [hotel, engineering, input, null, null, 'save'])).data,
      );
      assert.equal(
        (
          await rpc('ac_care_unit_save', [
            hotel,
            engineering,
            { code: '512-A', location: 'Again' },
            null,
            null,
            'save',
          ])
        ).error,
        'DUPLICATE_CODE',
      );
      for (const bad of [
        { code: '', location: 'Lobby' },
        { code: 'L1', location: 'Lobby', unitType: 'window' },
        { code: 'L1', location: 'Lobby', filterDays: 1000 },
        { code: 'L1', location: 'Lobby', installedOn: '2026-02-30' },
        { code: 'L1', location: 'Lobby', secret: 'x' },
      ])
        assert.equal(
          (await rpc('ac_care_unit_save', [hotel, engineering, bad, null, null, 'save'])).error,
          'INVALID_INPUT',
          JSON.stringify(bad),
        );
      const imported = await rpc('ac_care_units_import', [
        hotel,
        engineering,
        [
          { code: '512-A', location: 'Room 512' },
          { code: '601', location: 'Room 601', area: 'floor 6' },
          { code: 'LOBBY-1', location: 'Lobby', unitType: 'cassette', refrigerant: 'r22' },
        ],
      ]);
      assert.deepEqual(imported.data, { added: 2, skipped: 1 });
      const row = await unit('512-A');
      assert.equal(row.area, 'Floor 5');
      assert.equal(row.condition, 'normal');
      const edited = await rpc('ac_care_unit_save', [
        hotel,
        engineering,
        { code: '512-A', location: 'Room 512', area: 'Floor 5', ratedCurrent: 4.5, majorDays: 0 },
        row.id,
        row.version,
        'save',
      ]);
      assert.equal(edited.data!.version, 2);
      assert.equal(
        (
          await rpc('ac_care_unit_save', [
            hotel,
            engineering,
            { code: '512-A', location: 'x' },
            row.id,
            1,
            'save',
          ])
        ).error,
        'VERSION_CONFLICT',
      );
    });

    await t.test('the schedule starts on the registration day', async () => {
      await as(reader);
      const row = await unit('512-A');
      const today = (
        await db.query<{ d: string }>(
          "select to_char((now() at time zone 'Asia/Jakarta')::date,'YYYY-MM-DD') as d",
        )
      ).rows[0].d;
      assert.deepEqual(
        (row.schedule as Row[]).map((entry) => entry.type),
        ['filter', 'routine', 'annual'],
      );
      assert.equal(schedule(row, 'filter').last_done_at, null);
      const due = new Date(today + 'T00:00:00Z');
      due.setUTCDate(due.getUTCDate() + 21);
      assert.equal(schedule(row, 'filter').due_on, due.toISOString().slice(0, 10));
      // Another department's staff see none of Engineering's units.
      await as(outsider);
      assert.deepEqual(await list(), []);
      assert.equal(
        (await rpc('ac_care_units_list', [hotel, engineering, false])).error,
        'ACCESS_DENIED',
      );
    });

    await t.test('one technician claims a service at a time', async () => {
      await as(chief);
      const id = (await unit('512-A')).id as string;
      await as(reader);
      assert.equal(
        (await rpc('ac_care_work_set', [hotel, id, 'filter', 'claim', '', null])).error,
        'ACCESS_DENIED',
      );
      await as(techA);
      const claimed = await rpc('ac_care_work_set', [hotel, id, 'filter', 'claim', '', null]);
      const work = schedule(claimed.data!.unit as Row, 'filter').work as Row;
      assert.equal(work.state, 'claimed');
      assert.equal(work.mine, true);
      assert.equal(
        (await rpc('ac_care_work_set', [hotel, id, 'major', 'claim', '', null])).error,
        'NOT_SCHEDULED',
      );
      await as(techB);
      assert.equal(
        (await rpc('ac_care_work_set', [hotel, id, 'filter', 'claim', '', null])).error,
        'CLAIMED_BY_OTHER',
      );
      assert.equal((await record(id, service('filter'))).error, 'CLAIMED_BY_OTHER');
      assert.equal(
        (await rpc('ac_care_work_set', [hotel, id, 'filter', 'assign', '', techB])).error,
        'ACCESS_DENIED',
      );
      // An expired claim is free again.
      await db.exec('reset role');
      await db.query(
        "update public.ac_care_work set expires_at=clock_timestamp()-interval '1 minute' where unit_id=$1",
        [id],
      );
      await as(techB);
      assert.ok((await rpc('ac_care_work_set', [hotel, id, 'filter', 'claim', '', null])).data);
      await as(chief);
      assert.equal(
        (await rpc('ac_care_work_set', [hotel, id, 'filter', 'assign', '', reader])).error,
        'ASSIGNEE_INVALID',
      );
      const assigned = await rpc('ac_care_work_set', [hotel, id, 'filter', 'assign', '', techA]);
      const after = schedule(assigned.data!.unit as Row, 'filter').work as Row;
      assert.equal(after.user_email, 'user1@example.com');
      assert.equal(after.assigned, true);
      await as(techA);
      assert.equal(
        (await rpc('ac_care_work_set', [hotel, id, 'routine', 'postpone', ' ', null])).error,
        'INVALID_INPUT',
      );
      assert.ok(
        (await rpc('ac_care_work_set', [hotel, id, 'routine', 'postpone', 'Guest in room', null]))
          .data,
      );
      await as(techB);
      assert.equal(
        (await rpc('ac_care_work_set', [hotel, id, 'routine', 'release', '', null])).error,
        'CLAIMED_BY_OTHER',
      );
    });

    await t.test('the server judges each service from its readings', async () => {
      await as(chief);
      const id = (await unit('512-A')).id as string;
      await as(techA);
      assert.equal((await record(id, service('routine'))).error, 'READINGS_REQUIRED');
      assert.equal(
        (await record(id, service('routine', { items: { filter: 'ok' } }))).error,
        'INVALID_INPUT',
      );
      assert.equal(
        (await record(id, service('routine', { returnTemp: 25, supplyTemp: 22 }))).error,
        'NOTES_REQUIRED',
      );
      const key = crypto.randomUUID();
      const normal = await record(id, service('routine', { returnTemp: 25, supplyTemp: 15 }), key);
      assert.equal(normal.data!.result, 'normal');
      const retried = await record(id, service('routine', { returnTemp: 25, supplyTemp: 15 }), key);
      assert.equal(retried.data!.id, normal.data!.id);
      const row = await unit('512-A');
      // Routine includes filter cleaning: both are reset and their claims are gone.
      for (const type of ['filter', 'routine']) {
        assert.ok(schedule(row, type).last_done_at);
        assert.equal(schedule(row, type).work, null);
      }
      assert.equal(schedule(row, 'annual').last_done_at, null);

      const refill = await record(
        id,
        service('filter', { refrigerantAdded: true, currentAmp: 5.2, notes: 'Topped up R32' }),
      );
      assert.deepEqual(refill.data!.reasons, ['current']);
      const again = await record(id, service('filter', { refrigerantAdded: true, notes: 'Again' }));
      assert.deepEqual(again.data!.reasons, ['repeat-refill']);
      const after = await unit('512-A');
      assert.equal(after.condition, 'attention');
      assert.equal(after.refills_90d, 2);

      const lobby = (await unit('LOBBY-1')).id as string;
      const pressure = await record(
        lobby,
        service('major', {
          returnTemp: 26,
          supplyTemp: 16,
          pressurePsi: 120,
          currentAmp: 8,
          notes: 'Low pressure for R22?',
        }),
      );
      assert.deepEqual(pressure.data!.reasons, ['pressure']);
      await db.exec('reset role');
      await assert.rejects(db.query('update public.ac_care_services set notes=$1', ['x']));
    });

    await t.test('complaints and history stay with the unit', async () => {
      await as(chief);
      const id = (await unit('601')).id as string;
      await as(techB);
      assert.equal(
        (await rpc('ac_care_complaint_record', [hotel, id, 'other', ' ', crypto.randomUUID()]))
          .error,
        'INVALID_INPUT',
      );
      assert.ok(
        (
          await rpc('ac_care_complaint_record', [
            hotel,
            id,
            'not-cold',
            'Guest',
            crypto.randomUUID(),
          ])
        ).data,
      );
      await record(id, service('routine', { returnTemp: 24, supplyTemp: 14 }));
      const row = await unit('601');
      assert.equal(row.condition, 'normal');
      assert.equal(row.complaints_60d, 1);
      await as(reader);
      const first = await rpc('ac_care_unit_history', [hotel, id, null, null, 1]);
      assert.equal(first.data![0].kind, 'service');
      const cursor = first.meta!.nextCursor as Row;
      const second = await rpc('ac_care_unit_history', [hotel, id, cursor.at, cursor.id, 1]);
      assert.equal(second.data![0].kind, 'complaint');
      assert.equal(second.data![0].complaint, 'not-cold');
      await db.exec('reset role');
      await assert.rejects(db.query('delete from public.ac_care_complaints'));
      await as(outsider);
      assert.equal(
        (await rpc('ac_care_unit_history', [hotel, id, null, null, 10])).error,
        'ACCESS_DENIED',
      );
    });

    await t.test('supervisors give technicians their areas', async () => {
      await as(techA);
      assert.equal(
        (await rpc('ac_care_area_member_set', [hotel, engineering, 'Floor 5', techA, 'add', false]))
          .error,
        'ACCESS_DENIED',
      );
      await as(chief);
      assert.equal(
        (
          await rpc('ac_care_area_member_set', [
            hotel,
            engineering,
            'Floor 5',
            reader,
            'add',
            false,
          ])
        ).error,
        'ASSIGNEE_INVALID',
      );
      const added = await rpc('ac_care_area_member_set', [
        hotel,
        engineering,
        'FLOOR 6',
        techA,
        'add',
        true,
      ]);
      assert.equal(added.data!.area, 'floor 6');
      await rpc('ac_care_area_member_set', [hotel, engineering, 'Floor 5', techA, 'add', false]);
      const areas = (await rpc('ac_care_areas_list', [hotel, engineering])).data!;
      const five = (areas.areas as Row[]).find((row) => row.area === 'Floor 5')!;
      assert.equal((five.members as Row[])[0].email, 'user1@example.com');
      assert.deepEqual(
        (areas.technicians as Row[]).map((row) => row.email),
        ['user0@example.com', 'user1@example.com', 'user2@example.com'],
      );
      await as(techA);
      assert.equal((await unit('512-A')).area_mine, true);
      await as(techB);
      assert.equal((await unit('512-A')).area_mine, false);
    });

    await t.test('archived units take no work', async () => {
      await as(chief);
      const row = await unit('601');
      await rpc('ac_care_unit_save', [hotel, engineering, null, row.id, row.version, 'archive']);
      await as(techA);
      assert.equal((await record(row.id as string, service('filter'))).error, 'UNIT_ARCHIVED');
      assert.equal(
        (await rpc('ac_care_work_set', [hotel, row.id, 'filter', 'claim', '', null])).error,
        'UNIT_ARCHIVED',
      );
      assert.equal(await unit('601'), undefined);
    });

    await t.test('every call is audited in the module namespace', async () => {
      await db.exec('reset role');
      const actions = (
        await db.query<{ action: string; outcome: string }>(
          "select distinct action,outcome from workstel_private.audit_events where action like 'ac-care.%' order by 1,2",
        )
      ).rows.map((row) => row.action + ':' + row.outcome);
      for (const expected of [
        'ac-care.units.list:denied',
        'ac-care.write:denied',
        'ac-care.unit.save:success',
        'ac-care.unit.import:success',
        'ac-care.work.claim:success',
        'ac-care.work.assign:success',
        'ac-care.service.record:success',
        'ac-care.complaint.record:success',
        'ac-care.history.read:success',
        'ac-care.area.add:success',
      ])
        assert.ok(actions.includes(expected), expected);
    });
  } finally {
    await db.close();
  }
});
