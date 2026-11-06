<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ModuleDialog from './module-dialog.vue';
import { locale, t, translate } from '../i18n';
import type { ModuleManifest } from '../core/module';
import { createDemoModuleSwitch, createLiveModuleSwitch } from '../core/module-switch';
import type { ModuleState } from '../core/module-switch';

const props = defineProps<{ demo: boolean; modules: readonly ModuleManifest[] }>();
const emit = defineEmits<{ changed: [] }>();
const api = props.demo
  ? createDemoModuleSwitch(props.modules.map((m) => m.id))
  : createLiveModuleSwitch();

const states = ref<ModuleState[]>([]);
const loading = ref(true);
const failure = ref('');
const busy = ref<string | null>(null);
const pendingOff = ref<ModuleManifest | null>(null);
// Redraws the switches when a switch-off is cancelled: the server state did not change, so
// Vue would otherwise leave the clicked switch showing off.
const redraw = ref(0);
function cancelOff() {
  pendingOff.value = null;
  redraw.value++;
}
const notice = ref('');

async function load() {
  loading.value = true;
  failure.value = '';
  try {
    states.value = await api.list();
  } catch {
    failure.value = t('moduleSwitchLoadFailed');
  } finally {
    loading.value = false;
  }
}
onMounted(load);

const stateOf = (id: string) => states.value.find((state) => state.moduleId === id);
async function apply(module: ModuleManifest, enabled: boolean) {
  busy.value = module.id;
  pendingOff.value = null;
  try {
    await api.setEnabled(module.id, enabled);
    notice.value = t(enabled ? 'moduleEnabledDone' : 'moduleDisabledDone');
    emit('changed');
  } catch {
    notice.value = t('moduleSwitchFailed');
  } finally {
    busy.value = null;
    await load();
  }
}
// Turning a module off affects everyone, so it asks first; turning it on applies at once.
function request(module: ModuleManifest, enabled: boolean) {
  if (enabled) void apply(module, true);
  else pendingOff.value = module;
}
function changedLabel(state: ModuleState) {
  if (!state.updatedAt) return '';
  const when = new Intl.DateTimeFormat(locale.value === 'id' ? 'id-ID' : 'en-GB', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(state.updatedAt));
  return (
    t('moduleLastChanged') + ' ' + when + (state.updatedByEmail ? ' · ' + state.updatedByEmail : '')
  );
}
</script>
<template>
  <v-card
    tag="section"
    class="settings-card settings-card--wide"
    aria-labelledby="settings-modules"
  >
    <div class="switches-heading">
      <h2 id="settings-modules">{{ t('modulesTitle') }}</h2>
      <span class="switches-badge">{{ t('developerOnly') }}</span>
    </div>
    <p class="switches-hint">{{ t(demo ? 'modulesDemoHint' : 'modulesHint') }}</p>
    <v-alert
      v-if="failure"
      type="error"
      variant="tonal"
      density="compact"
      role="alert"
      class="mt-3"
      >{{ failure
      }}<v-btn
        variant="text"
        @click="load"
        >{{ t('retryLoad') }}</v-btn
      ></v-alert
    >
    <v-skeleton-loader
      v-else-if="loading && !states.length"
      type="list-item-two-line@2"
    />
    <ul
      v-else
      class="switches-list"
    >
      <li
        v-for="module in modules"
        :key="module.id"
      >
        <v-icon
          :icon="module.icon || 'mdi-view-module-outline'"
          size="var(--workstel-icon-lg)"
        />
        <div class="switches-text">
          <strong :id="'switch-' + module.id">{{ translate(module.title) }}</strong>
          <small v-if="!stateOf(module.id)">{{ t('moduleNotInstalled') }}</small>
          <small v-else-if="changedLabel(stateOf(module.id)!)">{{
            changedLabel(stateOf(module.id)!)
          }}</small>
        </div>
        <span
          class="switches-state"
          :class="{ 'switches-state--off': !stateOf(module.id)?.enabled }"
          >{{ t(stateOf(module.id)?.enabled ? 'moduleOn' : 'moduleOff') }}</span
        >
        <v-switch
          :key="module.id + '-' + redraw"
          :model-value="stateOf(module.id)?.enabled ?? false"
          :disabled="!stateOf(module.id) || busy !== null"
          :loading="busy === module.id ? 'primary' : false"
          color="primary"
          inset
          hide-details
          density="compact"
          :aria-labelledby="'switch-' + module.id"
          @update:model-value="(value) => request(module, !!value)"
        />
      </li>
    </ul>
    <ModuleDialog
      :model-value="!!pendingOff"
      :title="t('moduleDisableTitle')"
      :confirm-label="t('moduleTurnOff')"
      destructive
      @update:model-value="cancelOff"
      @confirm="pendingOff && apply(pendingOff, false)"
    >
      <p>
        <strong>{{ pendingOff ? translate(pendingOff.title) : '' }}</strong> —
        {{ t('moduleDisableBody') }}
      </p>
    </ModuleDialog>
    <v-snackbar
      :model-value="!!notice"
      timeout="3000"
      @update:model-value="notice = ''"
      >{{ notice }}</v-snackbar
    >
  </v-card>
</template>
<style scoped>
.switches-heading {
  display: flex;
  align-items: center;
  gap: var(--workstel-space-2);
}
.switches-heading h2 {
  font-size: var(--workstel-font-md);
  font-weight: var(--workstel-weight-semibold);
  line-height: var(--workstel-leading-tight);
}
.switches-badge {
  padding: 1px var(--workstel-space-2);
  border-radius: var(--workstel-radius-sm);
  background: var(--workstel-surface-subtle);
  color: var(--workstel-text-secondary);
  font-size: var(--workstel-font-xs);
  font-weight: var(--workstel-weight-bold);
  line-height: var(--workstel-leading-relaxed);
}
.switches-hint {
  margin-top: var(--workstel-space-1_5);
  font-size: var(--workstel-font-sm);
  line-height: var(--workstel-leading-relaxed);
  color: var(--workstel-text-secondary);
}
.switches-list {
  list-style: none;
  margin: var(--workstel-space-3) 0 0;
  padding: 0;
}
.switches-list li {
  display: flex;
  align-items: center;
  gap: var(--workstel-space-3);
  min-height: var(--workstel-row-md);
  padding: var(--workstel-space-2) 0;
  border-top: 1px solid var(--workstel-border);
}
.switches-list li > .v-icon {
  color: var(--workstel-primary-text);
  flex-shrink: 0;
}
.switches-text {
  display: flex;
  flex-direction: column;
  gap: var(--workstel-space-0_5);
  flex: 1;
  min-width: 0;
}
.switches-text strong {
  font-size: var(--workstel-font-sm);
  font-weight: var(--workstel-weight-semibold);
}
.switches-text small {
  font-size: var(--workstel-font-xs);
  color: var(--workstel-text-secondary);
  overflow-wrap: anywhere;
}
.switches-state {
  padding: 1px var(--workstel-space-2);
  border-radius: var(--workstel-radius-sm);
  background: var(--workstel-success-bg);
  color: var(--workstel-success-text);
  font-size: var(--workstel-font-xs);
  font-weight: var(--workstel-weight-bold);
  line-height: var(--workstel-leading-relaxed);
}
.switches-state--off {
  background: var(--workstel-surface-subtle);
  color: var(--workstel-text-secondary);
}
.switches-list .v-switch {
  flex: 0 0 auto;
}
@media (max-width: 680px) {
  .switches-list li {
    flex-wrap: wrap;
  }
  .switches-list :deep(.v-selection-control) {
    min-height: var(--workstel-touch-target);
  }
}
</style>
