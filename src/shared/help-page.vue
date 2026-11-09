<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue';
import { t } from '../i18n';
import type { MessageKey } from '../i18n';
import type { ShortcutRow } from '../core/use-shortcuts';

const props = defineProps<{
  demo: boolean;
  vaultAvailable: boolean;
  version: string;
  shortcuts: ShortcutRow[];
}>();
const emit = defineEmits<{ openVault: []; openSettings: [] }>();

const steps: MessageKey[] = ['helpStep1', 'helpStep2', 'helpStep3'];
// The demo Vault has no audit log, so that tip only appears in production.
const vaultTips = computed<MessageKey[]>(() =>
  props.demo
    ? ['helpVaultScope', 'helpVault1', 'helpVault2', 'helpVault3']
    : ['helpVaultScope', 'helpVault1', 'helpVault2', 'helpVault3', 'helpVault4'],
);
const faq = computed<[MessageKey, MessageKey][]>(() => [
  ['faqComingQ', 'faqComingA'],
  ['faqAccessQ', 'faqAccessA'],
  ['faqSessionQ', props.demo ? 'temporaryData' : 'faqSessionA'],
  ['faqPersonalQ', 'faqPersonalA'],
  ['faqPasswordQ', 'faqPasswordA'],
  ['faqLanguageQ', 'faqLanguageA'],
]);
const copyState = ref<'idle' | 'copied' | 'failed'>('idle');
let timer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => {
  if (timer) clearTimeout(timer);
});
async function copyVersion() {
  try {
    await navigator.clipboard.writeText(props.version);
    copyState.value = 'copied';
  } catch {
    copyState.value = 'failed';
  }
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => (copyState.value = 'idle'), 2000);
}
</script>
<template>
  <div class="help-grid">
    <div class="help-column">
      <v-card
        tag="section"
        class="help-card"
        aria-labelledby="help-start"
      >
        <h2 id="help-start">{{ t('helpStart') }}</h2>
        <ol class="help-steps">
          <li
            v-for="(step, index) in steps"
            :key="step"
          >
            <span
              class="help-step-number"
              aria-hidden="true"
              >{{ index + 1 }}</span
            >{{ t(step) }}
          </li>
        </ol>
        <v-btn
          variant="text"
          color="primary"
          append-icon="mdi-chevron-right"
          class="help-action"
          @click="emit('openSettings')"
          >{{ t('openSettings') }}</v-btn
        >
      </v-card>

      <v-card
        tag="section"
        class="help-card"
        aria-labelledby="help-vault"
      >
        <h2 id="help-vault">
          <v-icon
            icon="mdi-key-outline"
            size="var(--workstel-icon-md)"
          />{{ t('helpVault') }}
        </h2>
        <ul class="help-tips">
          <li
            v-for="tip in vaultTips"
            :key="tip"
          >
            {{ t(tip) }}
          </li>
        </ul>
        <p class="help-warning">
          <v-icon
            icon="mdi-shield-alert-outline"
            size="var(--workstel-icon-sm)"
          />{{ t('helpVaultWarning') }}
        </p>
        <v-btn
          v-if="vaultAvailable"
          variant="text"
          color="primary"
          append-icon="mdi-chevron-right"
          class="help-action"
          @click="emit('openVault')"
          >{{ t('openVault') }}</v-btn
        >
      </v-card>

      <v-card
        tag="section"
        class="help-card help-card--flush"
        aria-labelledby="help-faq"
      >
        <h2 id="help-faq">{{ t('helpFaq') }}</h2>
        <v-expansion-panels
          variant="accordion"
          flat
          class="help-faq"
        >
          <v-expansion-panel
            v-for="[question, answer] in faq"
            :key="question"
            :title="t(question)"
            :text="t(answer)"
          />
        </v-expansion-panels>
      </v-card>
    </div>

    <div class="help-column">
      <v-card
        tag="section"
        class="help-card"
        aria-labelledby="help-shortcuts"
      >
        <h2 id="help-shortcuts">{{ t('shortcuts') }}</h2>
        <ul class="help-shortcuts">
          <li
            v-for="row in shortcuts"
            :key="row.keys"
          >
            <span>{{ row.label }}</span>
            <kbd>{{ row.keys }}</kbd>
          </li>
        </ul>
      </v-card>

      <v-card
        tag="section"
        class="help-card"
        aria-labelledby="help-contact"
      >
        <h2 id="help-contact">{{ t('helpContact') }}</h2>
        <p class="help-muted">{{ t('helpContactText') }}</p>
        <div class="help-version">
          <span>
            <small>{{ t('helpVersion') }}</small>
            <code>{{ version }}</code>
          </span>
          <v-btn
            variant="text"
            color="primary"
            :prepend-icon="copyState === 'copied' ? 'mdi-check' : 'mdi-content-copy'"
            @click="copyVersion"
            >{{
              t(copyState === 'copied' ? 'copied' : copyState === 'failed' ? 'copyFailed' : 'copy')
            }}</v-btn
          >
        </div>
        <span
          class="help-sr-status"
          role="status"
          >{{
            copyState === 'idle' ? '' : t(copyState === 'copied' ? 'copied' : 'copyFailed')
          }}</span
        >
      </v-card>
    </div>
  </div>
