<script setup lang="ts">
import { dialogWidth } from '../shared/dialog-widths';
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../shared/module-dialog.vue';
import { t, translate } from '../i18n';
import type { MessageKey } from '../i18n';
import { modules as registry } from '../modules/registry';
import { moduleLevels } from './users-api';
import type {
  DepartmentRef,
  Membership,
  ModuleLevel,
  OwnedVaultAccount,
  UserRecord,
  UsersApi,
  VaultTransferResult,
} from './users-api';
import { userErrorKey } from './user-errors';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  user: UserRecord | null;
  users: UserRecord[];
  departments: DepartmentRef[];
  modules: string[];
  selfId: string;
  api: UsersApi;
  /** Reloads the directory; resolves once the props carry the saved state. */
  reload: () => Promise<void>;
}>();
const emit = defineEmits<{
  changed: [message: MessageKey];
  failed: [message: MessageKey];
  temporaryPassword: [email: string, password: string];
}>();

const busy = ref(false);
// Access changes save as they are made. Each department (and the developer role) saves on
// its own; it stays locked until the reloaded directory carries the change, so the next
// change there never starts from stale values.
const pending = ref(new Set<string>());
const saved = ref(false);
const status = computed(() =>
  t(pending.value.size ? 'userSaving' : saved.value ? 'userAllSaved' : 'userAutosave'),
);
const confirm = ref<'block' | 'reset' | 'vault' | null>(null);
// Vault offboarding: what the user owns, and where it should go.
const owned = ref<OwnedVaultAccount[] | null>(null);
const vaultTarget = ref<string | null>(null);
const vaultResult = ref<VaultTransferResult | null>(null);
async function loadOwned() {
  owned.value = null;
  vaultResult.value = null;
  vaultTarget.value = null;
  const user = props.user;
  if (!user) return;
  try {
    const accounts = await props.api.ownedVaultAccounts(user.id);
    if (props.user?.id === user.id) owned.value = accounts;
  } catch {
    if (props.user?.id === user.id) owned.value = null;
  }
}
// Separate sources compare by value, so a list refresh for the same user keeps the result shown.
watch(
  [() => open.value, () => props.user?.id],
  ([isOpen]) => {
    if (isOpen) void loadOwned();
    saved.value = false;
  },
  { immediate: true },
);
const targets = computed(() =>
  props.users
    .filter((u) => u.id !== props.user?.id && !u.blocked)
    .map((u) => ({ value: u.id, title: u.email })),
);
async function transferVault() {
  const user = props.user;
  const target = vaultTarget.value;
  if (!user || !target || busy.value) return;
  busy.value = true;
  try {
    vaultResult.value = await props.api.transferVaultAccounts(user.id, target);
    owned.value = await props.api.ownedVaultAccounts(user.id);
    emit('changed', 'userSaved');
  } catch (error) {
    emit('failed', userErrorKey(error));
  } finally {
    busy.value = false;
  }
}
const isSelf = computed(() => props.user?.id === props.selfId);
const multiHotel = computed(() => new Set(props.departments.map((d) => d.hotelId)).size > 1);
const levelKeys: Record<ModuleLevel, MessageKey> = {
  none: 'levelNone',
  read: 'levelRead',
  write: 'levelWrite',
  manage: 'levelManage',
};
const levelItems = computed(() =>
  moduleLevels.map((level) => ({ value: level, title: t(levelKeys[level]) })),
);
const vaultFlags: [keyof Omit<Membership, 'departmentId' | 'enabled'>, MessageKey][] = [
  ['canRead', 'permRead'],
  ['canWrite', 'permWrite'],
  ['canArchive', 'permArchive'],
  ['canAudit', 'permAudit'],
];
const moduleTitle = (id: string) => translate(registry.find((m) => m.id === id)?.title ?? id);
function membership(departmentId: string): Membership {
  return (
    props.user?.memberships.find((m) => m.departmentId === departmentId) ?? {
      departmentId,
      enabled: false,
      canRead: false,
      canWrite: false,
      canArchive: false,
      canAudit: false,
    }
  );
}
function level(departmentId: string, moduleId: string): ModuleLevel {
  return (
    props.user?.moduleGrants.find((g) => g.departmentId === departmentId && g.moduleId === moduleId)
      ?.level ?? 'none'
  );
}

