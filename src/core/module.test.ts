import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defineModule, validateModules } from './module';
import type { ModuleManifest } from './module';
function manifest(overrides: Partial<ModuleManifest> = {}): ModuleManifest {
  return {
    id: 'inventory',
    version: '1.0.0',
    title: 'Inventory',
    description: 'Track stock.',
    category: 'Operations',
    color: 'mint',
    permissions: ['inventory:read'],
    publishes: ['inventory.updated.v1'],
    subscribes: [],
    ...overrides,
  };
}
test('module contracts reject cross-module permission and publisher namespaces', () => {
  assert.throws(() => defineModule(manifest({ permissions: ['other:write'] })), /namespace/);
  assert.throws(() => defineModule(manifest({ publishes: ['other.updated.v1'] })), /namespace/);
});
test('event subscriptions need a registered publisher and unique module identity', () => {
  const publisher = manifest();
  assert.throws(() => validateModules([publisher, publisher]), /Duplicate module ID/);
  assert.throws(
    () => validateModules([manifest({ subscribes: ['missing.updated.v1'] })]),
    /No registered publisher/,
  );
  assert.doesNotThrow(() =>
    validateModules([
      publisher,
      manifest({
        id: 'reports',
        permissions: ['reports:read'],
        publishes: [],
        subscribes: ['inventory.updated.v1'],
      }),
    ]),
  );
});
test('defined manifests snapshot permission arrays instead of sharing mutable input', () => {
  const permissions = ['inventory:read'];
  const result = defineModule(manifest({ permissions }));
  permissions.push('inventory:write');
  assert.deepEqual(result.permissions, ['inventory:read']);
  assert.ok(Object.isFrozen(result.permissions));
});
test('manifest validation rejects invalid versions and unversioned events', () => {
  assert.throws(
    () => defineModule(manifest({ version: 'invalid' as ModuleManifest['version'] })),
    /semver/,
  );
  assert.throws(
    () => defineModule(manifest({ publishes: ['inventory.updated'] })),
    /module.action.vN/,
  );
});
