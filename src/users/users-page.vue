<script setup lang="ts">
import { dialogWidth } from '../shared/dialog-widths';
import { computed, onMounted, ref } from 'vue';
import ModulePage from '../shared/ModulePage.vue';
import ModuleDialog from '../shared/module-dialog.vue';
import FilterGroup from '../shared/filter-group.vue';
import ListRow from '../shared/list-row.vue';
import UndoSnackbar from '../shared/undo-snackbar.vue';
import { locale, t } from '../i18n';
import type { MessageKey } from '../i18n';
import { createDemoUsersApi, demoSelfId } from './demo-users-api';
import { createLiveUsersApi } from './users-api';
import type { UserDirectory, UserRecord, UsersApi } from './users-api';
import TemporaryPassword from './temporary-password.vue';
import UserDialog from './user-dialog.vue';
import { emailPattern, userErrorKey } from './user-errors';

const props = defineProps<{ demo: boolean; selfEmail: string }>();
const api: UsersApi = props.demo ? createDemoUsersApi() : createLiveUsersApi();
const directory = ref<UserDirectory>({ users: [], departments: [], modules: [] });
const loading = ref(true);
const failure = ref('');
const search = ref('');
const notice = ref('');

async function load() {
  failure.value = '';
  try {
    directory.value = await api.list();
  } catch (error) {
    failure.value = t(
      userErrorKey(error) === 'userErrorDenied' ? 'userErrorDenied' : 'userLoadFailed',
    );
  } finally {
    loading.value = false;
  }
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
const departmentCount = (id: string) =>
  directory.value.users.find((u) => u.id === id)?.memberships.filter((m) => m.enabled).length ?? 0;
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
const creating = ref(false);
const createFailure = ref('');
function openCreate() {
  email.value = '';
  emailError.value = '';
  createFailure.value = '';
  createOpen.value = true;
}
async function create() {
  if (creating.value) return;
  const value = email.value.trim();
  if (!emailPattern.test(value) || value.length > 254) {
    emailError.value = t('userErrorInvalidEmail');
    return;
  }
  creating.value = true;
  createFailure.value = '';
  try {
    const created = await api.create(value);
    createOpen.value = false;
    await load();
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
          · {{ t('userDepartments') }}: {{ departmentCount(user.id) }}
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
    @changed="changed"
    @failed="failed"
    @temporary-password="showPassword"
  />
  <ModuleDialog
    v-model="createOpen"
    :title="t('addUser')"
    :busy="creating"
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
    </v-form>
    <template #actions>
      <v-btn
        variant="text"
        :disabled="creating"
        @click="createOpen = false"
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
