import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import en from '../modules/vault/locales/en';
import id from '../modules/vault/locales/id';

const shellMessages = await readFile('src/i18n/index.ts', 'utf8');
const app = await readFile('src/App.vue', 'utf8');
const vault = await readFile('src/modules/vault/pages/VaultLivePage.vue', 'utf8');

function definesMessage(message: string) {
  // Both locale objects must declare the key, so neither language falls back to English.
  const occurrences = shellMessages.split('\n  ' + message + ':').length - 1;
  assert.equal(occurrences, 2, message + ' is declared in both shell locales');
}

test('shortcut copy is typed in both shell locales and rendered where it is used', () => {
  for (const key of [
    'shortcuts',
    'shortcutSearch',
    'shortcutClose',
    'shortcutHelp',
    'shortcutList',
    'skipToContent',
  ])
    definesMessage(key);
  assert.ok(app.includes("t('shortcutList')"), 'shell lists the shortcut panel entry');
  assert.ok(app.includes("t('shortcuts')"), 'shell renders the shortcut list');
  assert.ok(app.includes("t('skipToContent')"), 'shell renders the skip link');
});

test('Vault has no page shortcuts and keeps empty-state copy in both module locales', () => {
  assert.ok(en.filteredOnlyLoaded.trim(), 'filteredOnlyLoaded has English module copy');
  assert.ok(id.filteredOnlyLoaded.trim(), 'filteredOnlyLoaded has Indonesian module copy');
  assert.ok(!vault.includes('useShortcuts'), 'vault registers no keyboard shortcuts');
  assert.ok(vault.includes('FilterGroup'), 'vault filters use the shared FilterGroup');
  assert.ok(vault.includes('activeFilters'), 'the empty state explains active filters');
});

test('shortcuts never capture browser combinations or typing in fields', async () => {
  const source = await readFile('src/core/use-shortcuts.ts', 'utf8');
  for (const name of ['event.ctrlKey', 'event.metaKey', 'event.altKey'])
    assert.ok(source.includes(name), 'guard checks ' + name);
  assert.ok(source.includes('isShortcutTarget(event.target)'), 'shortcuts ignore typing');
  assert.ok(source.includes('allowInInputs'), 'Escape can opt in while a field has focus');
  assert.ok(source.includes('shortcut.when'), 'inactive shortcuts leave the key to the screen');
});

test('persisted preferences validate stored values and contain storage failures', async () => {
  const source = await readFile('src/core/use-persisted-ref.ts', 'utf8');
  assert.ok(source.includes('isValid(parsed)'), 'stored value is validated');
  assert.ok(source.includes('catch'), 'storage failures are contained');
});

test('the debounced search keeps rows on screen and aborts stale requests', async () => {
  assert.ok(vault.includes('SEARCH_DELAY'), 'search is debounced');
  assert.ok(vault.includes('clearTimeout(searchTimer)'), 'pending searches are cancelled');
  assert.ok(vault.includes('hadEntries'), 'rows survive a new search');
  assert.ok(vault.includes('controller.signal.aborted'), 'aborted requests never clear the list');
});
