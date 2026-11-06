<script setup lang="ts">
import { dialogWidth } from '../shared/dialog-widths';
import { computed, onMounted, ref } from 'vue';
import ModuleDialog from '../shared/module-dialog.vue';
import { locale, t } from '../i18n';
import type { MessageKey } from '../i18n';
import { createDemoUsersApi, demoSelfId } from './demo-users-api';
import { createLiveUsersApi } from './users-api';
import type { UserDirectory, UsersApi } from './users-api';
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
const visible = computed(() => {
  const query = search.value.trim().toLowerCase();
  return directory.value.users.filter((user) => !query || user.email.toLowerCase().includes(query));
});
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
  <div class="users-page">
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
      />
      <v-btn
        color="primary"
        prepend-icon="mdi-account-plus-outline"
        @click="openCreate"
        >{{ t('addUser') }}</v-btn
      >
    </div>
    <v-alert
      v-if="failure"
      type="error"
      variant="tonal"
      role="alert"
      >{{ failure
      }}<v-btn
        variant="text"
        @click="load"
        >{{ t('retryLoad') }}</v-btn
      ></v-alert
    >
    <v-skeleton-loader
      v-else-if="loading"
      type="table"
    />
    <template v-else>
      <p class="users-count">{{ visible.length }} {{ t('userCount') }}</p>
      <ul class="users-list">
        <li
          v-for="user in visible"
          :key="user.id"
        >
          <div class="users-identity">
            <strong>{{ user.email }}</strong>
            <small>
              {{
                user.lastSignInAt
                  ? t('userLastSignIn') + ' ' + formatTime(user.lastSignInAt)
                  : t('userNeverSignedIn')
              }}
              · {{ t('userDepartments') }}: {{ departmentCount(user.id) }}
            </small>
          </div>
          <div class="users-badges">
            <span
              v-if="user.developer"
              class="users-badge users-badge--developer"
              >{{ t('userDeveloper') }}</span
            ><span
              v-if="user.blocked"
              class="users-badge users-badge--blocked"
              >{{ t('userBlocked') }}</span
            ><span
              v-if="user.mustChangePassword"
              class="users-badge"
              >{{ t('userMustChange') }}</span
            >
          </div>
          <v-btn
            variant="tonal"
            color="primary"
            prepend-icon="mdi-account-cog-outline"
            :aria-label="t('userManage') + ' — ' + user.email"
            @click="openUser(user.id)"
            >{{ t('userManage') }}</v-btn
          >
        </li>
      </ul>
    </template>

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
    <v-snackbar
      :model-value="!!notice"
      timeout="3000"
      @update:model-value="notice = ''"
      >{{ notice }}</v-snackbar
    >
  </div>
</template>
<style scoped>
.users-toolbar {
  display: flex;
  align-items: center;
  gap: var(--workstel-space-3);
  margin-bottom: var(--workstel-space-3);
}
.users-search {
  flex: 1;
  max-width: 420px;
}
.users-toolbar > .v-btn {
  margin-left: auto;
}
.users-count {
  font-size: var(--workstel-font-sm);
  color: var(--workstel-text-secondary);
  margin-bottom: var(--workstel-space-2);
}
.users-list {
  list-style: none;
  margin: 0;
  padding: 0;
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--workstel-border);
  border-radius: var(--workstel-radius-md);
  overflow: hidden;
}
.users-list li {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--workstel-space-4);
  min-height: var(--workstel-row-lg);
  padding: var(--workstel-space-2) var(--workstel-space-3) var(--workstel-space-2)
    var(--workstel-space-4);
}
.users-list li + li {
  border-top: 1px solid var(--workstel-border);
}
.users-identity {
  display: flex;
  flex-direction: column;
  gap: var(--workstel-space-0_5);
  min-width: 0;
}
.users-identity strong {
  font-size: var(--workstel-font-sm);
  font-weight: var(--workstel-weight-semibold);
  overflow-wrap: anywhere;
}
.users-identity small {
  font-size: var(--workstel-font-xs);
  color: var(--workstel-text-secondary);
}
.users-badges {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--workstel-space-1);
}
.users-badge {
  padding: 1px var(--workstel-space-2);
  border-radius: var(--workstel-radius-sm);
  background: var(--workstel-surface-subtle);
  color: var(--workstel-text-secondary);
  font-size: var(--workstel-font-xs);
  font-weight: var(--workstel-weight-bold);
  line-height: var(--workstel-leading-relaxed);
}
.users-badge--developer {
  background: var(--workstel-info-bg);
  color: var(--workstel-primary-text);
}
.users-badge--blocked {
  background: var(--workstel-danger-bg);
  color: var(--workstel-danger-text);
}
.users-hint {
  font-size: var(--workstel-font-sm);
  line-height: var(--workstel-leading-relaxed);
  color: var(--workstel-text-secondary);
}
@media (max-width: 680px) {
  .users-toolbar {
    flex-wrap: wrap;
  }
  .users-search {
    max-width: none;
    flex-basis: 100%;
  }
  .users-toolbar > .v-btn {
    margin-left: 0;
    width: 100%;
    min-height: var(--workstel-touch-target);
  }
  .users-list li {
    grid-template-columns: minmax(0, 1fr);
    gap: var(--workstel-space-2);
    padding: var(--workstel-space-3);
  }
  .users-badges {
    justify-content: flex-start;
  }
  .users-list .v-btn {
    min-height: var(--workstel-touch-target);
  }
}
</style>
