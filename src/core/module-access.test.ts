import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canUseModule, noModuleAccess, parseModuleAccess } from './module-access';

const row = {
  moduleId: 'vehicle',
  hotelId: 'h',
  hotelName: 'Hotel',
  departmentId: 'd',
  departmentCode: 'front-office',
  departmentName: 'Front Office',
  canRead: true,
  canWrite: false,
  canManage: false,
};

test('module access opens only installed modules with read access', () => {
  const access = parseModuleAccess({ data: [row], meta: { installedModules: ['vehicle'] } });
  assert.equal(canUseModule(access, 'vehicle'), true);
  assert.equal(canUseModule(access, 'bin-card'), false);
});

test('malformed or older-server responses fail closed', () => {
  assert.deepEqual(parseModuleAccess(null), noModuleAccess);
  assert.deepEqual(parseModuleAccess({ data: [row] }), noModuleAccess);
  assert.deepEqual(
    parseModuleAccess({
      data: [{ ...row, canRead: 'yes' }],
      meta: { installedModules: ['vehicle'] },
    }),
    noModuleAccess,
  );
  // A grant for a module the server does not report as installed is rejected.
  assert.deepEqual(
    parseModuleAccess({ data: [row], meta: { installedModules: ['bin-card'] } }),
    noModuleAccess,
  );
});
