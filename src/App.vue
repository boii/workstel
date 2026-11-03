<script setup lang="ts">
import { computed, ref, watch, onMounted, nextTick } from 'vue';
import { locale, t, translate } from './i18n';
import type { MessageKey } from './i18n';
import { useDisplay, useLocale } from 'vuetify';
const { width } = useDisplay();
const headerHeight = computed(() => (width.value <= 680 ? 112 : 64));
const { current: materialLocale } = useLocale();
watch(
  locale,
  (value) => {
    materialLocale.value = value;
  },
  { immediate: true },
);
import { modules } from './modules/registry';
import { isModuleEnabled } from './core/module';
import { useRoute, useRouter } from 'vue-router';
import { shellPaths } from './routes';
const route = useRoute();
const router = useRouter();
const view = computed(() => String(route.meta.view ?? 'Not found'));
watch(
  () => route.path,
  () => {
    query.value = '';
    category.value = 'All modules';
  },
);
import './modules/vault/styles.css';
import type { ModuleManifest } from './core/module';
import { runtime } from './config/runtime';
import { useAuth } from './auth/useAuth';
import PasswordSignIn from './auth/PasswordSignIn.vue';
import { usePersistedRef } from './core/use-persisted-ref';
import { useShortcuts } from './core/use-shortcuts';
import { focusFieldInput } from './core/focus-field';
import type { FocusableField } from './core/focus-field';
import KeyboardShortcuts from './shared/keyboard-shortcuts.vue';
import SettingsPage from './shared/settings-page.vue';
import HelpPage from './shared/help-page.vue';
const appVersion = import.meta.env.VITE_APP_VERSION;
const buildCommit = import.meta.env.VITE_BUILD_COMMIT;
const copyrightYear = new Date().getFullYear();
const auth = useAuth();
const savedModules = [...modules.map((m) => m.id)];
const storedFavorites = usePersistedRef<string[]>(
  'workstel.favorites',
  ['vault'],
  (value): value is string[] =>
    Array.isArray(value) &&
    value.every((id) => typeof id === 'string' && savedModules.includes(id)),
);
// Favorites only keep modules that still exist, so removed modules never reappear.
const favorites = computed({
  get: () => storedFavorites.value.filter((id) => savedModules.includes(id)),
  set: (value) => {
    storedFavorites.value = [...new Set(value.filter((id) => savedModules.includes(id)))];
  },
});
onMounted(() => {
  void auth.start();
});
watch(auth.authenticated, (value) => {
  if (!runtime.demo) {
    session.value = value;
    if (!value) {
      creating.value = false;
      notice.value = false;
      query.value = '';
    }
  }
});

const session = ref(false),
  ssoNotice = ref(false),
  query = ref(''),
  category = ref('All modules'),
  notice = ref(false),
  creating = ref(false),
  title = ref(''),
  error = ref('');
