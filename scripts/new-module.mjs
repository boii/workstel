import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const [id, title] = process.argv.slice(2);
if (!id || !/^[a-z]+(?:-[a-z]+)*$/.test(id) || !title?.trim()) {
  console.error('Usage: npm run module:new -- <kebab-case-id> "<English title>"');
  process.exit(1);
}
const root = process.cwd();
const target = path.join(root, 'src/modules', id);
const registryPath = path.join(root, 'src/modules/registry.ts');
try {
  await access(target);
  throw new Error('Module directory already exists.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const registry = await readFile(registryPath, 'utf8');
const registryDeclaration = /export const modules\s*=\s*\[/;
const sourceTitle = /title:\s*(['"])New Module\1/;
if (!registryDeclaration.test(registry)) {
  throw new Error('Registry format is unsupported; no files were created.');
}
await mkdir(target);
await cp(path.join(root, 'src/modules/_template'), target, { recursive: true });
const manifestPath = path.join(target, 'manifest.ts');
const manifest = await readFile(manifestPath, 'utf8');
await writeFile(
  manifestPath,
  manifest
    .replaceAll('new-module', id)
    .replace(sourceTitle, () => 'title: ' + JSON.stringify(title.trim())),
);
const englishPath = path.join(target, 'locales/en.ts');
await writeFile(
  englishPath,
  (await readFile(englishPath, 'utf8')).replace(
    sourceTitle,
    () => 'title: ' + JSON.stringify(title.trim()),
  ),
);
const symbol = id.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) + 'Module';
await writeFile(
  registryPath,
  'import ' +
    symbol +
    " from './" +
    id +
    "/manifest';\n" +
    registry.replace(registryDeclaration, () => 'export const modules = [\n  ' + symbol + ','),
);
console.log(
  'Created ' +
    path.relative(root, target) +
    '. Review its manifest, translations, API and acceptance checklist.',
);
