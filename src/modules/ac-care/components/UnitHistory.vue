<script setup lang="ts">
import { dialogWidth } from '../../../shared/dialog-widths';
import { ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import {
  complaintKeys,
  errorMessage,
  formatDateTime,
  formatNumber,
  itemKeys,
  reasonKeys,
  serviceKeys,
  shortName,
  useAcCareMessages,
} from '../composables/useAcCareMessages';
import { checklistItems } from '../types';
import type { AcUnit, HistoryCursor, HistoryEntry, HistoryPage } from '../types';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  unit: AcUnit | null;
  load: (before: HistoryCursor | null, signal: AbortSignal) => Promise<HistoryPage>;
}>();
const messages = useAcCareMessages();
const entries = ref<HistoryEntry[]>([]);
const next = ref<HistoryCursor | null>(null);
const loading = ref(false);
const failure = ref('');
let controller: AbortController | null = null;
async function fetchPage(before: HistoryCursor | null) {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  loading.value = true;
  failure.value = '';
  try {
    const page = await props.load(before, signal);
    entries.value = before ? [...entries.value, ...page.data] : page.data;
    next.value = page.nextCursor;
  } catch (error) {
    if (!signal.aborted) failure.value = errorMessage(messages.value, error);
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
watch(open, (value) => {
  if (value) {
    entries.value = [];
    next.value = null;
    void fetchPage(null);
  } else controller?.abort();
});
const issues = (entry: HistoryEntry & { kind: 'service' }) =>
  checklistItems.filter((item) => entry.items[item] === 'issue');
const readings = (entry: HistoryEntry & { kind: 'service' }) => {
  const parts: string[] = [];
  if (entry.returnTemp !== null && entry.supplyTemp !== null)
    parts.push(
      formatNumber(entry.returnTemp) +
        ' → ' +
        formatNumber(entry.supplyTemp) +
        ' °C (Δ ' +
        formatNumber(entry.returnTemp - entry.supplyTemp) +
        ')',
    );
  if (entry.pressurePsi !== null) parts.push(entry.pressurePsi + ' psi');
  if (entry.currentAmp !== null) parts.push(formatNumber(entry.currentAmp) + ' A');
  return parts.join(' · ');
};
</script>
<template>
  <ModuleDialog
    v-model="open"
    fullscreen
    :title="messages.historyTitle"
    :subtitle="unit ? unit.code + ' · ' + unit.location : ''"
    :width="dialogWidth.xl"
  >
    <v-alert
      v-if="failure"
      type="error"
      variant="tonal"
      role="alert"
      >{{ failure
      }}<v-btn
        variant="text"
        @click="fetchPage(null)"
        >{{ messages.retry }}</v-btn
      ></v-alert
    >
    <v-skeleton-loader
      v-else-if="loading && !entries.length"
      type="list-item-three-line@3"
    />
    <p
      v-else-if="!entries.length"
      class="ac-hint"
    >
      {{ messages.noHistory }}
    </p>
    <ol
      v-else
      class="ac-history"
    >
      <li
        v-for="entry in entries"
        :key="entry.id"
      >
        <div class="ac-history-heading">
          <strong>
            <v-icon
              :icon="entry.kind === 'service' ? 'mdi-wrench-outline' : 'mdi-message-alert-outline'"
              size="var(--workstel-icon-sm)"
            />
            {{
              entry.kind === 'service'
                ? messages[serviceKeys[entry.serviceType]]
                : messages.complaintLabel + ': ' + messages[complaintKeys[entry.complaint]]
            }}
          </strong>
          <span
            v-if="entry.kind === 'service'"
            class="list-row-chip"
            :class="entry.result === 'normal' ? 'ac-chip--success' : 'ac-chip--warning'"
            >{{
              entry.result === 'normal' ? messages.resultNormal : messages.resultAttention
            }}</span
          >
        </div>
        <dl class="ac-history-details">
          <dt>{{ messages.by }}</dt>
          <dd :title="entry.byEmail">
            {{ shortName(entry.byEmail) || '—' }} · {{ formatDateTime(entry.at) }}
          </dd>
          <template v-if="entry.kind === 'service'">
            <template v-if="readings(entry)">
              <dt>{{ messages.readings }}</dt>
              <dd>{{ readings(entry) }}</dd>
            </template>
            <dt>{{ messages.issues }}</dt>
            <dd>
              {{
                issues(entry).length
                  ? issues(entry)
                      .map((item) => messages[itemKeys[item]])
                      .join(', ')
                  : messages.noIssues
              }}
            </dd>
            <template v-if="entry.refrigerantAdded">
              <dt>{{ messages.refrigerantAdded }}</dt>
              <dd>{{ messages.yes }}</dd>
            </template>
            <template v-if="entry.reasons.length">
              <dt>{{ messages.result }}</dt>
              <dd>{{ entry.reasons.map((reason) => messages[reasonKeys[reason]]).join('; ') }}</dd>
            </template>
          </template>
          <template v-if="entry.notes">
            <dt>{{ messages.notes }}</dt>
            <dd class="ac-history-notes">{{ entry.notes }}</dd>
          </template>
        </dl>
      </li>
    </ol>
    <v-btn
      v-if="next && !failure"
      variant="text"
      color="primary"
      :loading="loading"
      class="mt-2"
      @click="fetchPage(next)"
      >{{ messages.loadMore }}</v-btn
    >
  </ModuleDialog>
</template>
