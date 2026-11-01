import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { modules } from '../src/modules/registry';
import { validateModules } from '../src/core/module';
validateModules(modules);
assert.throws(() => validateModules([modules[0], modules[0]]), /Duplicate module ID/);
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
  assert.deepEqual(
    Object.keys(en).sort(),
    Object.keys(id).sort(),
    folder.name + ': locale keys must match',
  );
  assert.ok(
    Object.values(en).every((value) => typeof value === 'string' && value.trim()),
    'English messages must not be empty',
  );
  assert.ok(
    Object.values(id).every((value) => typeof value === 'string' && value.trim()),
    'Indonesian messages must not be empty',
  );
  if (folder.name !== '_template')
    assert.ok(
      modules.some((module) => module.id === folder.name),
      'Unregistered module: ' + folder.name,
    );
}
console.log('Module manifests, scaffold structure and locale keys are valid.');
