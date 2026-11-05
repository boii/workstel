<script setup lang="ts">
import { onMounted, ref } from 'vue';
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
          size="22"
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
    <v-dialog
      :model-value="!!pendingOff"
      max-width="420"
      @update:model-value="pendingOff = null"
    >
      <v-card class="switches-confirm">
        <h2>{{ t('moduleDisableTitle') }}</h2>
        <p>
          <strong>{{ pendingOff ? translate(pendingOff.title) : '' }}</strong> —
          {{ t('moduleDisableBody') }}
        </p>
        <div class="switches-confirm-actions">
          <v-btn
            variant="text"
            @click="pendingOff = null"
            >{{ t('cancelAction') }}</v-btn
          ><v-btn
            color="error"
            variant="flat"
            @click="pendingOff && apply(pendingOff, false)"
            >{{ t('moduleTurnOff') }}</v-btn
          >
        </div>
      </v-card>
    </v-dialog>
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
  gap: 8px;
}
.switches-heading h2 {
  font-size: var(--workstel-font-md);
  font-weight: 600;
  line-height: 1.4;
}
.switches-badge {
  padding: 1px 8px;
  border-radius: 4px;
  background: var(--workstel-surface-subtle);
  color: var(--workstel-text-secondary);
  font-size: var(--workstel-font-xs);
  font-weight: 700;
  line-height: 1.6;
}
.switches-hint {
  margin-top: 6px;
  font-size: var(--workstel-font-sm);
  line-height: 1.6;
  color: var(--workstel-text-secondary);
}
.switches-list {
  list-style: none;
  margin: 12px 0 0;
  padding: 0;
}
.switches-list li {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 56px;
  padding: 8px 0;
  border-top: 1px solid var(--workstel-border);
}
.switches-list li > .v-icon {
  color: var(--workstel-primary-text);
  flex-shrink: 0;
}
.switches-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}
.switches-text strong {
  font-size: var(--workstel-font-sm);
  font-weight: 600;
}
.switches-text small {
  font-size: var(--workstel-font-xs);
  color: var(--workstel-text-secondary);
  overflow-wrap: anywhere;
}
.switches-state {
  padding: 1px 8px;
  border-radius: 4px;
  background: var(--workstel-success-bg);
  color: var(--workstel-success-text);
  font-size: var(--workstel-font-xs);
  font-weight: 700;
  line-height: 1.6;
}
.switches-state--off {
  background: var(--workstel-surface-subtle);
  color: var(--workstel-text-secondary);
}
.switches-list .v-switch {
  flex: 0 0 auto;
}
.switches-confirm {
  padding: 22px;
}
.switches-confirm h2 {
  font-size: var(--workstel-font-lg);
  font-weight: 500;
}
.switches-confirm p {
  margin-top: 10px;
  font-size: var(--workstel-font-sm);
  line-height: 1.6;
  color: var(--workstel-text-secondary);
}
.switches-confirm-actions {
  display: flex;
  justify-content: flex-end;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 20px;
}
@media (max-width: 680px) {
  .switches-list li {
    flex-wrap: wrap;
  }
  .switches-confirm-actions .v-btn {
    min-height: 44px;
  }
  .switches-list :deep(.v-selection-control) {
    min-height: 44px;
  }
}
</style>
