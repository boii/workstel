import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModuleRequestError } from './module-rpc';
import {
  createDemoModuleSwitch,
  createLiveModuleSwitch,
  demoDisabledModules,
  parseModuleStates,
} from './module-switch';

test('module states are validated before display', () => {
  const row = {
    moduleId: 'vehicle',
    schemaVersion: 1,
    enabled: false,
    updatedAt: '2026-11-04T01:00:00Z',
    updatedByEmail: 'dev@example.com',
  };
  assert.equal(parseModuleStates([row])[0].enabled, false);
  assert.throws(() => parseModuleStates([{ ...row, enabled: 'no' }]), ModuleRequestError);
  assert.throws(() => parseModuleStates({}), ModuleRequestError);
});

test('live switch rejects a server answer for another module or state', async () => {
  const api = createLiveModuleSwitch(async () => ({
    data: { moduleId: 'bin-card', enabled: false },
  }));
  await assert.rejects(api.setEnabled('vehicle', false), ModuleRequestError);
});

test('demo switch drives the shared disabled list and records the change', async () => {
  demoDisabledModules.value = [];
  const api = createDemoModuleSwitch(['vehicle', 'bin-card']);
  await api.setEnabled('vehicle', false);
  assert.deepEqual(demoDisabledModules.value, ['vehicle']);
  const states = await api.list();
  assert.equal(states.find((state) => state.moduleId === 'vehicle')?.enabled, false);
  assert.ok(states.find((state) => state.moduleId === 'vehicle')?.updatedAt);
  await api.setEnabled('vehicle', true);
  assert.deepEqual(demoDisabledModules.value, []);
});
