import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type RpcResult = {
  data?: Record<string, unknown> & Record<string, unknown>[];
  error?: string;
  meta?: Record<string, unknown>;
};

test('Vehicle Checklist and Bin Card enforce module scope in PostgreSQL', async (t) => {
  const db = new PGlite();
  const manager = '11111111-1111-4111-8111-111111111111',
    staff = '22222222-2222-4222-8222-222222222222',
    outsider = '33333333-3333-4333-8333-333333333333',
    vaultOnly = '44444444-4444-4444-8444-444444444444';
  const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    frontOffice = 'aaaaaaaa-1111-4111-8111-111111111111',
    engineering = 'aaaaaaaa-2222-4222-8222-222222222222';
  const items = {
    exterior: 'ok',
    tires: 'ok',
    lights: 'issue',
    brakes: 'ok',
    wipers: 'ok',
    horn: 'ok',
    interior: 'ok',
    'air-conditioning': 'ok',
    documents: 'ok',
    'safety-kit': 'ok',
  };
  try {
    await db.exec(
      `create role anon;create role authenticated;create schema auth;create table auth.users(id uuid primary key,email text unique);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to anon,authenticated;`,
    );
    for (const migration of [
      '202611010001_vault_metadata',
      '202611010002_audit_visibility',
      '202611040001_module_access',
      '202611040002_vehicle_checklist',
      '202611040003_bin_card',
    ])
      await db.exec(await readFile('supabase/migrations/' + migration + '.sql', 'utf8'));
    await db.query('insert into auth.users values ($1,$2),($3,$4),($5,$6),($7,$8)', [
      manager,
      'manager@example.com',
      staff,
      'staff@example.com',
      outsider,
      'outsider@example.com',
      vaultOnly,
      'vault@example.com',
    ]);
    await db.query("insert into public.workstel_hotels values ($1,'Hotel')", [hotel]);
    await db.query(
      "insert into public.workstel_departments(id,hotel_id,code,name) values ($1,$3,'front-office','Front Office'),($2,$3,'engineering','Engineering')",
      [frontOffice, engineering, hotel],
    );
    // Every user is a full department member; only module_access decides module rights.
    for (const user of [manager, staff, outsider, vaultOnly])
      await db.query(
        'insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read,can_write,can_archive,can_audit) values ($1,$2,$3,true,true,true,true)',
        [user, hotel, user === outsider ? engineering : frontOffice],
      );
    for (const moduleId of ['vehicle', 'bin-card']) {
      await db.query(
        'insert into workstel_private.module_access(user_id,hotel_id,department_id,module_id,can_read,can_write,can_manage) values ($1,$3,$4,$5,true,true,true),($2,$3,$4,$5,true,true,false)',
        [manager, staff, hotel, frontOffice, moduleId],
      );
      await db.query(
        'insert into workstel_private.module_access(user_id,hotel_id,department_id,module_id,can_read,can_write,can_manage) values ($1,$2,$3,$4,true,true,true)',
        [outsider, hotel, engineering, moduleId],
      );
    }
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
    const key = () => crypto.randomUUID();

    await t.test('module access advertises installed modules and only granted scopes', async () => {
      await as(manager);
      const access = await rpc('workstel_module_access');
      assert.deepEqual(access.meta?.installedModules, ['bin-card', 'vehicle']);
      assert.equal((access.data as unknown[]).length, 2);
      await as(vaultOnly);
      assert.deepEqual((await rpc('workstel_module_access')).data, []);
      assert.equal((await rpc('vehicle_list_units', [hotel])).error, 'ACCESS_DENIED');
      assert.equal((await rpc('bin_card_list_items', [hotel])).error, 'ACCESS_DENIED');
    });

    let vehicleId = '';
    await t.test('vehicle units need manage rights and keep canonical unique plates', async () => {
      await as(staff);
      const unit = JSON.stringify({ name: 'Toyota Hiace', plateNumber: 'b 1234  xyz' });
      assert.equal(
        (await rpc('vehicle_save_unit', [hotel, frontOffice, unit])).error,
        'ACCESS_DENIED',
      );
      await as(manager);
      const created = await rpc('vehicle_save_unit', [hotel, frontOffice, unit]);
      vehicleId = String(created.data?.id);
      const listed = await rpc('vehicle_list_units', [hotel]);
      assert.equal(listed.data?.[0].plate_number, 'B 1234 XYZ');
      assert.equal(
        (await rpc('vehicle_save_unit', [hotel, frontOffice, unit])).error,
        'DUPLICATE_PLATE',
      );
      assert.equal(
        (
          await rpc('vehicle_save_unit', [
            hotel,
            frontOffice,
            JSON.stringify({ name: 'X', plateNumber: 'B 1', extra: true }),
          ])
        ).error,
        'INVALID_INPUT',
      );
      assert.equal(
        (await rpc('vehicle_save_unit', [hotel, frontOffice, unit, vehicleId, 9])).error,
        'VERSION_CONFLICT',
      );
    });

    await t.test('inspections validate every item, are idempotent and append-only', async () => {
      await as(staff);
      const partial = JSON.stringify({ fuelLevel: 'half', items: { exterior: 'ok' } });
      assert.equal(
        (await rpc('vehicle_record_inspection', [hotel, vehicleId, partial, key()])).error,
        'INVALID_INPUT',
      );
      const unexplained = JSON.stringify({ fuelLevel: 'half', items, notes: ' ' });
      assert.equal(
        (await rpc('vehicle_record_inspection', [hotel, vehicleId, unexplained, key()])).error,
        'NOTES_REQUIRED',
      );
      const input = JSON.stringify({
        odometerKm: 120450,
        fuelLevel: 'half',
        items,
        notes: 'Left headlight out',
      });
      const retry = key();
      const first = await rpc('vehicle_record_inspection', [hotel, vehicleId, input, retry]);
      assert.equal(first.data?.result, 'attention');
      const again = await rpc('vehicle_record_inspection', [hotel, vehicleId, input, retry]);
      assert.equal(again.data?.id, first.data?.id);
      const history = await rpc('vehicle_list_inspections', [hotel, vehicleId]);
      assert.equal((history.data as unknown[]).length, 1);
      assert.equal(history.data?.[0].inspector_email, 'staff@example.com');
      const unit = await rpc('vehicle_list_units', [hotel]);
      assert.equal(unit.data?.[0].last_result, 'attention');
      assert.equal(unit.data?.[0].version, 1);
      await db.exec('reset role');
      await assert.rejects(
        db.query('update public.vehicle_inspections set notes=$1', ['changed']),
        /append-only/,
      );
    });

    await t.test('other departments cannot read or inspect a vehicle', async () => {
      await as(outsider);
      assert.deepEqual((await rpc('vehicle_list_units', [hotel])).data, []);
      assert.equal(
        (
          await rpc('vehicle_record_inspection', [
            hotel,
            vehicleId,
            JSON.stringify({ fuelLevel: 'full', items }),
            key(),
          ])
        ).error,
        'ACCESS_DENIED',
      );
      assert.equal(
        (await rpc('vehicle_list_inspections', [hotel, vehicleId])).error,
        'ACCESS_DENIED',
      );
    });

    await t.test('archived vehicles cannot be inspected', async () => {
      await as(manager);
      assert.ok(
        (await rpc('vehicle_save_unit', [hotel, frontOffice, null, vehicleId, 1, 'archive'])).data,
      );
      assert.equal(
        (
          await rpc('vehicle_record_inspection', [
            hotel,
            vehicleId,
            JSON.stringify({ fuelLevel: 'full', items }),
            key(),
          ])
        ).error,
        'VEHICLE_ARCHIVED',
      );
    });

    let itemId = '';
    await t.test('bin card balances follow the ledger and never go negative', async () => {
      await as(manager);
      const item = JSON.stringify({
        code: 'lin-01',
        name: 'Bath towel',
        unit: 'pcs',
        location: 'Linen room A',
        minQuantity: 5,
      });
      const created = await rpc('bin_card_save_item', [hotel, frontOffice, item]);
      itemId = String(created.data?.id);
      assert.equal(
        (await rpc('bin_card_save_item', [hotel, frontOffice, item])).error,
        'DUPLICATE_CODE',
      );
      await as(staff);
      const move = (type: string, quantity: unknown) =>
        rpc('bin_card_record_entry', [
          hotel,
          itemId,
          JSON.stringify({ type, quantity, reference: 'PO-1' }),
          key(),
        ]);
      assert.equal(Number((await move('receipt', 10)).data?.balance), 10);
      assert.equal(Number((await move('issue', 4)).data?.balance), 6);
      assert.equal((await move('issue', 7)).error, 'INSUFFICIENT_STOCK');
      assert.equal((await move('receipt', 1.2345)).error, 'INVALID_INPUT');
      assert.equal((await move('receipt', -1)).error, 'INVALID_INPUT');
      assert.equal(Number((await move('adjustment', 5)).data?.balance), 5);
      assert.equal((await move('adjustment', 5)).error, 'NO_CHANGE');
      const retry = key();
      const input = JSON.stringify({ type: 'issue', quantity: 1 });
      const first = await rpc('bin_card_record_entry', [hotel, itemId, input, retry]);
      const again = await rpc('bin_card_record_entry', [hotel, itemId, input, retry]);
      assert.equal(again.data?.id, first.data?.id);
      assert.equal(Number(again.data?.balance), 4);
      const low = await rpc('bin_card_list_items', [hotel, null, 'active', '', true]);
      assert.equal((low.data as unknown[]).length, 1);
      const ledger = await rpc('bin_card_list_entries', [hotel, itemId]);
      assert.deepEqual(
        (ledger.data as Record<string, unknown>[]).map((row) => Number(row.quantity)),
        [-1, -1, -4, 10],
      );
    });

    await t.test('bin card items lock their unit and archive only when empty', async () => {
      await as(manager);
      const changed = JSON.stringify({ code: 'LIN-01', name: 'Bath towel', unit: 'set' });
      assert.equal(
        (await rpc('bin_card_save_item', [hotel, frontOffice, changed, itemId, 1])).error,
        'UNIT_LOCKED',
      );
      assert.equal(
        (await rpc('bin_card_save_item', [hotel, frontOffice, null, itemId, 1, 'archive'])).error,
        'BALANCE_NOT_ZERO',
      );
      await as(outsider);
      assert.deepEqual((await rpc('bin_card_list_items', [hotel])).data, []);
      assert.equal(
        (
          await rpc('bin_card_record_entry', [
            hotel,
            itemId,
            JSON.stringify({ type: 'issue', quantity: 1 }),
            key(),
          ])
        ).error,
        'ACCESS_DENIED',
      );
    });

    await t.test('disabled staff membership removes module access', async () => {
      await db.exec('reset role');
      await db.query('update workstel_private.staff_access set enabled=false where user_id=$1', [
        staff,
      ]);
      await as(staff);
      assert.equal((await rpc('bin_card_list_items', [hotel])).error, 'ACCESS_DENIED');
      assert.deepEqual((await rpc('workstel_module_access')).data, []);
    });

    await t.test(
      'accounting is a canonical department that needs explicit membership',
      async () => {
        await db.exec('reset role');
        // Applied after hotels exist, as on the live server, so the backfill has a hotel to extend.
        await db.exec(
          await readFile('supabase/migrations/202611040004_accounting_department.sql', 'utf8'),
        );
        const accounting = (
          await db.query<{ id: string }>(
            "select id from public.workstel_departments where hotel_id=$1 and code='accounting'",
            [hotel],
          )
        ).rows[0]?.id;
        assert.ok(accounting);
        await db.query(
          "insert into workstel_private.module_access(user_id,hotel_id,department_id,module_id,can_read,can_write,can_manage) values ($1,$2,$3,'bin-card',true,true,true)",
          [vaultOnly, hotel, accounting],
        );
        // A module grant without a staff membership in that department grants nothing.
        await as(vaultOnly);
        assert.equal(
          (await rpc('bin_card_list_items', [hotel, accounting])).error,
          'ACCESS_DENIED',
        );
        await db.exec('reset role');
        await db.query(
          'insert into workstel_private.staff_access(user_id,hotel_id,department_id) values ($1,$2,$3)',
          [vaultOnly, hotel, accounting],
        );
        await as(vaultOnly);
        const item = JSON.stringify({ code: 'ACC-1', name: 'Receipt paper', unit: 'roll' });
        assert.ok((await rpc('bin_card_save_item', [hotel, accounting, item])).data);
        // Membership without Vault flags grants no Vault access in that department.
        assert.equal(
          (await rpc('vault_list_accounts', [hotel, accounting])).error,
          'ACCESS_DENIED',
        );
        assert.equal((await rpc('vehicle_list_units', [hotel, accounting])).error, 'ACCESS_DENIED');
      },
    );

    await t.test('Human Resource and Admin and General are canonical departments', async () => {
      await db.exec('reset role');
      const migration = await readFile(
        'supabase/migrations/202611040005_hr_admin_departments.sql',
        'utf8',
      );
      await db.exec(migration);
      const rows = await db.query<{ code: string; name: string }>(
        "select code,name from public.workstel_departments where hotel_id=$1 and code in ('human-resource','admin-general') order by code",
        [hotel],
      );
      assert.deepEqual(rows.rows, [
        { code: 'admin-general', name: 'Admin and General' },
        { code: 'human-resource', name: 'Human Resource' },
      ]);
      // Re-running the backfill is harmless and unknown codes stay rejected.
      await db.exec(migration);
      await assert.rejects(
        db.query(
          "insert into public.workstel_departments(hotel_id,code,name) values ($1,'housekeeping','Housekeeping')",
          [hotel],
        ),
      );
    });

    await t.test('developers switch modules on the server without losing data', async () => {
      await db.exec('reset role');
      await db.exec(await readFile('supabase/migrations/202611040006_module_switch.sql', 'utf8'));
      await as(manager);
      assert.equal((await rpc('workstel_module_access')).meta?.platformAdmin, false);
      assert.equal(
        (await rpc('workstel_set_module_enabled', ['vehicle', false])).error,
        'ACCESS_DENIED',
      );
      assert.equal((await rpc('workstel_list_modules')).error, 'ACCESS_DENIED');
      await db.exec('reset role');
      await db.query('insert into workstel_private.platform_admins(user_id) values ($1)', [
        manager,
      ]);
      await as(manager);
      assert.equal((await rpc('workstel_module_access')).meta?.platformAdmin, true);
      const before = await rpc('vehicle_list_units', [hotel, null, 'all']);
      assert.equal((before.data as unknown[]).length, 1);

      const off = await rpc('workstel_set_module_enabled', ['vehicle', false]);
      assert.equal(off.data?.enabled, false);
      const access = await rpc('workstel_module_access');
      assert.deepEqual(access.meta?.installedModules, ['bin-card']);
      assert.ok(
        !(access.data as Record<string, unknown>[]).some((row) => row.moduleId === 'vehicle'),
      );
      // The switch is enforced by every module RPC, not only hidden in the dashboard.
      assert.equal((await rpc('vehicle_list_units', [hotel])).error, 'ACCESS_DENIED');
      assert.ok((await rpc('bin_card_list_items', [hotel])).data);
      const listed = (await rpc('workstel_list_modules')).data as Record<string, unknown>[];
      assert.deepEqual(
        listed.map((row) => [row.moduleId, row.enabled, row.updatedByEmail]),
        [
          ['bin-card', true, null],
          ['vehicle', false, 'manager@example.com'],
        ],
      );

      assert.equal(
        (await rpc('workstel_set_module_enabled', ['vehicle', true])).data?.enabled,
        true,
      );
      const after = await rpc('vehicle_list_units', [hotel, null, 'all']);
      assert.deepEqual(after.data, before.data);
      assert.equal(
        (await rpc('workstel_set_module_enabled', ['sales-crm', false])).error,
        'MODULE_NOT_INSTALLED',
      );
      await db.exec('reset role');
      const events = (
        await db.query<{ action: string; outcome: string }>(
          "select action,outcome from workstel_private.audit_events where action like 'platform.%' order by occurred_at",
        )
      ).rows.map((row) => row.action + ':' + row.outcome);
      assert.deepEqual(events, [
        'platform.module.switch:denied',
        'platform.module.list:denied',
        'platform.admin.insert:success',
        'platform.module.vehicle.disable:success',
        'platform.module.vehicle.enable:success',
      ]);
    });

    await t.test('module events are recorded in their own audit namespaces', async () => {
      await db.exec('reset role');
      const actions = (
        await db.query<{ action: string }>(
          'select distinct action from workstel_private.audit_events order by action',
        )
      ).rows.map((row) => row.action);
      for (const action of [
        'bin-card.entry.adjustment',
        'bin-card.entry.issue',
        'bin-card.entry.receipt',
        'bin-card.item.save',
        'staff.module-access.insert',
        'vehicle.inspection.create',
        'vehicle.unit.archive',
        'vehicle.unit.save',
      ])
        assert.ok(actions.includes(action), action);
      // The only Vault event is the deliberate Vault denial check above.
      assert.deepEqual(
        actions.filter((action) => action.startsWith('vault.')),
        ['vault.list'],
      );
    });
  } finally {
    await db.close();
  }
});