</template>
<style scoped>
.help-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
  gap: var(--workstel-space-4);
  align-items: start;
}
.help-column {
  display: grid;
  gap: var(--workstel-space-4);
  min-width: 0;
}
.help-card {
  padding: var(--workstel-space-5) 22px;
  min-width: 0;
}
.help-card--flush {
  padding-bottom: var(--workstel-space-2);
}
.help-card h2 {
  display: flex;
  align-items: center;
  gap: var(--workstel-space-2);
  font-size: var(--workstel-font-md);
  font-weight: var(--workstel-weight-semibold);
  line-height: var(--workstel-leading-tight);
}
.help-card h2 .v-icon {
  color: var(--workstel-primary-text);
}
.help-steps,
.help-tips,
.help-shortcuts {
  list-style: none;
  margin: var(--workstel-space-3) 0 0;
  padding: 0;
}
.help-steps li {
  display: flex;
  align-items: flex-start;
  gap: var(--workstel-space-3);
  padding: var(--workstel-space-2) 0;
  font-size: var(--workstel-font-sm);
  line-height: var(--workstel-leading-relaxed);
}
.help-step-number {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--workstel-info-bg);
  color: var(--workstel-primary-text);
  font-size: var(--workstel-font-xs);
  font-weight: var(--workstel-weight-bold);
}
.help-tips li {
  position: relative;
  padding: var(--workstel-space-1_5) 0 var(--workstel-space-1_5) 18px;
  font-size: var(--workstel-font-sm);
  line-height: var(--workstel-leading-relaxed);
}
.help-tips li::before {
  content: '';
  position: absolute;
  left: 4px;
  top: 15px;
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--workstel-text-secondary);
}
.help-warning {
  display: flex;
  align-items: flex-start;
  gap: var(--workstel-space-2);
  margin-top: var(--workstel-space-2_5);
  padding: var(--workstel-space-2_5) var(--workstel-space-3);
  border-radius: var(--workstel-radius-md);
  background: var(--workstel-warning-bg);
  color: var(--workstel-warning-text);
  font-size: var(--workstel-font-sm);
  line-height: var(--workstel-leading-relaxed);
}
.help-warning .v-icon {
  flex-shrink: 0;
  margin-top: var(--workstel-space-0_5);
}
.help-action {
  margin: var(--workstel-space-2) 0 -6px -12px;
}
.help-faq {
  margin-top: var(--workstel-space-2);
}
.help-faq :deep(.v-expansion-panel) {
  background: transparent;
}
.help-faq :deep(.v-expansion-panel:not(:first-child)) {
  border-top: 1px solid var(--workstel-border);
}
.help-faq :deep(.v-expansion-panel::after) {
  display: none;
}
.help-faq :deep(.v-expansion-panel-title) {
  min-height: var(--workstel-row-sm);
  padding: var(--workstel-space-2_5) 0;
  font-size: var(--workstel-font-sm);
  font-weight: var(--workstel-weight-semibold);
}
.help-faq :deep(.v-expansion-panel-title__overlay) {
  display: none;
}
.help-faq :deep(.v-expansion-panel-text__wrapper) {
  padding: 0 0 var(--workstel-space-3);
  font-size: var(--workstel-font-sm);
  line-height: var(--workstel-leading-relaxed);
  color: var(--workstel-text-secondary);
}
.help-shortcuts li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--workstel-space-4);
  padding: 9px 0;
  border-top: 1px solid var(--workstel-border);
  font-size: var(--workstel-font-sm);
}
.help-shortcuts li:first-child {
  border-top: 0;
}
kbd {
  flex-shrink: 0;
  font: inherit;
  font-size: var(--workstel-font-xs);
  min-width: 30px;
  padding: 3px 7px;
  text-align: center;
  border: 1px solid var(--workstel-border);
  border-bottom-width: 2px;
  border-radius: var(--workstel-radius-sm);
  background: var(--workstel-surface-muted);
  color: var(--workstel-text-secondary);
}
.help-muted {
  margin-top: var(--workstel-space-2);
  font-size: var(--workstel-font-sm);
  line-height: var(--workstel-leading-relaxed);
  color: var(--workstel-text-secondary);
}
.help-version {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--workstel-space-2);
  margin-top: var(--workstel-space-3);
  padding: var(--workstel-space-2) var(--workstel-space-1) var(--workstel-space-2)
    var(--workstel-space-3);
  border-radius: var(--workstel-radius-md);
  background: var(--workstel-surface-muted);
}
.help-version > span {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.help-version small {
  font-size: var(--workstel-font-xs);
  color: var(--workstel-text-secondary);
}
.help-version code {
  font-family: 'Noto Sans', sans-serif;
  font-size: var(--workstel-font-sm);
  overflow-wrap: anywhere;
}
.help-sr-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
@media (max-width: 680px) {
  .help-grid {
    grid-template-columns: minmax(0, 1fr);
  }
  .help-grid,
  .help-column {
    gap: var(--workstel-space-2_5);
  }
  .help-card {
    padding: var(--workstel-space-3_5);
  }
  .help-card .v-btn {
    min-height: var(--workstel-touch-target);
  }
}
</style>
