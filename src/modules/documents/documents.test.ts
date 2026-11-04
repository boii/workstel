import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModuleRequestError } from '../../core/module-rpc';
import { createDemoDocumentsApi } from './demo-api';
import { parseDocuments } from './live-api';
import { isSafeLink, validateDocument } from './validation';

const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const row = {
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  hotel_id: hotel,
  department_id: 'd',
  department_name: 'Front Office',
  title: 'Check-in SOP',
  category: 'sop',
  url: 'https://drive.example.com/sop',
  description: '',
  status: 'active',
  version: 1,
  updated_at: '2026-11-04T01:00:00Z',
};

test('only https links without credentials are safe', () => {
  assert.equal(isSafeLink('https://drive.example.com/a?b=1'), true);
  for (const url of [
    'http://a.example',
    'javascript:alert(1)',
    'https://u:p@a.example',
    'ftp://a',
    '',
  ])
    assert.equal(isSafeLink(url), false, url);
  assert.deepEqual(
    validateDocument({
      title: ' ',
      category: 'sop',
      url: 'http://x.example',
      description: '',
      departmentId: '',
    }),
    { title: 'required', url: 'invalidUrl', departmentId: 'required' },
  );
});

test('document responses are validated before links are shown', () => {
  assert.equal(parseDocuments([row], hotel)[0].title, 'Check-in SOP');
  assert.throws(
    () => parseDocuments([{ ...row, url: 'javascript:alert(1)' }], hotel),
    ModuleRequestError,
  );
  assert.throws(() => parseDocuments([{ ...row, category: 'secret' }], hotel), ModuleRequestError);
  assert.throws(() => parseDocuments([{ ...row, hotel_id: 'other' }], hotel), ModuleRequestError);
});

test('demo library filters, rejects unsafe links and archives', async () => {
  const api = createDemoDocumentsApi();
  const query = {
    hotelId: 'demo-hotel',
    departmentId: null,
    status: 'active' as const,
    category: null,
    search: '',
    after: null,
  };
  const all = (await api.list(query)).data;
  assert.equal(all.length, 4);
  assert.equal((await api.list({ ...query, category: 'policy' })).data.length, 1);
  await assert.rejects(
    api.save('demo-hotel', {
      title: 'X',
      category: 'sop',
      url: 'http://x.example',
      description: '',
      departmentId: 'front-office',
    }),
    (error: unknown) => error instanceof ModuleRequestError && error.code === 'INVALID_URL',
  );
  await api.setArchived('demo-hotel', all[0], true);
  assert.equal((await api.list(query)).data.length, 3);
});
