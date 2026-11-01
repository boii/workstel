import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseEntries, parseAudit } from './live-api';
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
    action: 'audit.read',
    outcome: 'success',
    occurred_at: entry.created_at,
    correlation_id: id,
    unexpected: 'excluded',
  };
  assert.equal('unexpected' in parseAudit([event], hotel)[0], false);
  assert.throws(() => parseAudit([event], id));
  assert.throws(() => parseAudit([{ ...event, outcome: 'unknown' }], hotel));
});
