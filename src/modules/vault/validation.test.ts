import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateEntry, normalizeEntry, safeWebsiteUrl } from './validation';
import { useVault } from './composables/useVault';
import type { VaultEntryInput } from './types';
import { isModuleEnabled } from '../../core/module';
import { modules } from '../registry';
const input: VaultEntryInput = {
  name: ' Sample account ',
  username: ' user@example.com ',
  website: 'https://service.example.com',
  notes: ' Sample note ',
  departmentId: 'it',
};
test('vault rejects unsafe websites and requires metadata without accepting a password field', () => {
  for (const website of [
    'javascript:alert(1)',
    'http://service.example.com',
    'https://user:pass@example.com',
  ]) {
    assert.equal(validateEntry({ ...input, website }).website, 'invalidUrl');
    assert.equal(safeWebsiteUrl(website), null);
  }
  assert.equal(
    safeWebsiteUrl('https://service.example.com/login')?.hostname,
    'service.example.com',
  );
  assert.equal(validateEntry({ ...input, name: ' ' }).name, 'required');
  assert.deepEqual(validateEntry(input), {});
  assert.equal(normalizeEntry(input).name, 'Sample account');
});
test('metadata preview supports edit/archive/restore without persisting secret values', () => {
  const vault = useVault();
  const { entry } = vault.save(input);
  assert.ok(entry);
  const edited = vault.save({ ...input, name: 'Name entered by the user' }, entry.id).entry;
  assert.equal(edited?.name, 'Name entered by the user');
  vault.setStatus(entry.id, 'archived');
  vault.setStatus(entry.id, 'archived');
  assert.equal(entry.status, 'archived');
  assert.equal(vault.activity.value.filter((item) => item.action === 'archived').length, 1);
  vault.setStatus(entry.id, 'active');
  assert.equal(entry.status, 'active');
  assert.equal(entry.secretStatus, 'not-connected');
  assert.ok(!('password' in entry));
  assert.equal(vault.activity.value.length, 4);
  vault.reset();
  assert.equal(vault.entries.value.length, 0);
});
test('only implemented modules can be opened while the rest stay disabled', () => {
  assert.deepEqual(
    modules.filter(isModuleEnabled).map((module) => module.id),
    ['vault', 'bin-card', 'vehicle', 'room-turnaround', 'sales-crm', 'documents'],
  );
});
