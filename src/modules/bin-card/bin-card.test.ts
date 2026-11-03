import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModuleRequestError } from '../../core/module-rpc';
import { createDemoBinCardApi } from './demo-api';
import { parseEntries, parseItems } from './live-api';
import { entryDelta, parseQuantity, stockLevel, validateEntry, validateItem } from './validation';

const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('quantities accept up to three decimals with a dot or comma', () => {
  assert.equal(parseQuantity('12,5'), 12.5);
  assert.equal(parseQuantity('0.125'), 0.125);
  assert.equal(parseQuantity('1.2345'), undefined);
  assert.equal(parseQuantity('-1'), undefined);
  assert.equal(entryDelta('adjustment', 0.3, 0.1), 0.2);
});

test('entry validation mirrors server balance rules', () => {
  const entry = { reference: '', notes: '' };
  assert.equal(
    validateEntry({ ...entry, type: 'issue', quantity: '7' }, 6).quantity,
    'insufficientStock',
  );
  assert.equal(
    validateEntry({ ...entry, type: 'receipt', quantity: '0' }, 6).quantity,
    'invalidQuantity',
  );
  assert.equal(
    validateEntry({ ...entry, type: 'adjustment', quantity: '6' }, 6).quantity,
    'noChange',
  );
  assert.deepEqual(validateEntry({ ...entry, type: 'adjustment', quantity: '0' }, 6), {});
  assert.equal(
    validateItem({
      code: 'bad code',
      name: 'Towel',
      unit: 'pcs',
      location: '',
      minQuantity: 'x',
      departmentId: 'd',
    }).code,
    'invalidCode',
  );
  assert.equal(stockLevel({ balance: 0, minQuantity: 0 }), 'out');
  assert.equal(stockLevel({ balance: 5, minQuantity: 5 }), 'low');
  assert.equal(stockLevel({ balance: 6, minQuantity: 5 }), 'ok');
});

test('bin card responses are validated before display', () => {
  const row = {
    id: itemId,
    hotel_id: hotel,
    department_id: 'd',
    department_name: 'Front Office',
    code: 'LIN-01',
    name: 'Bath towel',
    unit: 'pcs',
    location: '',
    min_quantity: 5,
    balance: 82.5,
    status: 'active',
    version: 2,
    updated_at: '2026-11-04T01:00:00Z',
  };
  assert.equal(parseItems([row], hotel)[0].balance, 82.5);
  assert.throws(() => parseItems([{ ...row, balance: -1 }], hotel), ModuleRequestError);
  assert.throws(() => parseItems([{ ...row, unit: 'crate' }], hotel), ModuleRequestError);
  const entry = {
    id: 'e',
    item_id: itemId,
    entry_type: 'issue',
    quantity: -4,
    balance_after: 6,
    reference: 'REQ-1',
    notes: '',
    created_at: '2026-11-04T01:00:00Z',
    created_by_email: null,
  };
  assert.equal(parseEntries([entry], itemId)[0].quantity, -4);
  assert.throws(
    () => parseEntries([{ ...entry, entry_type: 'transfer' }], itemId),
    ModuleRequestError,
  );
});

test('demo ledger keeps balances consistent and idempotent', async () => {
  const api = createDemoBinCardApi();
  const [item] = (
    await api.listItems({
      hotelId: 'demo-hotel',
      departmentId: null,
      status: 'active',
      search: 'towel',
      lowOnly: false,
      after: null,
    })
  ).data;
  const key = crypto.randomUUID();
  const input = { type: 'issue' as const, quantity: 20, reference: '', notes: '' };
  const first = await api.recordEntry('demo-hotel', item.id, input, key);
  const again = await api.recordEntry('demo-hotel', item.id, input, key);
  assert.equal(first.balance, item.balance - 20);
  assert.deepEqual(again, first);
  await assert.rejects(
    api.recordEntry('demo-hotel', item.id, { ...input, quantity: 1000 }, crypto.randomUUID()),
    (error: unknown) => error instanceof ModuleRequestError && error.code === 'INSUFFICIENT_STOCK',
  );
  await assert.rejects(
    api.setArchived('demo-hotel', item, true),
    (error: unknown) => error instanceof ModuleRequestError && error.code === 'BALANCE_NOT_ZERO',
  );
});
