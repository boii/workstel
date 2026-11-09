<script setup lang="ts">
import { dialogWidth } from '../shared/dialog-widths';
import { computed, onMounted, ref } from 'vue';
import ModulePage from '../shared/ModulePage.vue';
import ModuleDialog from '../shared/module-dialog.vue';
import FilterGroup from '../shared/filter-group.vue';
import ListRow from '../shared/list-row.vue';
import OptionalFields from '../shared/optional-fields.vue';
import UndoSnackbar from '../shared/undo-snackbar.vue';
import { locale, t } from '../i18n';
import type { MessageKey } from '../i18n';
import { createDemoUsersApi, demoSelfId } from './demo-users-api';
import { createLiveUsersApi } from './users-api';
import type { UserDirectory, UserRecord, UsersApi } from './users-api';
import TemporaryPassword from './temporary-password.vue';
import UserDialog from './user-dialog.vue';
import { emailPattern, isDisplayName, userErrorKey } from './user-errors';

const props = defineProps<{ demo: boolean; selfEmail: string }>();
const api: UsersApi = props.demo ? createDemoUsersApi() : createLiveUsersApi();
const directory = ref<UserDirectory>({ users: [], departments: [], modules: [] });
const loading = ref(true);
const failure = ref('');
const search = ref('');
const notice = ref('');

// Saves reload the directory as they finish; only the last reload started may apply, and a
// superseded reload resolves only once the latest one has, so a caller never sees old data.
let sequence = 0;
let latest: Promise<void> = Promise.resolve();
function load(): Promise<void> {
  const current = ++sequence;
  const run = (async () => {
    failure.value = '';
    try {
      const result = await api.list();
      if (current === sequence) directory.value = result;
    } catch (error) {
      if (current === sequence)
        failure.value = t(
          userErrorKey(error) === 'userErrorDenied' ? 'userErrorDenied' : 'userLoadFailed',
        );
    } finally {
      if (current === sequence) loading.value = false;
    }
  })();
  latest = run;
  return run.then(() => (current === sequence ? undefined : latest));
}
onMounted(load);
const selfId = computed(() =>
  props.demo
    ? demoSelfId
    : (directory.value.users.find((u) => u.email.toLowerCase() === props.selfEmail.toLowerCase())
        ?.id ?? ''),
);
type StatusFilter = 'all' | 'blocked' | 'developer' | 'temporary' | 'never';
const status = ref<StatusFilter>('all');
const department = ref('all');
const statusItems = computed(() => [
  { value: 'all', title: t('userStatusAll') },
  { value: 'blocked', title: t('userBlocked') },
  { value: 'developer', title: t('userDeveloper') },
  { value: 'temporary', title: t('userMustChange') },
  { value: 'never', title: t('userNeverSignedIn') },
]);
const multiHotel = computed(
  () => new Set(directory.value.departments.map((d) => d.hotelId)).size > 1,
);
const departmentItems = computed(() => [
  { value: 'all', title: t('userDepartmentAll') },
  ...directory.value.departments.map((d) => ({
    value: d.id,
    title: multiHotel.value ? d.hotelName + ' · ' + d.name : d.name,
  })),
]);
const matchesStatus: Record<StatusFilter, (user: UserRecord) => boolean> = {
  all: () => true,
  blocked: (user) => user.blocked,
  developer: (user) => user.developer,
  temporary: (user) => user.mustChangePassword,
  never: (user) => !user.lastSignInAt,
};
const visible = computed(() => {
  const query = search.value.trim().toLowerCase();
  return directory.value.users.filter(
    (user) =>
      (!query || user.email.toLowerCase().includes(query)) &&
      matchesStatus[status.value](user) &&
      (department.value === 'all' ||
        user.memberships.some((m) => m.enabled && m.departmentId === department.value)),
  );
});
// Filters other than search; on phones they share one Filters button.
const filterCount = computed(
  () => (status.value !== 'all' ? 1 : 0) + (department.value !== 'all' ? 1 : 0),
);
const hasFilters = computed(() => !!search.value || filterCount.value > 0);
function resetFilterGroup() {
  status.value = 'all';
  department.value = 'all';
}
function resetFilters() {
  search.value = '';
  resetFilterGroup();
}
// The first two department names, then how many more, in the directory's order.
function departmentSummary(user: UserRecord) {
  const names = directory.value.departments
    .filter((d) => user.memberships.some((m) => m.enabled && m.departmentId === d.id))
    .map((d) => d.name);
  if (!names.length) return t('userNoDepartments');
  const shown = names.slice(0, 2).join(', ');
  return names.length > 2 ? shown + ' +' + (names.length - 2) : shown;
}
const formatTime = (value: string) =>
  new Intl.DateTimeFormat(locale.value === 'id' ? 'id-ID' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));

