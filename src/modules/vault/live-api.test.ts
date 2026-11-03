import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEntries, parseAudit, findAccount } from './live-api';
const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const id = '11111111-1111-4111-8111-111111111111';
const entry = {
  owner_id: id,
  is_owner: true,
  can_edit: true,
  can_archive: true,
  id,
  hotel_id: hotel,
  department_code: 'it',
  name: 'Private account',
  username: 'operator',
  website: '',
  notes: '',
  status: 'active',
  version: 1,
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
  created_by: id,
  updated_by: id,
};
test('metadata parser rejects cross-hotel data, duplicate IDs and malformed concurrency values', () => {
  assert.equal(parseEntries([entry], hotel)[0].name, entry.name);
  assert.throws(() => parseEntries([entry], id));
  assert.throws(() => parseEntries([entry, entry], hotel));
  for (const change of [
    { version: 0 },
    { version: 1.5 },
    { updated_at: 'invalid' },
    { department_code: 'unknown' },
  ])
    assert.throws(() => parseEntries([{ ...entry, ...change }], hotel));
});
test('audit parser rejects unscoped or malformed responses and allowlists output fields', () => {
  const event = {
    id,
    actor_id: id,
    actor_database_role: 'authenticated',
    hotel_id: hotel,
    department_id: null,
    resource_id: null,
    action: 'vault.audit.read',
    outcome: 'success',
    occurred_at: entry.created_at,
    correlation_id: id,
    unexpected: 'excluded',
  };
  assert.equal('unexpected' in parseAudit([event], hotel)[0], false);
  for (const action of [
    'audit.read',
    'session.access',
    'staff.access.update',
    'admin.bootstrap',
    'stock-transfer.create',
    'vaultish.read',
  ])
    assert.throws(() => parseAudit([{ ...event, action }], hotel));
  assert.throws(() => parseAudit([event], id));
  assert.throws(() => parseAudit([{ ...event, outcome: 'unknown' }], hotel));
});

test('detail restoration follows authorized pagination and rejects foreign scope, cycles and cancellation', async () => {
  const signal = new AbortController().signal;
  const earlier = '00000000-0000-4000-8000-000000000000';
  let calls = 0;
  const found = await findAccount(hotel, id, signal, async (_name, args) => {
    assert.equal(args.p_hotel_id, hotel);
    assert.equal(args.p_status, 'all');
    calls++;
    if (calls === 1) return { data: [{ ...entry, id: earlier }], meta: { nextCursor: earlier } };
    assert.equal(args.p_after, earlier);
    return { data: [entry], meta: {} };
  });
  assert.equal(found?.id, id);
  assert.equal(calls, 2);
  assert.equal(
    await findAccount(hotel, 'invalid', signal, async () => {
      throw Error('Must not call');
    }),
    null,
  );
  assert.equal(await findAccount(hotel, id, signal, async () => ({ data: [], meta: {} })), null);
  await assert.rejects(
    findAccount(hotel, id, signal, async () => ({ data: [{ ...entry, hotel_id: id }] })),
  );
  await assert.rejects(
    findAccount(hotel, id, signal, async () => ({ data: [], meta: { nextCursor: earlier } })),
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(findAccount(hotel, id, controller.signal));
  let pages = 0;
  await assert.rejects(
    findAccount(hotel, id, signal, async () => {
      pages++;
      return {
        data: [],
        meta: { nextCursor: '00000000-0000-4000-8000-' + String(pages).padStart(12, '0') },
      };
    }),
  );
  assert.equal(pages, 20);
});