const tasks = ref(
  runtime.demo
    ? [
        {
          id: 1,
          titleKey: 'taskVehicle' as MessageKey | null,
          title: 'Inspect Toyota Hiace',
          module: 'Vehicle Checklist',
          dept: 'Front Office',
          time: '09.00',
          done: false,
        },
        {
          id: 2,
          titleKey: 'taskSales' as MessageKey | null,
          title: 'Follow up on corporate proposal',
          module: 'Sales CRM',
          dept: 'Sales & Marketing',
          time: '11.30',
          done: false,
        },
        {
          id: 3,
          titleKey: 'taskPool' as MessageKey | null,
          title: 'Check the swimming pool area',
          module: 'Daily Checklist',
          dept: 'Engineering',
          time: '14.00',
          done: false,
        },
      ]
    : [],
);
const icons: Record<string, string> = {
  'bin-card': 'mdi-package-variant-closed',
  vehicle: 'mdi-car-outline',
  'sales-crm': 'mdi-handshake-outline',
  vault: 'mdi-key-outline',
  checklist: 'mdi-clipboard-check-outline',
  documents: 'mdi-file-document-multiple-outline',
};
const visible = computed(() =>
  modules.filter(
    (m) =>
      (category.value === 'All modules' || m.category === category.value) &&
      translate(m.title).toLowerCase().includes(query.value.toLowerCase()) &&
      (view.value !== 'Favorites' || favorites.value.includes(m.id)),
  ),
);
const remaining = computed(() => tasks.value.filter((t) => !t.done).length);
const hotelName = computed(() =>
  runtime.demo ? t('hotel') : auth.assignments.value[0]?.hotelName || t('hotel'),
);
const shortcutsOpen = ref(false);
const searchField = ref<FocusableField | null>(null);
const showsModuleList = computed(() => ['Dashboard', 'Favorites'].includes(view.value));
/** Focus the module search so `/` behaves like the shortcuts printed in the shortcut list. */
function focusModuleSearch() {
  if (!showsModuleList.value) {
    nav('Dashboard');
    void nextTick(() => focusFieldInput(searchField.value));
    return;
  }
  focusFieldInput(searchField.value);
}
function closeOverlays() {
  if (shortcutsOpen.value) {
    shortcutsOpen.value = false;
    return true;
  }
  if (creating.value) {
    creating.value = false;
    return true;
  }
  return false;
}
useShortcuts(
  () => [
    { key: '/', run: focusModuleSearch },
    { key: '?', shift: true, run: () => (shortcutsOpen.value = true) },
    { key: 'Escape', allowInInputs: true, run: closeOverlays },
  ],
  // Module pages register their own shortcuts; the shell must not capture the same keys twice.
  () => session.value && !route.meta.moduleId,
);
const shortcutRows = computed(() => [
  { keys: '/', label: t('shortcutSearch') },
  { keys: '?', label: t('shortcutList') },
  { keys: 'Esc', label: t('shortcutClose') },
]);
// Help lists every shortcut, including the Vault-only "new account" key registered by that page.
const helpShortcutRows = computed(() => [
  { keys: '/', label: t('helpSearchShortcut') },
  { keys: 'N', label: t('helpNewAccount') },
  { keys: '?', label: t('shortcutList') },
  { keys: 'Esc', label: t('shortcutClose') },
]);
const vaultModule = modules.find((m) => m.id === 'vault');
function nav(v: string) {
  if (!runtime.demo && v === 'My tasks') return;
  if (shellPaths[v]) void router.push(shellPaths[v]);
  query.value = '';
  category.value = 'All modules';
}
function openModule(module: ModuleManifest) {
  if (!canOpenModule(module)) return;
  void router.push({ name: module.id });
}
function canOpenModule(module: ModuleManifest) {
  return (
    router.hasRoute(module.id) &&
    isModuleEnabled(module) &&
    (runtime.demo || module.id !== 'vault' || auth.vaultReady.value)
  );
}
function toggleFavorite(id: string) {
  favorites.value = favorites.value.includes(id)
    ? favorites.value.filter((x) => x !== id)
    : [...favorites.value, id];
}
function addTask() {
  if (!title.value.trim()) {
    error.value = 'Enter a task name.';
    return;
  }
  tasks.value.push({
    id: Date.now(),
    titleKey: null,
    title: title.value.trim(),
    module: 'Daily Checklist',
    dept: 'Administration',
    time: 'Today',
    done: false,
  });
  title.value = '';
  error.value = '';
  creating.value = false;
  nav('My tasks');
}
function logout() {
  if (!runtime.demo) void auth.signOut();
  session.value = false;
  void router.replace('/');

  creating.value = false;
  notice.value = false;
}
</script>
<template>
  <v-app>
    <a
      v-if="session"
      class="skip-link"
      href="#workspace-main"
      >{{ t('skipToContent') }}</a
    >
    <v-main
      v-if="auth.restoring.value"
      class="d-flex align-center justify-center"
    >
      <v-skeleton-loader
        type="article"
        width="560"
        max-width="100%"
        role="status"
        :aria-label="t('loading')"
      />
    </v-main>
    <template v-else-if="!session"
      ><header class="login-header">
        <span
          class="wordmark"
          aria-label="Workstel"
        >
          <v-icon icon="mdi-office-building-outline" />Workstel<span>.</span>
        </span>
        <div class="login-language">
          <v-menu
            ><template #activator="{ props }"
              ><v-btn
                v-bind="props"
                icon="mdi-translate"
                variant="text"
                :aria-label="t('language')" /></template
            ><v-list
              density="compact"
              min-width="180"
              ><v-list-item
                title="English"
                :active="locale === 'en'"
                @click="locale = 'en'" /><v-list-item
                title="Bahasa Indonesia"
                :active="locale === 'id'"
                @click="locale = 'id'" /></v-list
          ></v-menu>
        </div>
      </header>
      <main class="login-main">
        <v-card class="login-panel"
          ><div class="login-symbol">
            <v-icon
              icon="mdi-office-building-outline"
              size="32"
            />
          </div>
          <div class="eyebrow">{{ t('hotelUpper') }}</div>
          <h1>{{ t('loginTitle') }}</h1>
          <p>{{ runtime.demo ? t('loginDescription') : t('productionLogin') }}</p>
          <v-btn
            v-if="runtime.demo || auth.googleEnabled.value"
            color="primary"
            block
            height="44"
            prepend-icon="mdi-shield-account-outline"
            class="sso-button"
            :loading="auth.busy.value"
            :disabled="!runtime.demo && !runtime.configured"
            @click="runtime.demo ? (ssoNotice = true) : auth.google()"
            >{{ runtime.demo ? t('sso') : t('googleSignIn') }}</v-btn
          ><v-alert
            v-if="ssoNotice"
            type="info"
            variant="tonal"
            density="compact"
            class="sso-alert"
            >{{ t('ssoPending') }}</v-alert
          >
          <div class="login-note">
            <v-icon
              icon="mdi-shield-check-outline"
              size="16"
            />
            {{ t('authorized') }}
          </div>
          <v-alert
            v-if="!runtime.demo && (auth.failure.value || !runtime.configured)"
            type="info"
            variant="tonal"
            density="compact"
            class="mt-4"
            >{{ t(auth.failure.value || 'authUnavailable') }}</v-alert
          ><PasswordSignIn
            v-if="!runtime.demo"
            :busy="auth.busy.value"
            :disabled="!runtime.configured || !auth.emailEnabled.value"
            @sign-in="auth.signIn"
          />
          <div
            v-if="runtime.demo"
            class="demo-access"
          >
            <span>{{ t('preview') }}</span
            ><v-btn
              variant="text"
              color="primary"
              append-icon="mdi-arrow-right"
              @click="session = true"
              >{{ t('demoDashboard') }}</v-btn
            ><small>{{ t('demoAuth') }}</small>
          </div></v-card
        >
        <p class="login-support">{{ t('support') }}</p>
      </main></template
    >
    <template v-else
      ><v-app-bar
        :height="headerHeight"
        class="portal-header"
        ><div class="header-inner">
          <button
            class="wordmark"
            :aria-label="t('backDashboard')"
            @click="nav('Dashboard')"
          >
            <v-icon icon="mdi-office-building-outline" />Workstel<span>.</span></button
          ><span class="hotel-name">{{ hotelName }}</span>
          <nav
            class="top-nav"
            :aria-label="t('navigation')"
          >
            <button
              v-for="item in ['Dashboard', 'My tasks', 'Favorites']"
              :key="item"
              :class="{ active: view === item }"
              :aria-current="view === item ? 'page' : undefined"
              :disabled="!runtime.demo && item === 'My tasks'"
              :title="!runtime.demo && item === 'My tasks' ? t('comingSoon') : undefined"
              @click="nav(item)"
            >
              <span
                class="nav-label"
                :data-label="translate(item)"
                >{{ translate(item) }}</span
              ><span
                v-if="runtime.demo && item === 'My tasks'"
                class="task-count"
                >{{ remaining }}</span
              >
            </button>
          </nav>
          <div class="header-actions">
            <v-menu
              ><template #activator="{ props }"
                ><v-btn
                  v-bind="props"
                  icon="mdi-translate"
                  variant="text"
                  :aria-label="t('language')" /></template
              ><v-list
                density="compact"
                min-width="180"
                ><v-list-item
                  title="English"
                  :active="locale === 'en'"
                  @click="locale = 'en'" /><v-list-item
                  title="Bahasa Indonesia"
                  :active="locale === 'id'"
                  @click="locale = 'id'" /></v-list></v-menu
            ><v-menu
              ><template #activator="{ props }"
                ><v-btn
                  v-bind="props"
                  variant="text"
                  class="switch-button"
                  :aria-label="t('switchModule')"
                  prepend-icon="mdi-apps"
                  append-icon="mdi-chevron-down"
                  >{{ t('switchModule') }}</v-btn
                ></template
              ><v-list
                density="compact"
                min-width="240"
                ><v-list-subheader>{{ t('hotelModules') }}</v-list-subheader
                ><v-list-item
                  v-for="m in modules"
                  :key="m.id"
                  :prepend-icon="m.icon || icons[m.id] || 'mdi-view-module-outline'"
                  :title="translate(m.title)"
                  :disabled="!canOpenModule(m)"
                  :subtitle="
                    !canOpenModule(m)
                      ? t(isModuleEnabled(m) ? 'temporarilyUnavailable' : 'comingSoon')
                      : undefined
                  "
                  @click="openModule(m)" /></v-list></v-menu
            ><v-btn
              icon="mdi-help-circle-outline"
              variant="text"
              :aria-label="t('help')"
              class="help-button"
              @click="nav('Help')"
            /><v-menu
              v-if="runtime.demo"
              v-model="notice"
              ><template #activator="{ props }"
                ><v-btn
                  v-bind="props"
                  icon="mdi-bell-outline"
                  variant="text"
                  :aria-label="t('notifications')"
                  class="notification-button" /></template
              ><v-card class="notification-card"
                ><h3>{{ t('notifications') }}</h3>
                <p>{{ t('noNotifications') }}</p>
                <small>{{ t('sampleData') }}</small></v-card
              ></v-menu
            ><v-menu
              ><template #activator="{ props }"
                ><v-btn
                  v-bind="props"
                  icon
                  variant="text"
                  :aria-label="t('account')"
                  ><v-avatar
                    size="32"
                    color="#E8EDF0"
                    ><span class="avatar-label">{{
                      runtime.demo ? 'AD' : auth.email.value.slice(0, 2).toUpperCase()
                    }}</span></v-avatar
                  ></v-btn
                ></template
              ><v-list
                density="compact"
                min-width="230"
                ><v-list-item
                  :title="runtime.demo ? t('demoAdmin') : auth.email.value"
                  :subtitle="
                    runtime.demo ? t('demoRole') : t('authorized')
                  " /><v-divider /><v-list-item
                  prepend-icon="mdi-cog-outline"
                  :title="t('accountSettings')"
                  @click="nav('Settings')" /><v-list-item
                  prepend-icon="mdi-help-circle-outline"
                  :title="t('help')"
                  @click="nav('Help')" /><v-list-item
                  prepend-icon="mdi-keyboard-outline"
                  :title="t('shortcuts')"
                  @click="shortcutsOpen = true" /><v-list-item
                  prepend-icon="mdi-logout"
                  :title="t('signOut')"
                  @click="logout" /></v-list
            ></v-menu>
          </div></div></v-app-bar
      ><v-main :id="session ? 'workspace-main' : undefined"
        ><div class="workspace-content">
          <div
            v-if="view !== 'Password Vault'"
            class="page-heading"
          >
            <h1>
              <v-icon
                :icon="
                  view === 'My tasks'
                    ? 'mdi-clipboard-check-outline'
                    : view === 'Favorites'
                      ? 'mdi-star-outline'
                      : view === 'Settings'
                        ? 'mdi-cog-outline'
                        : view === 'Help'
                          ? 'mdi-help-circle-outline'
                          : 'mdi-view-dashboard-outline'
                "
                size="28"
              />{{ view === 'Not found' ? t('pageNotFound') : translate(view) }}
            </h1>
            <span
              v-if="runtime.demo"
              class="demo-label"
              >{{ t('demoMode') }}</span
            ><v-btn
              v-if="view === 'My tasks' && runtime.demo"
              color="primary"
              prepend-icon="mdi-plus"
              @click="
                creating = true;
                error = '';
              "
              >{{ t('createTask') }}</v-btn
            >
          </div>
          <router-view
            v-if="route.meta.moduleId"
            :assignments="auth.assignments.value"
            :available="auth.vaultReady.value"
            @back="nav('Dashboard')"
          />
          <section
            v-else-if="['Dashboard', 'Favorites'].includes(view)"
            :aria-label="t('moduleList')"
          >
            <div class="module-toolbar">
              <v-text-field
                ref="searchField"
                v-model="query"
                class="module-search"
                :placeholder="t('searchPlaceholder')"
                :aria-label="t('search')"
                prepend-inner-icon="mdi-magnify"
                rounded="pill"
                single-line
                clearable
                @click:clear="query = ''"
              /><v-btn-toggle
                v-model="category"
                mandatory
                variant="text"
                color="primary"
                class="category-tabs"
                ><v-btn
                  v-for="c in ['All modules', 'Operations', 'Commercial', 'Administration']"
                  :key="c"
                  :value="c"
                  >{{ translate(c) }}</v-btn
                ></v-btn-toggle
              >
            </div>
            <div class="module-grid">
              <v-card
                v-for="m in visible"
                :key="m.id"
                class="module-card"
                :class="{ 'module-coming-soon': !canOpenModule(m) }"
                ><button
                  class="module-open"
                  :disabled="!canOpenModule(m)"
                  @click="openModule(m)"
                >
                  <span
                    class="module-icon"
                    :class="m.color"
                    ><v-icon
                      :icon="m.icon || icons[m.id] || 'mdi-view-module-outline'"
                      size="30" /></span
                  ><span
                    ><h2>{{ translate(m.title) }}</h2>
                    <p>{{ translate(m.description) }}</p>
                    <span
                      v-if="!canOpenModule(m)"
                      class="module-status"
                      >{{ t(isModuleEnabled(m) ? 'temporarilyUnavailable' : 'comingSoon') }}</span
                    >
                  </span></button
                ><v-btn
                  v-if="canOpenModule(m)"
                  :icon="favorites.includes(m.id) ? 'mdi-star' : 'mdi-star-outline'"
                  :color="favorites.includes(m.id) ? 'primary' : undefined"
                  variant="text"
                  size="small"
                  class="favorite-button"
                  :aria-label="
                    t(favorites.includes(m.id) ? 'removeFavorite' : 'addFavorite') +
                    ' ' +
                    translate(m.title)
                  "
                  :aria-pressed="favorites.includes(m.id)"
                  @click="toggleFavorite(m.id)"
              /></v-card>
            </div>
            <div
              v-if="view === 'Favorites' && !favorites.length"
              class="empty-state"
            >
              <v-icon
                icon="mdi-star-outline"
                size="32"
              />
              <h2>{{ t('noFavorites') }}</h2>
              <p>{{ t('noFavoritesHint') }}</p>
              <v-btn
                variant="text"
                color="primary"
                prepend-icon="mdi-view-dashboard-outline"
                @click="nav('Dashboard')"
                >{{ t('browseModules') }}</v-btn
              >
            </div>
            <div
              v-else-if="!visible.length"
              class="empty-state"
            >
              <v-icon
                icon="mdi-magnify"
                size="32"
              />
              <h2>{{ t('noModules') }}</h2>
              <p>{{ t('noModulesHint') }}</p>
              <v-btn
                variant="text"
                color="primary"
                @click="
                  query = '';
                  category = 'All modules';
                "
                >{{ t('resetSearch') }}</v-btn
              >
            </div>
          </section>
          <v-card
            v-else-if="view === 'My tasks' && runtime.demo"
            class="task-panel"
            ><div class="panel-heading">
              <h2>{{ t('todayAgenda') }}</h2>
              <span>{{ remaining }} {{ t('remaining') }}</span>
            </div>
            <div
              v-for="task in tasks"
              :key="task.id"
              class="task-row"
            >
              <v-checkbox-btn
                v-model="task.done"
                :aria-label="t('complete') + ' ' + (task.titleKey ? t(task.titleKey) : task.title)"
                color="primary"
              />
              <div :class="{ completed: task.done }">
                <strong>{{ task.titleKey ? t(task.titleKey) : task.title }}</strong
                ><small>{{ translate(task.module) }} · {{ translate(task.dept) }}</small>
              </div>
              <span class="task-time">{{ translate(task.time) }}</span>
            </div></v-card
          >
          <SettingsPage
            v-else-if="view === 'Settings'"
            :demo="runtime.demo"
            :email="auth.email.value"
            :hotel-name="hotelName"
            :assignments="auth.assignments.value"
            @sign-out="logout"
            @open-shortcuts="shortcutsOpen = true"
          />
          <HelpPage
            v-else-if="view === 'Help'"
            :demo="runtime.demo"
            :vault-available="vaultModule ? canOpenModule(vaultModule) : false"
            :version="`Workstel v${appVersion} · Build ${buildCommit}`"
            :shortcuts="helpShortcutRows"
            @open-vault="vaultModule && openModule(vaultModule)"
            @open-settings="nav('Settings')"
          />
          <v-card
            v-else
            class="info-panel"
          >
            <p v-if="view === 'My tasks' && !runtime.demo">{{ t('productionPending') }}</p>
            <p v-else>{{ t('pageNotFound') }}</p>
            <v-btn
              variant="text"
              color="primary"
              prepend-icon="mdi-arrow-left"
              @click="nav('Dashboard')"
              >{{ t('backDashboard') }}</v-btn
            ></v-card
          >
          <footer>
            <span>Workstel<span class="brand-dot">.</span></span
            ><small
              >v{{ appVersion }} · Build {{ buildCommit }} · © {{ copyrightYear }} Workstel.</small
            >
          </footer>
        </div></v-main
      ></template
    >

    <v-dialog v-model="creating"
      ><v-card class="detail-panel"
        ><v-btn
          icon="mdi-close"
          variant="text"
          class="close-button"
          :aria-label="t('closeForm')"
          @click="creating = false"
        />
        <h2>{{ t('createTask') }}</h2>
        <p>{{ t('taskHint') }}</p>
        <v-form @submit.prevent="addTask"
          ><label
            for="task-title"
            class="field-label"
            >{{ t('taskName') }}</label
          ><v-text-field
            id="task-title"
            v-model="title"
            autofocus
            :placeholder="t('taskPlaceholder')"
            maxlength="150"
            :error-messages="translate(error)"
            @update:model-value="error = ''"
          /><small>{{ t('temporaryData') }}</small
          ><v-btn
            type="submit"
            color="primary"
            class="submit-button"
            >{{ t('addTask') }}</v-btn
          ></v-form
        ></v-card
      ></v-dialog
    >
    <KeyboardShortcuts
      v-model="shortcutsOpen"
      :rows="shortcutRows"
    />
  </v-app>
</template>
