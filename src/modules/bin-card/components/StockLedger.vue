<script setup lang="ts">
import { dialogWidth } from '../../../shared/dialog-widths';
import { ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import {
  entryKeys,
  errorMessage,
  formatQuantity,
  formatTime,
  useBinCardMessages,
} from '../composables/useBinCardMessages';
import type { Page, StockEntry, StockItem } from '../types';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  item: StockItem | null;
  load: (before: string | null, signal: AbortSignal) => Promise<Page<StockEntry>>;
}>();
const messages = useBinCardMessages();
const entries = ref<StockEntry[]>([]);
const next = ref<string | null>(null);
const loading = ref(false);
const failure = ref('');
let controller: AbortController | null = null;
async function fetchPage(before: string | null) {
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  failure.value = '';
  try {
    const page = await props.load(before, controller.signal);
    entries.value = before ? [...entries.value, ...page.data] : page.data;
    next.value = page.nextCursor;
  } catch (error) {
    if (!controller.signal.aborted) failure.value = errorMessage(messages.value, error);
  } finally {
    loading.value = false;
  }
}
watch(open, (value) => {
  if (value) {
    entries.value = [];
    next.value = null;
    void fetchPage(null);
  } else controller?.abort();
});
</script>
<template>
  <ModuleDialog
    v-model="open"
    :title="messages.ledgerTitle"
    :subtitle="item ? item.code + ' · ' + item.name + ' (' + item.unit + ')' : ''"
    :width="dialogWidth['2xl']"
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
      type="table-tbody"
    />
    <p
      v-else-if="!entries.length"
      class="ledger-empty"
    >
      {{ messages.noEntries }}
    </p>
    <div
      v-else
      class="ledger-scroll stack-table-container"
      role="region"
      :aria-label="messages.ledgerTitle"
      tabindex="0"
    >
      <table class="ledger-table stack-table">
        <thead>
          <tr>
            <th scope="col">{{ messages.date }}</th>
            <th scope="col">{{ messages.entryType }}</th>
            <th
              scope="col"
              class="ledger-number"
            >
              {{ messages.change }}
            </th>
            <th
              scope="col"
              class="ledger-number"
            >
              {{ messages.balanceAfter }}
            </th>
            <th scope="col">{{ messages.reference }}</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in entries"
            :key="entry.id"
          >
            <td :data-label="messages.date">
              {{ formatTime(entry.createdAt) }}
              <small>{{ messages.by }} {{ entry.createdByEmail || '—' }}</small>
            </td>
            <td class="stack-table-primary">{{ messages[entryKeys[entry.type]] }}</td>
            <td
              class="ledger-number"
              :class="entry.quantity < 0 ? 'ledger-out' : 'ledger-in'"
              :data-label="messages.change"
            >
              {{ formatQuantity(entry.quantity, true) }}
            </td>
            <td
              class="ledger-number"
              :data-label="messages.balanceAfter"
            >
              {{ formatQuantity(entry.balanceAfter) }}
            </td>
            <td :data-label="messages.reference">
              {{ entry.reference || '—' }}
              <small v-if="entry.notes">{{ entry.notes }}</small>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
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
.ledger-empty {
  color: var(--workstel-text-secondary);
}
.ledger-scroll {
  overflow-x: auto;
  border: 1px solid var(--workstel-border);
  border-radius: var(--workstel-radius-md);
}
.ledger-table {
  width: 100%;
  min-width: 520px;
  border-collapse: collapse;
  font:
    var(--workstel-font-sm) 'Noto Sans',
    sans-serif;
}
.ledger-table th {
  padding: var(--workstel-space-2) var(--workstel-space-3);
  text-align: left;
  font-size: var(--workstel-font-xs);
  font-weight: var(--workstel-weight-regular);
  color: var(--workstel-text-secondary);
  background: var(--workstel-surface-muted);
}
.ledger-table td {
  padding: var(--workstel-space-2) var(--workstel-space-3);
  border-top: 1px solid var(--workstel-border);
  vertical-align: top;
}
.ledger-table td small {
  display: block;
  margin-top: var(--workstel-space-0_5);
  font-size: var(--workstel-font-xs);
  color: var(--workstel-text-secondary);
  overflow-wrap: anywhere;
}
.ledger-number {
  text-align: right !important;
  white-space: nowrap;
}
.ledger-in {
  color: var(--workstel-success-text);
}
.ledger-out {
  color: var(--workstel-danger-text);
}
</style>