async function run(action: () => Promise<void>) {
  if (busy.value || !props.user) return;
  busy.value = true;
  try {
    await action();
    emit('changed', 'userSaved');
  } catch (error) {
    emit('failed', userErrorKey(error));
  } finally {
    busy.value = false;
  }
}
async function save(key: string, action: () => Promise<void>) {
  if (busy.value || pending.value.has(key) || !props.user) return;
  pending.value = new Set(pending.value).add(key);
  try {
    await action();
    saved.value = true;
  } catch (error) {
    saved.value = false;
    emit('failed', userErrorKey(error));
  } finally {
    await props.reload();
    const rest = new Set(pending.value);
    rest.delete(key);
    pending.value = rest;
  }
}
const locked = (key: string) => busy.value || pending.value.has(key);
function setMember(departmentId: string, enabled: boolean) {
  const current = membership(departmentId);
  // A new membership starts read-only for Vault; developers widen it explicitly.
  const fresh = !props.user?.memberships.some((m) => m.departmentId === departmentId);
  void save(departmentId, () =>
    props.api.setMembership(props.user!.id, departmentId, {
      enabled,
      canRead: fresh ? true : current.canRead,
      canWrite: current.canWrite,
      canArchive: current.canArchive,
      canAudit: current.canAudit,
    }),
  );
}
function setFlag(departmentId: string, flag: (typeof vaultFlags)[number][0], value: boolean) {
  const { enabled, canRead, canWrite, canArchive, canAudit } = membership(departmentId);
  const current = { enabled, canRead, canWrite, canArchive, canAudit };
  void save(departmentId, () =>
    props.api.setMembership(props.user!.id, departmentId, { ...current, [flag]: value }),
  );
}
function setLevel(departmentId: string, moduleId: string, value: ModuleLevel) {
  void save(departmentId, () =>
    props.api.setModuleLevel(props.user!.id, departmentId, moduleId, value),
  );
}
function setDeveloper(value: boolean) {
  void save('developer', () => props.api.setDeveloper(props.user!.id, value));
}
// Unblocking restores sign-in and needs no confirmation; blocking does.
function unblock() {
  void run(() => props.api.setBlocked(props.user!.id, false));
}
async function confirmAction() {
  const action = confirm.value;
  confirm.value = null;
  const user = props.user;
  if (!user || !action) return;
  if (action === 'vault') {
    await transferVault();
    return;
  }
  if (action === 'block') {
    await run(() => props.api.setBlocked(user.id, !user.blocked));
    return;
  }
  busy.value = true;
  try {
    const { temporaryPassword } = await props.api.resetPassword(user.id);
    emit('temporaryPassword', user.email, temporaryPassword);
    emit('changed', 'userSaved');
  } catch (error) {
    emit('failed', userErrorKey(error));
  } finally {
    busy.value = false;
  }
}
</script>
<template>
  <ModuleDialog
    v-model="open"
    fullscreen
    :title="user?.email ?? ''"
    :subtitle="status"
    :busy="busy || pending.size > 0"
    :width="dialogWidth['4xl']"
  >
    <template v-if="user">
      <section
        class="user-section"
        aria-labelledby="user-departments"
      >
        <h3 id="user-departments">{{ t('userDepartmentAccess') }}</h3>
        <ul class="user-departments">
          <li
            v-for="department in departments"
            :key="department.id"
            :class="{ 'user-department--off': !membership(department.id).enabled }"
          >
            <div class="user-department-head">
              <strong :id="'dept-' + department.id">
                {{ department.name }}
                <small v-if="multiHotel">{{ department.hotelName }}</small>
              </strong>
              <v-switch
                :model-value="membership(department.id).enabled"
                :disabled="locked(department.id)"
                :loading="pending.has(department.id) ? 'primary' : false"
                color="primary"
                inset
                hide-details
                density="compact"
                :label="t('userMember')"
                @update:model-value="(value) => setMember(department.id, !!value)"
              />
            </div>
            <div
              v-if="membership(department.id).enabled"
              class="user-department-body"
            >
              <div
                class="user-vault"
                role="group"
                :aria-label="t('userVault') + ' — ' + department.name"
              >
                <span class="user-label">{{ t('userVault') }}</span>
                <v-checkbox
                  v-for="[flag, key] in vaultFlags"
                  :key="flag"
                  :model-value="membership(department.id)[flag]"
                  :label="t(key)"
                  :disabled="locked(department.id)"
                  color="primary"
                  density="compact"
                  hide-details
                  @update:model-value="(value) => setFlag(department.id, flag, !!value)"
                />
              </div>
              <div class="user-modules">
                <v-select
                  v-for="moduleId in modules"
                  :key="moduleId"
                  :model-value="level(department.id, moduleId)"
                  :items="levelItems"
                  :label="moduleTitle(moduleId)"
                  :disabled="locked(department.id)"
                  @update:model-value="(value) => setLevel(department.id, moduleId, value)"
                />
              </div>
            </div>
          </li>
        </ul>
      </section>

      <section
        class="user-section"
        aria-labelledby="user-role"
      >
        <h3 id="user-role">{{ t('userRole') }}</h3>
        <div class="user-row">
          <div class="user-row-text">
            <strong>{{ t('userDeveloperRole') }}</strong>
            <small>{{ t('userDeveloperHint') }}</small>
          </div>
          <v-switch
            :model-value="user.developer"
            :disabled="locked('developer') || (isSelf && user.developer)"
            :loading="pending.has('developer') ? 'primary' : false"
            color="primary"
            inset
            hide-details
            density="compact"
            :aria-label="t('userDeveloperRole')"
            @update:model-value="(value) => setDeveloper(!!value)"
          />
        </div>
      </section>

      <section
        class="user-section"
        aria-labelledby="user-security"
      >
        <h3 id="user-security">{{ t('userSecurity') }}</h3>
        <div class="user-actions">
          <v-btn
            variant="tonal"
            prepend-icon="mdi-lock-reset"
            :disabled="busy || isSelf"
            @click="confirm = 'reset'"
            >{{ t('userResetPassword') }}</v-btn
          ><v-btn
            variant="tonal"
            :color="user.blocked ? 'primary' : 'error'"
            :prepend-icon="
              user.blocked ? 'mdi-account-check-outline' : 'mdi-account-cancel-outline'
            "
            :disabled="busy || isSelf"
            @click="user.blocked ? unblock() : (confirm = 'block')"
            >{{ t(user.blocked ? 'userUnblock' : 'userBlock') }}</v-btn
          >
        </div>
        <p
          v-if="isSelf"
          class="user-note"
        >
          {{ t('userErrorSelf') }}
        </p>
      </section>

      <section
        v-if="owned"
        class="user-section"
        aria-labelledby="user-vault"
      >
        <h3 id="user-vault">{{ t('userVaultTitle') }}</h3>
        <p
          v-if="!owned.length"
          class="user-note"
        >
          {{ t('userVaultNone') }}
        </p>
        <template v-else>
          <p class="user-vault-count">
            {{ t('userVaultCount') }} <strong>{{ owned.length }}</strong>
          </p>
          <ul class="user-vault-list">
            <li
              v-for="account in owned.slice(0, 5)"
              :key="account.id"
            >
              {{ account.name }} <small>· {{ account.departmentName }}</small>
            </li>
            <li v-if="owned.length > 5">
              <small>+{{ owned.length - 5 }} {{ t('userVaultMore') }}</small>
            </li>
          </ul>
          <p class="user-note">{{ t('userVaultTransferHint') }}</p>
          <div class="user-vault-transfer">
            <v-select
              v-model="vaultTarget"
              :items="targets"
              :label="t('userVaultTransferTo')"
              :disabled="busy"
            />
            <v-btn
              variant="tonal"
              prepend-icon="mdi-account-switch-outline"
              :disabled="busy || !vaultTarget"
              @click="confirm = 'vault'"
              >{{ t('userVaultTransfer') }}</v-btn
            >
          </div>
        </template>
        <div
          v-if="vaultResult"
          class="user-vault-result"
          role="status"
        >
          <p>
            {{ t('userVaultTransferred') }} <strong>{{ vaultResult.transferred }}</strong>
          </p>
          <template v-if="vaultResult.skipped.length">
            <p>{{ t('userVaultSkipped') }}</p>
            <ul>
              <li
                v-for="item in vaultResult.skipped"
                :key="item.id"
              >
                {{ item.name }} <small>· {{ item.departmentName }}</small>
              </li>
            </ul>
          </template>
        </div>
      </section>
    </template>
    <ModuleDialog
      :model-value="!!confirm"
      :title="
        t(
          confirm === 'block'
            ? 'userConfirmBlockTitle'
            : confirm === 'vault'
              ? 'userVaultConfirmTitle'
              : 'userConfirmResetTitle',
        )
      "
      :confirm-label="
        t(
          confirm === 'block'
            ? 'userBlock'
            : confirm === 'vault'
              ? 'userVaultTransfer'
              : 'userResetPassword',
        )
      "
      :destructive="confirm === 'block'"
      @update:model-value="confirm = null"
      @confirm="confirmAction"
    >
      <p>
        <strong>{{ user?.email }}</strong> —
        {{
          t(
            confirm === 'block'
              ? 'userConfirmBlockBody'
              : confirm === 'vault'
                ? 'userVaultConfirmBody'
                : 'userConfirmResetBody',
          )
        }}
      </p>
      <p
        v-if="confirm === 'block' && owned && owned.length"
        class="user-confirm-warning"
      >
        {{ t('userVaultBlockWarning') }} <strong>{{ owned.length }}</strong>
      </p>
    </ModuleDialog>
  </ModuleDialog>
