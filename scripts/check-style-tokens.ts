import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { checkStyleFile } from './style-tokens';

async function files(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name).split('\\').join('/');
    if (entry.isDirectory()) out.push(...(await files(path)));
    else if (/\.(css|vue)$/.test(entry.name)) out.push(path);
  }
  return out;
}

let total = 0;
for (const path of (await files('src')).sort()) {
  for (const violation of checkStyleFile(path, await readFile(path, 'utf8'))) {
    total++;
    console.error(`${path}:${violation.line}  ${violation.rule}\n    ${violation.text}`);
  }
}
if (total) {
  console.error(
    `\n${total} style value(s) or component(s) should use the shared tokens and primitives` +
      ' (docs/MODULE_STANDARD.md, docs/DESIGN_REFERENCE.md).' +
      '\nFor a documented exception add a comment: token-exempt: <reason>.',
  );
  process.exit(1);
}
console.log('Style values use the shared tokens.');
