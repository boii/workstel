import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
test('generator registers a module, preserves title safely and rejects duplicates', async () => {
  const fixture = await mkdtemp(path.join(tmpdir(), 'workstel-module-test-'));
  try {
    await mkdir(path.join(fixture, 'src/modules'), { recursive: true });
    await cp('src/modules/_template', path.join(fixture, 'src/modules/_template'), {
      recursive: true,
    });
    await writeFile(path.join(fixture, 'src/modules/registry.ts'), 'export const modules=[];');
    const script = path.resolve('scripts/new-module.mjs'),
      title = 'Linen "Transfer"';
    execFileSync(process.execPath, [script, 'linen-transfer', title], { cwd: fixture });
    const manifest = await readFile(
      path.join(fixture, 'src/modules/linen-transfer/manifest.ts'),
      'utf8',
    );
    assert.match(manifest, /id:\s*['" ]linen-transfer['" ]/);
    assert.ok(manifest.includes(JSON.stringify(title)));
    assert.ok(manifest.includes('linen-transfer:read'));
    const registry = await readFile(path.join(fixture, 'src/modules/registry.ts'), 'utf8');
    assert.ok(registry.includes("import linenTransferModule from './linen-transfer/manifest'"));
    assert.throws(() =>
      execFileSync(process.execPath, [script, 'linen-transfer', title], {
        cwd: fixture,
        stdio: 'pipe',
      }),
    );
    assert.equal(await readFile(path.join(fixture, 'src/modules/registry.ts'), 'utf8'), registry);
    assert.throws(() =>
      execFileSync(process.execPath, [script, '../escape', 'Invalid'], {
        cwd: fixture,
        stdio: 'pipe',
      }),
    );
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});
