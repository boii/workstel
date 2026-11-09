import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import adminEn from '../src/admin/locales/en';
import adminId from '../src/admin/locales/id';
import { english, indonesian } from '../src/i18n';
import { modules } from '../src/modules/registry';
import { validateModules } from '../src/core/module';
validateModules(modules);
assert.throws(() => validateModules([modules[0], modules[0]]), /Duplicate module ID/);

function assertLocalePair(name: string, en: Record<string, unknown>, id: Record<string, unknown>) {
  assert.deepEqual(
    Object.keys(en).sort(),
    Object.keys(id).sort(),
    name + ': locale keys must match',
  );
  assert.ok(
    Object.values(en).every((value) => typeof value === 'string' && value.trim()),
    name + ': English messages must not be empty',
  );
  assert.ok(
    Object.values(id).every((value) => typeof value === 'string' && value.trim()),
    name + ': Indonesian messages must not be empty',
  );
}

assertLocalePair('i18n', english, indonesian);
assertLocalePair('admin', adminEn, adminId);

const required = [
  'manifest.ts',
  'types.ts',
  'api.ts',
  'pages/ModuleListPage.vue',
  'locales/en.ts',
  'locales/id.ts',
  'README.md',
  'ACCEPTANCE.md',
];
for (const folder of await readdir('src/modules', { withFileTypes: true })) {
  if (!folder.isDirectory()) continue;
  for (const file of required) await readFile('src/modules/' + folder.name + '/' + file);
  const en = (await import('../src/modules/' + folder.name + '/locales/en.ts')).default;
  const id = (await import('../src/modules/' + folder.name + '/locales/id.ts')).default;
  assertLocalePair(folder.name, en, id);
  if (folder.name !== '_template')
    assert.ok(
      modules.some((module) => module.id === folder.name),
      'Unregistered module: ' + folder.name,
    );
}

async function listTestFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const found: string[] = [];
  for (const entry of entries) {
    const path = dir + '/' + entry.name;
    if (entry.isDirectory()) found.push(...(await listTestFiles(path)));
    else if (/\.test\.(ts|mjs)$/.test(entry.name)) found.push(path);
  }
  return found;
}

const pkg = JSON.parse(await readFile('package.json', 'utf8')) as {
  scripts?: Record<string, string>;
};
const testScript = (pkg.scripts?.test ?? '') + ' ' + (pkg.scripts?.['modules:test'] ?? '');
for (const root of ['scripts', 'src', 'supabase/tests', 'backend']) {
  for (const testFile of await listTestFiles(root)) {
    assert.ok(
      testScript.includes(testFile),
      `Test file missing from package.json test script: ${testFile}`,
    );
  }
}

console.log(
  'Module manifests, scaffold structure, locale keys and test runner coverage are valid.',
);
