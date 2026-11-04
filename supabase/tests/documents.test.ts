import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

type RpcResult = {
  data?: Record<string, unknown> & Record<string, unknown>[];
  error?: string;
  meta?: Record<string, unknown>;
};

test('Documents & SOPs links follow module grants per department', async (t) => {
  const db = new PGlite();
  const manager = '11111111-1111-4111-8111-111111111111',
    writer = '22222222-2222-4222-8222-222222222222',
    reader = '33333333-3333-4333-8333-333333333333',
    outsider = '44444444-4444-4444-8444-444444444444';
  const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    frontOffice = 'aaaaaaaa-1111-4111-8111-111111111111',
    engineering = 'aaaaaaaa-2222-4222-8222-222222222222';
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
    ])
      await db.exec(await readFile('supabase/migrations/' + migration + '.sql', 'utf8'));
    for (const [index, user] of [manager, writer, reader, outsider].entries())
      await db.query('insert into auth.users values ($1,$2)', [
        user,
        'user' + index + '@example.com',
      ]);
    await db.query("insert into public.workstel_hotels values ($1,'Hotel')", [hotel]);
    await db.query(
      "insert into public.workstel_departments(id,hotel_id,code,name) values ($1,$3,'front-office','Front Office'),($2,$3,'engineering','Engineering')",
      [frontOffice, engineering, hotel],
    );
    const grant = async (user: string, department: string, write: boolean, manage: boolean) => {
      await db.query(
        'insert into workstel_private.staff_access(user_id,hotel_id,department_id,can_read) values ($1,$2,$3,true)',
        [user, hotel, department],
      );
      await db.query(
        "insert into workstel_private.module_access(user_id,hotel_id,department_id,module_id,can_read,can_write,can_manage) values ($1,$2,$3,'documents',true,$4,$5)",
        [user, hotel, department, write, manage],
      );
    };
    await grant(manager, frontOffice, true, true);
    await grant(writer, frontOffice, true, false);
    await grant(reader, frontOffice, false, false);
    await grant(outsider, engineering, true, true);
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
    const link = (url: string, extra: Record<string, string> = {}) =>
      JSON.stringify({ title: 'Check-in SOP', category: 'sop', url, ...extra });
    let id = '';

    await t.test('writers add links; readers only read', async () => {
      await as(reader);
      assert.equal(
        (await rpc('documents_save', [hotel, frontOffice, link('https://drive.example.com/sop')]))
          .error,
        'ACCESS_DENIED',
      );
      await as(writer);
      const saved = await rpc('documents_save', [
        hotel,
        frontOffice,
        link(' https://drive.example.com/sop ', { description: ' Front desk arrival steps ' }),
      ]);
      id = String(saved.data?.id);
      await as(reader);
      const listed = await rpc('documents_list', [hotel]);
      assert.equal(listed.data?.[0].url, 'https://drive.example.com/sop');
      assert.equal(listed.data?.[0].description, 'Front desk arrival steps');
      assert.equal(listed.data?.[0].department_name, 'Front Office');
    });

    await t.test('only https links without credentials are accepted', async () => {
      await as(writer);
      for (const url of [
        'http://drive.example.com/sop',
        'https://user:pass@drive.example.com/sop',
        'javascript:alert(1)',
        'https://',
      ])
        assert.equal(
          (await rpc('documents_save', [hotel, frontOffice, link(url)])).error,
          'INVALID_URL',
          url,
        );
      assert.equal(
        (
          await rpc('documents_save', [
            hotel,
            frontOffice,
            JSON.stringify({ title: 'X', category: 'manual', url: 'https://a.example' }),
          ])
        ).error,
        'INVALID_INPUT',
      );
    });

    await t.test('archiving needs manage, edits need the current version', async () => {
      await as(writer);
      assert.equal(
        (await rpc('documents_save', [hotel, frontOffice, null, id, 1, 'archive'])).error,
        'ACCESS_DENIED',
      );
      assert.equal(
        (await rpc('documents_save', [hotel, frontOffice, link('https://a.example'), id, 9])).error,
        'VERSION_CONFLICT',
      );
      await as(manager);
      assert.ok((await rpc('documents_save', [hotel, frontOffice, null, id, 1, 'archive'])).data);
      await as(reader);
      assert.deepEqual((await rpc('documents_list', [hotel])).data, []);
      assert.equal(
        ((await rpc('documents_list', [hotel, null, 'archived'])).data as unknown[]).length,
        1,
      );
      assert.equal(
        ((await rpc('documents_list', [hotel, null, 'all', 'policy'])).data as unknown[]).length,
        0,
      );
    });

    await t.test('other departments and switched-off modules see nothing', async () => {
      await as(outsider);
      assert.deepEqual((await rpc('documents_list', [hotel, null, 'all'])).data, []);
      assert.equal(
        (await rpc('documents_save', [hotel, frontOffice, link('https://a.example')])).error,
        'ACCESS_DENIED',
      );
      await db.exec('reset role');
      await db.exec(
        "update workstel_private.installed_modules set enabled=false where module_id='documents'",
      );
      await as(reader);
      assert.equal((await rpc('documents_list', [hotel])).error, 'ACCESS_DENIED');
    });

    await t.test('changes are audited in the documents namespace', async () => {
      await db.exec('reset role');
      const actions = (
        await db.query<{ action: string }>(
          "select distinct action||':'||outcome as action from workstel_private.audit_events where action like 'documents.%'",
        )
      ).rows.map((row) => row.action);
      for (const expected of [
        'documents.link.save:success',
        'documents.link.archive:success',
        'documents.write:denied',
        'documents.list:success',
        'documents.list:denied',
      ])
        assert.ok(actions.includes(expected), expected);
    });
  } finally {
    await db.close();
  }
});
