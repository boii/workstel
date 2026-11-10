import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMemoryHistory, createRouter } from 'vue-router';
import { routes } from './routes';

test('URLs restore shell, module, detail and unknown pages with back/forward support', async () => {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: routes.map((route) => ({
      path: route.path,
      name: route.name,
      meta: route.meta,
      component: { render: () => null },
    })),
  });
  await router.push(
    '/vault/accounts/11111111-1111-4111-8111-111111111111?hotel=hotel-a&status=archived',
  );
  assert.equal(router.currentRoute.value.meta.view, 'Password Vault');
  assert.equal(router.currentRoute.value.params.accountId, '11111111-1111-4111-8111-111111111111');
  assert.equal(router.currentRoute.value.query.status, 'archived');
  await router.push('/settings');
  assert.equal(router.currentRoute.value.meta.view, 'Settings');
  const back = new Promise<void>((resolve) => {
    const remove = router.afterEach(() => {
      remove();
      resolve();
    });
  });
  router.back();
  await back;
  assert.equal(router.currentRoute.value.name, 'vault-account');
  const forward = new Promise<void>((resolve) => {
    const remove = router.afterEach(() => {
      remove();
      resolve();
    });
  });
  router.forward();
  await forward;
  assert.equal(router.currentRoute.value.meta.view, 'Settings');
  await router.push('/admin/audit');
  assert.equal(router.currentRoute.value.meta.view, 'Audit log');
  await router.push('/casual-attendance/me');
  assert.equal(router.currentRoute.value.name, 'casual-attendance-me');
  assert.equal(router.currentRoute.value.meta.moduleId, 'casual-attendance');
  await router.push('/unknown-module');
  assert.equal(router.currentRoute.value.name, 'not-found');
});
