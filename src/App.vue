<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { locale, t, translate } from './i18n';
import type { MessageKey } from './i18n';
import { useLocale } from 'vuetify';
const { current: materialLocale } = useLocale();
watch(
  locale,
  (value) => {
    materialLocale.value = value;
  },
  { immediate: true },
);
import { modules } from './modules/registry';
import type { ModuleManifest } from './core/module';
const session = ref(false),
  ssoNotice = ref(false),
  view = ref('Dashboard'),
  query = ref(''),
  category = ref('All modules'),
  favorites = ref(['bin-card', 'vehicle']),
  selected = ref<ModuleManifest | null>(null),
  notice = ref(false),
  creating = ref(false),
  title = ref(''),
  error = ref('');
const tasks = ref([
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
]);
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
function nav(v: string) {
  view.value = v;
  query.value = '';
  category.value = 'All modules';
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
  session.value = false;
  selected.value = null;
  creating.value = false;
  notice.value = false;
}
</script>
<template>
  <v-app>
    <template v-if="!session"
      ><header class="login-header">
        <button
          class="wordmark"
          aria-label="Workstel"
        >
          <v-icon icon="mdi-office-building-outline" />Workstel<span>.</span>
        </button>
        <div class="login-language">
          <span>{{ t('portal') }}</span
          ><v-menu
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
          <p>{{ t('loginDescription') }}</p>
          <v-btn
            color="primary"
            block
            height="44"
            prepend-icon="mdi-shield-account-outline"
            class="sso-button"
            @click="ssoNotice = true"
            >{{ t('sso') }}</v-btn
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
          <div class="demo-access">
            <span>{{ t('preview') }}</span
            ><v-btn
              variant="text"
              color="primary"
              append-icon="mdi-arrow-right"
              @click="
                session = true;
                nav('Dashboard');
              "
              >{{ t('demoDashboard') }}</v-btn
            ><small>{{ t('demoAuth') }}</small>
          </div></v-card
        >
        <p class="login-support">{{ t('support') }}</p>
      </main></template
    >
    <template v-else
      ><v-app-bar
        height="64"
        class="portal-header"
        ><div class="header-inner">
          <button
            class="wordmark"
            :aria-label="t('backDashboard')"
            @click="nav('Dashboard')"
          >
            <v-icon icon="mdi-office-building-outline" />Workstel<span>.</span></button
          ><span class="hotel-name">{{ t('hotel') }}</span>
          <nav
            class="top-nav"
            :aria-label="t('navigation')"
          >
            <button
              v-for="item in ['Dashboard', 'My tasks', 'Favorites']"
              :key="item"
              :class="{ active: view === item }"
              @click="nav(item)"
            >
              {{ translate(item)
              }}<span
                v-if="item === 'My tasks'"
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
                  @click="selected = m" /></v-list></v-menu
            ><v-btn
              icon="mdi-help-circle-outline"
              variant="text"
              :aria-label="t('help')"
              class="help-button"
              @click="nav('Help')"
            /><v-menu v-model="notice"
              ><template #activator="{ props }"
                ><v-btn
                  v-bind="props"
                  icon="mdi-bell-outline"
                  variant="text"
                  :aria-label="t('notifications')" /></template
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
                    ><span class="avatar-label">AD</span></v-avatar
                  ></v-btn
                ></template
              ><v-list
                density="compact"
                min-width="230"
                ><v-list-item
                  :title="t('demoAdmin')"
                  subtitle="Hotel Administrator" /><v-divider /><v-list-item
                  prepend-icon="mdi-cog-outline"
                  :title="t('accountSettings')"
                  @click="nav('Settings')" /><v-list-item
                  prepend-icon="mdi-logout"
                  :title="t('signOut')"
                  @click="logout" /></v-list
            ></v-menu>
          </div></div></v-app-bar
      ><v-main
        ><div class="workspace-content">
          <div class="page-heading">
            <h1>
              <v-icon
                :icon="
                  view === 'My tasks'
                    ? 'mdi-clipboard-check-outline'
                    : view === 'Favorites'
                      ? 'mdi-star-outline'
                      : 'mdi-view-dashboard-outline'
                "
                size="28"
              />{{ translate(view) }}
            </h1>
            <span class="demo-label">{{ t('demoMode') }}</span
            ><v-btn
              v-if="view === 'My tasks'"
              color="primary"
              prepend-icon="mdi-plus"
              @click="
                creating = true;
                error = '';
              "
              >{{ t('createTask') }}</v-btn
            >
          </div>
          <section
            v-if="['Dashboard', 'Favorites'].includes(view)"
            :aria-label="t('moduleList')"
          >
            <div class="module-toolbar">
              <v-text-field
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
                ><button
                  class="module-open"
                  @click="selected = m"
                >
                  <span
                    class="module-icon"
                    :class="m.color"
                    ><v-icon
                      :icon="m.icon || icons[m.id] || 'mdi-view-module-outline'"
                      size="30" /></span
                  ><span
                    ><h2>{{ translate(m.title) }}</h2>
                    <p>{{ translate(m.description) }}</p></span
                  ></button
                ><v-btn
                  :icon="favorites.includes(m.id) ? 'mdi-star' : 'mdi-star-outline'"
                  :color="favorites.includes(m.id) ? 'primary' : undefined"
                  variant="text"
                  size="small"
                  class="favorite-button"
                  :aria-label="t('favorites') + ' ' + translate(m.title)"
                  :aria-pressed="favorites.includes(m.id)"
                  @click="toggleFavorite(m.id)"
              /></v-card>
            </div>
            <div
              v-if="!visible.length"
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
            v-else-if="view === 'My tasks'"
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
          <v-card
            v-else
            class="info-panel"
            ><h2>{{ translate(view) }}</h2>
            <p v-if="view === 'Settings'">{{ t('settingsPending') }}</p>
            <p v-else>{{ t('sharedStandards') }}</p>
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
            ><small>{{ t('portal') }} · Prototype v0.1</small>
          </footer>
        </div></v-main
      ></template
    >
    <v-dialog
      :model-value="!!selected"
      @update:model-value="!$event && (selected = null)"
      ><v-card
        v-if="selected"
        class="detail-panel"
        ><v-btn
          icon="mdi-close"
          variant="text"
          class="close-button"
          :aria-label="t('close')"
          @click="selected = null"
        /><v-icon
          :icon="selected.icon || icons[selected.id] || 'mdi-view-module-outline'"
          size="38"
          color="primary"
        /><span class="eyebrow">{{ translate(selected.category) }}</span>
        <h2>{{ translate(selected.title) }}</h2>
        <p>{{ translate(selected.description) }}</p>
        <v-alert
          variant="tonal"
          type="info"
          density="compact"
          >{{ t('modulePending') }}</v-alert
        >
        <dl>
          <dt>{{ t('idVersion') }}</dt>
          <dd>{{ selected.id }} · {{ selected.version }}</dd>
          <dt>{{ t('permissions') }}</dt>
          <dd>{{ selected.permissions.join(', ') }}</dd>
          <dt>{{ t('publishedEvents') }}</dt>
          <dd>{{ selected.publishes.join(', ') || t('none') }}</dd>
          <dt>{{ t('subscribedEvents') }}</dt>
          <dd>{{ selected.subscribes.join(', ') || t('none') }}</dd>
        </dl>
        <p
          v-if="selected.id === 'vault'"
          class="vault-note"
        >
          {{ t('vaultNotice') }}
        </p>
        <v-btn
          color="primary"
          @click="selected = null"
          >{{ t('back') }}</v-btn
        ></v-card
      ></v-dialog
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
  </v-app>
</template>