</template>
<style scoped>
.user-section + .user-section {
  margin-top: var(--workstel-space-5);
  padding-top: var(--workstel-space-4);
  border-top: 1px solid var(--workstel-border);
}
.user-section h3 {
  font-size: var(--workstel-font-md);
  font-weight: var(--workstel-weight-semibold);
  margin-bottom: var(--workstel-space-2);
}
.user-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--workstel-space-3);
}
.user-row-text {
  display: flex;
  flex-direction: column;
  gap: var(--workstel-space-0_5);
}
.user-row-text strong {
  font-size: var(--workstel-font-sm);
  font-weight: var(--workstel-weight-semibold);
}
.user-row-text small,
.user-note {
  font-size: var(--workstel-font-xs);
  color: var(--workstel-text-secondary);
}
.user-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--workstel-space-2);
  margin-top: var(--workstel-space-3);
}
.user-note {
  margin-top: var(--workstel-space-2);
}
.user-departments {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--workstel-border);
  border-radius: var(--workstel-radius-md);
}
.user-departments li {
  padding: var(--workstel-space-2_5) var(--workstel-space-3);
}
.user-departments li + li {
  border-top: 1px solid var(--workstel-border);
}
.user-department--off {
  background: var(--workstel-surface-muted);
}
.user-department-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--workstel-space-3);
  min-height: var(--workstel-control-md);
}
.user-department-head strong {
  font-size: var(--workstel-font-sm);
  font-weight: var(--workstel-weight-semibold);
}
.user-department-head small {
  display: block;
  font-size: var(--workstel-font-xs);
  font-weight: var(--workstel-weight-regular);
  color: var(--workstel-text-secondary);
}
.user-department-head .v-switch {
  flex: 0 0 auto;
}
.user-department-body {
  display: grid;
  gap: var(--workstel-space-2);
  margin-top: var(--workstel-space-2);
}
.user-vault {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--workstel-space-3);
}
.user-label {
  font-size: var(--workstel-font-sm);
  font-weight: var(--workstel-weight-semibold);
  margin-right: var(--workstel-space-1);
}
.user-modules {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: var(--workstel-space-2);
}
.user-departments :deep(.v-label) {
  font-size: var(--workstel-font-sm);
}
.user-vault-count {
  font-size: var(--workstel-font-sm);
}
.user-vault-list,
.user-vault-result ul {
  list-style: none;
  margin: var(--workstel-space-1_5) 0 var(--workstel-space-2);
  padding: 0;
  font-size: var(--workstel-font-sm);
}
.user-vault-list small,
.user-vault-result small {
  color: var(--workstel-text-secondary);
}
.user-vault-transfer {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--workstel-space-2);
  margin-top: var(--workstel-space-2);
}
.user-vault-result {
  margin-top: var(--workstel-space-2_5);
  padding: var(--workstel-space-2_5) var(--workstel-space-3);
  border-radius: var(--workstel-radius-md);
  background: var(--workstel-surface-muted);
  font-size: var(--workstel-font-sm);
}
.user-confirm-warning {
  margin-top: var(--workstel-space-2_5);
  color: var(--workstel-warning-text) !important;
}
@media (max-width: 680px) {
  .user-actions .v-btn,
  .user-vault-transfer .v-btn {
    min-height: var(--workstel-touch-target);
  }
  .user-vault-transfer {
    grid-template-columns: minmax(0, 1fr);
  }
  .user-departments :deep(.v-selection-control),
  .user-row :deep(.v-selection-control) {
    min-height: var(--workstel-touch-target);
  }
}
</style>