const selectedId = ref<string | null>(null);
const accessOpen = ref(false);
const selected = computed(
  () => directory.value.users.find((u) => u.id === selectedId.value) ?? null,
);
function openUser(id: string) {
  selectedId.value = id;
  accessOpen.value = true;
}
async function changed(message: MessageKey) {
  notice.value = t(message);
  await load();
}
function failed(message: MessageKey) {
  notice.value = t(message);
  void load();
}

const createOpen = ref(false);
const email = ref('');
const emailError = ref('');
const fullName = ref('');
const nameError = ref('');
const creating = ref(false);
const createFailure = ref('');
const copyFrom = ref<string | null>(null);
const copyPartial = ref(false);
// Only accounts with at least one department have access worth copying.
const copySources = computed(() =>
  directory.value.users
    .filter((u) => u.memberships.some((m) => m.enabled))
    .map((u) => ({ value: u.id, title: u.email })),
);
function openCreate() {
  email.value = '';
  emailError.value = '';
  fullName.value = '';
  nameError.value = '';
  createFailure.value = '';
  copyFrom.value = null;
  createOpen.value = true;
}
// Copies department membership, Vault permissions and module levels — never the developer
// role or a block. One call per change, so a failure can leave the copy partial; returns
// whether every call succeeded.
async function copyAccess(source: UserRecord, userId: string) {
  try {
    for (const membership of source.memberships.filter((m) => m.enabled)) {
      const { departmentId, enabled, canRead, canWrite, canArchive, canAudit } = membership;
      await api.setMembership(userId, departmentId, {
        enabled,
        canRead,
        canWrite,
        canArchive,
        canAudit,
      });
      for (const grant of source.moduleGrants.filter((g) => g.departmentId === departmentId))
        await api.setModuleLevel(userId, departmentId, grant.moduleId, grant.level);
    }
    return true;
  } catch {
    return false;
  }
}
async function create() {
  if (creating.value) return;
  const value = email.value.trim();
  const name = fullName.value.trim().replace(/\s+/g, ' ');
  emailError.value =
    !emailPattern.test(value) || value.length > 254 ? t('userErrorInvalidEmail') : '';
  nameError.value = isDisplayName(name) ? '' : t('userErrorName');
  if (emailError.value || nameError.value) {
    document.getElementById(emailError.value ? 'user-create-email' : 'user-create-name')?.focus();
    return;
  }
  creating.value = true;
  createFailure.value = '';
  try {
    const created = await api.create(value, name);
    // Copy from the source's current access, not from when the page last loaded.
    if (copyFrom.value) await load();
    const source = directory.value.users.find((u) => u.id === copyFrom.value);
    const copied = source ? await copyAccess(source, created.userId) : true;
    createOpen.value = false;
    await load();
    // The account exists either way; a partial copy is reported, then checked in Manage.
    // Shown once the password is closed and Manage opens, where the access is checked.
    copyPartial.value = !copied;
    showPassword(created.email, created.temporaryPassword);
    // Open the new account so access can be assigned right away.
    selectedId.value = created.userId;
  } catch (error) {
    createFailure.value = t(userErrorKey(error));
  } finally {
    creating.value = false;
  }
}

