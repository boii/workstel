<script setup lang="ts">
import { dialogWidth } from '../../../shared/dialog-widths';
import { ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import {
  errorMessage,
  formatKilometres,
  formatTime,
  fuelKeys,
  itemKeys,
  useVehicleMessages,
} from '../composables/useVehicleMessages';
import { checklistItems } from '../types';
import type { Inspection, Page, Vehicle } from '../types';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  vehicle: Vehicle | null;
  load: (before: string | null, signal: AbortSignal) => Promise<Page<Inspection>>;
}>();
const messages = useVehicleMessages();
const entries = ref<Inspection[]>([]);
const next = ref<string | null>(null);
const loading = ref(false);
const failure = ref('');
let controller: AbortController | null = null;
async function fetchPage(before: string | null) {
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
const issues = (entry: Inspection) =>
  checklistItems.filter((item) => entry.items[item] === 'issue');
</script>
<template>
  <ModuleDialog
    v-model="open"
    fullscreen
    :title="messages.historyTitle"
    :subtitle="vehicle ? vehicle.name + ' · ' + vehicle.plateNumber : ''"
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
      class="history-empty"
    >
      {{ messages.noHistory }}
    </p>
    <ol
      v-else
      class="history-list"
    >
      <li
        v-for="entry in entries"
        :key="entry.id"
      >
        <div class="history-heading">
          <strong>{{ formatTime(entry.inspectedAt) }}</strong>
          <span
            class="vehicle-result"
            :class="'vehicle-result--' + entry.result"
            >{{ entry.result === 'pass' ? messages.pass : messages.attention }}</span
          >
        </div>
        <dl class="history-details">
          <dt>{{ messages.inspectedBy }}</dt>
          <dd>{{ entry.inspectorEmail || '—' }}</dd>
          <dt>{{ messages.fuelLevel }}</dt>
          <dd>{{ messages[fuelKeys[entry.fuelLevel]] }}</dd>
          <dt>{{ messages.odometer }}</dt>
          <dd>{{ entry.odometerKm === null ? '—' : formatKilometres(entry.odometerKm) }}</dd>
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
          <template v-if="entry.notes">
            <dt>{{ messages.notes }}</dt>
            <dd class="history-notes">{{ entry.notes }}</dd>
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
<style scoped>
.history-empty {
  color: var(--workstel-text-secondary);
}
.history-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.history-list li {
  padding: var(--workstel-space-3) 0;
  border-top: 1px solid var(--workstel-border);
}
.history-list li:first-child {
  border-top: 0;
  padding-top: 0;
}
.history-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--workstel-space-2);
}
.history-heading strong {
  font-size: var(--workstel-font-sm);
  font-weight: var(--workstel-weight-semibold);
}
.history-details {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: var(--workstel-space-1) var(--workstel-space-3);
  margin-top: var(--workstel-space-2);
  font-size: var(--workstel-font-sm);
}
.history-details dt {
  color: var(--workstel-text-secondary);
}
.history-details dd {
  margin: 0;
  overflow-wrap: anywhere;
}
.history-notes {
  white-space: pre-wrap;
}
@media (max-width: 680px) {
  .history-details {
    grid-template-columns: 100px minmax(0, 1fr);
  }
}
</style>