const passwordOpen = ref(false);
const passwordFor = ref('');
const passwordValue = ref('');
function showPassword(target: string, value: string) {
  passwordFor.value = target;
  passwordValue.value = value;
  passwordOpen.value = true;
}
// The temporary password leaves memory as soon as the dialog closes.
function forgetPassword() {
  passwordValue.value = '';
  if (selectedId.value && !accessOpen.value) accessOpen.value = true;
  if (copyPartial.value) notice.value = t('userCopyPartial');
  copyPartial.value = false;
}
</script>
<template>
  <ModulePage
    :title="t('usersTitle')"
    :description="visible.length + ' / ' + directory.users.length + ' ' + t('userCount')"
    :loading="loading"
    :error="failure"
    :empty="!visible.length"
    :empty-icon="hasFilters ? 'mdi-filter-off-outline' : 'mdi-account-multiple-outline'"
    :empty-title="hasFilters ? t('usersNoResults') : t('usersEmpty')"
    :empty-description="hasFilters ? t('usersNoResultsHint') : t('usersEmptyHint')"
    :retry-label="t('retryLoad')"
    @retry="load"
  >
    <template #actions
      ><v-btn
        color="primary"
        class="module-primary-action"
        prepend-icon="mdi-account-plus-outline"
        :aria-label="t('addUser')"
        @click="openCreate"
        >{{ t('addUser') }}</v-btn
      ></template
    >
    <template #toolbar>
      <div class="users-toolbar">
        <v-text-field
          v-model="search"
          class="users-search"
          :placeholder="t('usersSearch')"
          :aria-label="t('usersSearch')"
          prepend-inner-icon="mdi-magnify"
          single-line
          clearable
          maxlength="254"
          @update:model-value="search = $event ?? ''"
        />
        <FilterGroup
          :count="filterCount"
          @reset="resetFilterGroup"
        >
          <v-select
            v-model="status"
            :items="statusItems"
            :label="t('userFilterStatus')"
          />
          <v-select
            v-if="directory.departments.length > 1"
            v-model="department"
            :items="departmentItems"
            :label="t('userFilterDepartment')"
          />
        </FilterGroup>
      </div>
    </template>
    <template #empty-action>
      <v-btn
        v-if="hasFilters"
        variant="text"
        color="primary"
        @click="resetFilters"
        >{{ t('filtersReset') }}</v-btn
      ><v-btn
        v-else
        variant="tonal"
        color="primary"
        prepend-icon="mdi-account-plus-outline"
        @click="openCreate"
        >{{ t('addUser') }}</v-btn
      >
    </template>
    <ul
      class="list-rows"
      :aria-label="t('usersTitle')"
    >
      <ListRow
        v-for="user in visible"
        :key="user.id"
        icon="mdi-account-outline"
      >
        <strong>{{ user.email }}</strong>
        <small>
          {{
            user.lastSignInAt
              ? t('userLastSignIn') + ' ' + formatTime(user.lastSignInAt)
              : t('userNeverSignedIn')
          }}
          · {{ departmentSummary(user) }}
        </small>
        <template #status>
          <div class="users-badges">
            <span
              v-if="user.developer"
              class="list-row-chip users-badge--developer"
              >{{ t('userDeveloper') }}</span
            ><span
              v-if="user.blocked"
              class="list-row-chip users-badge--blocked"
              >{{ t('userBlocked') }}</span
            ><span
              v-if="user.mustChangePassword"
              class="list-row-chip users-badge--temporary"
              >{{ t('userMustChange') }}</span
            >
          </div>
        </template>
        <template #actions>
          <v-btn
            variant="tonal"
            class="row-primary-action"
            prepend-icon="mdi-account-cog-outline"
            :aria-label="t('userManage') + ' — ' + user.email"
            @click="openUser(user.id)"
            >{{ t('userManage') }}</v-btn
          >
        </template>
      </ListRow>
    </ul>
  </ModulePage>

  <UserDialog
    v-model="accessOpen"
    :user="selected"
    :users="directory.users"
    :departments="directory.departments"
    :modules="directory.modules"
    :self-id="selfId"
    :api="api"
    :reload="load"
    @changed="changed"
    @failed="failed"
    @temporary-password="showPassword"
  />
  <ModuleDialog
    v-model="createOpen"
    :title="t('addUser')"
    :busy="creating"
    :dirty="!!email.trim() || !!fullName.trim() || !!copyFrom"
    :width="dialogWidth.md"
  >
    <v-form
      id="user-create-form"
      @submit.prevent="create"
    >
      <v-alert
        v-if="createFailure"
        type="error"
        variant="tonal"
        role="alert"
        class="mb-4"
        >{{ createFailure }}</v-alert
      >
      <p class="users-hint">{{ t('userCreateHint') }}</p>
      <label
        for="user-create-email"
        class="field-label"
        >{{ t('emailLabel') }}</label
      ><v-text-field
        id="user-create-email"
        v-model="email"
        type="email"
        autocomplete="off"
        autofocus
        maxlength="254"
        :disabled="creating"
        :error-messages="emailError"
        @update:model-value="emailError = ''"
      />
      <label
        for="user-create-name"
        class="field-label"
        >{{ t('userFullName') }}</label
      ><v-text-field
        id="user-create-name"
        v-model="fullName"
        autocomplete="off"
        maxlength="80"
        :disabled="creating"
        :hint="t('userFullNameHint')"
        persistent-hint
        :error-messages="nameError"
        @update:model-value="nameError = ''"
      />
      <OptionalFields
        v-if="copySources.length"
        :label="t('userCopyAccessAdd')"
        :filled="!!copyFrom"
        :reset-key="createOpen"
      >
        <label
          for="user-create-copy"
          class="field-label"
          >{{ t('userCopyAccess') }}</label
        ><v-select
          id="user-create-copy"
          v-model="copyFrom"
          :items="copySources"
          :disabled="creating"
          clearable
          :hint="t('userCopyAccessHint')"
          persistent-hint
        />
      </OptionalFields>
    </v-form>
    <template #actions="{ close }">
      <v-btn
        variant="text"
        :disabled="creating"
        @click="close"
        >{{ t('cancelAction') }}</v-btn
      ><v-btn
        color="primary"
        type="submit"
        form="user-create-form"
        :loading="creating"
        @click.prevent="create"
        >{{ t('userCreate') }}</v-btn
      >
    </template>
  </ModuleDialog>
  <TemporaryPassword
    v-model="passwordOpen"
    :email="passwordFor"
    :password="passwordValue"
    @closed="forgetPassword"
  />
  <UndoSnackbar
    :message="notice"
    :undo="null"
    @close="notice = ''"
  />
</template>
<style scoped>
.users-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(2, minmax(0, 180px));
  align-items: center;
  gap: var(--workstel-space-2);
}
.users-toolbar:not(:has(> :nth-child(3))) {
  grid-template-columns: minmax(0, 1fr) minmax(0, 180px);
}
.users-toolbar > * {
  min-width: 0;
}
.users-badges {
  display: flex;
  flex-wrap: wrap;
  gap: var(--workstel-space-1);
}
.users-badge--developer {
  background: var(--workstel-info-bg);
  color: var(--workstel-primary-text);
}
.users-badge--blocked {
  background: var(--workstel-danger-bg);
  color: var(--workstel-danger-text);
}
.users-badge--temporary {
  background: var(--workstel-surface-subtle);
  color: var(--workstel-text-secondary);
}
.users-hint {
  font-size: var(--workstel-font-sm);
  line-height: var(--workstel-leading-relaxed);
  color: var(--workstel-text-secondary);
}
@media (max-width: 680px) {
  /* Search and the Filters button share one row. */
  .users-toolbar,
  .users-toolbar:not(:has(> :nth-child(3))) {
    grid-template-columns: minmax(0, 1fr) auto;
  }
}
</style>
