<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import ModulePage from '../shared/ModulePage.vue';
import FilterGroup from '../shared/filter-group.vue';
import en from './locales/en';
import id from './locales/id';
import { authenticatedRpc, parseAudit } from './audit-api';
import type { AuditEvent } from './audit-api';
import { locale } from '../i18n';
import { demoAuditEvents } from './demo-audit';

// Platform events only (workstel_admin_list_audit). Module events stay in each module's reader.
const props = defineProps<{ demo: boolean }>();
const messages = computed(() => (locale.value === 'id' ? id : en));

const events = ref<AuditEvent[]>([]);
const loading = ref(false);
const failed = ref(false);
const search = ref('');
const outcome = ref<'all' | 'success' | 'denied'>('all');

const outcomes = computed(() => [
  { value: 'all', title: messages.value.auditAllOutcomes },
  { value: 'success', title: messages.value.success },
  { value: 'denied', title: messages.value.denied },
]);
const filtered = computed(() => {
  const query = search.value.trim().toLowerCase();
  return events.value.filter(
    (event) =>
      (outcome.value === 'all' || event.outcome === outcome.value) &&
      (!query ||
        [
          event.action,
          event.actor_id,
          event.actor_database_role,
          event.resource_id,
          event.correlation_id,
          scopeName(event),
        ].some((value) => value?.toLowerCase().includes(query))),
  );
});
// Filters other than search; on phones they share one Filters button.
const filterCount = computed(() => (outcome.value !== 'all' ? 1 : 0));
const hasFilters = computed(() => !!search.value || outcome.value !== 'all');

let sequence = 0;
let controller: AbortController | undefined;
async function load() {
  const current = ++sequence;
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  failed.value = false;
  events.value = [];
  if (props.demo) {
    events.value = demoAuditEvents();
    loading.value = false;
    return;
  }
  try {
    const result = await authenticatedRpc(
      'workstel_admin_list_audit',
      { p_limit: 100 },
      controller.signal,
    );
    if (current === sequence) events.value = parseAudit(result.data);
  } catch {
    if (current === sequence) failed.value = true;
  } finally {
    if (current === sequence) loading.value = false;
  }
}
onMounted(() => void load());
onUnmounted(() => {
  ++sequence;
  controller?.abort();
});

function resetFilters() {
  search.value = '';
  outcome.value = 'all';
}
function scopeName(event: AuditEvent) {
  if (event.department_name)
    return event.hotel_name
      ? event.hotel_name + ' · ' + event.department_name
      : event.department_name;
  return event.hotel_name ?? messages.value.platform;
}
function date(value: string) {
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}
</script>
<template>
  <ModulePage
    :title="messages.auditTitle"
    :description="
      filtered.length +
      ' / ' +
      events.length +
      ' ' +
      messages.auditEvents +
      ' · ' +
      messages.auditHint
    "
    :loading="loading"
    :error="failed ? messages.loadError : ''"
    :empty="!filtered.length"
    :empty-icon="hasFilters ? 'mdi-filter-off-outline' : 'mdi-history'"
    :empty-title="hasFilters ? messages.auditNoResults : messages.auditEmpty"
    :empty-description="hasFilters ? messages.auditNoResultsHint : messages.auditEmptyHint"
    :retry-label="messages.retry"
    @retry="load"
  >
    <template #toolbar>
      <v-alert
        type="info"
        variant="tonal"
        density="compact"
        icon="mdi-shield-search"
        class="admin-audit-notice"
        >{{ messages.auditScope }}</v-alert
      >
      <div class="admin-audit-toolbar">
        <v-text-field
          v-model="search"
          class="admin-audit-search"
          :placeholder="messages.auditSearch"
          :aria-label="messages.auditSearch"
          prepend-inner-icon="mdi-magnify"
          single-line
          clearable
          maxlength="150"
          @update:model-value="search = $event ?? ''"
        />
        <FilterGroup
          :count="filterCount"
          @reset="outcome = 'all'"
        >
          <v-select
            v-model="outcome"
            :items="outcomes"
            :label="messages.auditOutcome"
          />
        </FilterGroup>
        <v-btn
          class="admin-audit-refresh"
          icon="mdi-refresh"
          variant="text"
          color="primary"
          :loading="loading"
          :aria-label="messages.refresh"
          :title="messages.refresh"
          @click="load"
        />
      </div>
    </template>
    <template #empty-action>
      <v-btn
        v-if="hasFilters"
        variant="text"
        color="primary"
        @click="resetFilters"
        >{{ messages.reset }}</v-btn
      >
    </template>
    <ol class="admin-audit-list">
      <li
        v-for="event in filtered"
        :key="event.id"
      >
        <details class="admin-audit-event">
          <summary :title="messages.auditDetails">
            <!-- Long action names break after a dot, never inside a word. -->
            <strong class="admin-audit-action"
              ><template
                v-for="(part, index) in event.action.split('.')"
                :key="index"
                ><template v-if="index">.<wbr /></template>{{ part }}</template
              ></strong
            >
            <time
              class="admin-audit-time"
              :datetime="event.occurred_at"
              >{{ date(event.occurred_at) }}</time
            >
            <span class="admin-audit-scope-name">{{ scopeName(event) }}</span>
            <span
              class="admin-audit-actor"
              :title="event.actor_id ?? event.actor_database_role"
              >{{
                event.actor_id ? event.actor_id.slice(0, 8) + '…' : event.actor_database_role
              }}</span
            >
            <span
              class="admin-audit-outcome"
              :class="'admin-audit-outcome--' + event.outcome"
              ><span aria-hidden="true">●</span
              >{{ event.outcome === 'success' ? messages.success : messages.denied }}</span
            >
            <v-icon
              class="admin-audit-chevron"
              icon="mdi-chevron-down"
              size="var(--workstel-icon-md)"
            />
          </summary>
          <dl class="admin-audit-details">
            <dt>{{ messages.auditWhen }}</dt>
            <dd>{{ date(event.occurred_at) }}</dd>
            <dt>{{ messages.actor }}</dt>
            <dd>{{ event.actor_id ?? event.actor_database_role }}</dd>
            <dt>{{ messages.scope }}</dt>
            <dd>{{ scopeName(event) }}</dd>
            <template v-if="event.resource_id">
              <dt>{{ messages.resource }}</dt>
              <dd>{{ event.resource_id }}</dd>
            </template>
            <dt>{{ messages.correlation }}</dt>
            <dd>{{ event.correlation_id }}</dd>
            <dt>{{ messages.auditEvent }}</dt>
            <dd>{{ event.id }}</dd>
          </dl>
        </details>
      </li>
    </ol>
  </ModulePage>
</template>
<style scoped>
.admin-audit-notice {
  font-size: var(--workstel-font-xs) !important;
  line-height: var(--workstel-leading-normal);
  margin-bottom: var(--workstel-space-3);
}
.admin-audit-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 180px) 40px;
  align-items: center;
  gap: var(--workstel-space-2);
}
.admin-audit-toolbar > * {
  min-width: 0;
}
.admin-audit-list {
  list-style: none;
  margin: 0;
  padding: 0;
  background: rgb(var(--v-theme-surface));
  border: 1px solid var(--workstel-border);
  border-radius: var(--workstel-radius-md);
  overflow: hidden;
}
.admin-audit-list li + li {
  border-top: 1px solid var(--workstel-border);
}
.admin-audit-event summary {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) 150px minmax(60px, 0.5fr) 95px 80px 18px;
  gap: var(--workstel-space-3);
  align-items: center;
  min-height: var(--workstel-row-sm);
  padding: var(--workstel-space-2) var(--workstel-space-4);
  line-height: var(--workstel-leading-normal);
  cursor: pointer;
  list-style: none;
}
.admin-audit-event summary::-webkit-details-marker {
  display: none;
}
.admin-audit-event summary:hover {
  background: rgba(var(--v-theme-primary), 0.035);
}
.admin-audit-event summary:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}
.admin-audit-action {
  font-size: var(--workstel-font-sm);
  font-weight: var(--workstel-weight-semibold);
  overflow-wrap: break-word;
}
.admin-audit-time,
.admin-audit-scope-name,
.admin-audit-actor {
  color: var(--workstel-text-secondary);
  font-size: var(--workstel-font-xs);
  overflow-wrap: anywhere;
}
.admin-audit-time {
  font-family: 'Noto Sans', sans-serif;
}
.admin-audit-actor {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.admin-audit-outcome {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--workstel-font-xs);
  color: var(--workstel-text-secondary);
}
.admin-audit-outcome > span {
  font-size: 7px;
}
.admin-audit-outcome--success > span {
  color: var(--workstel-success-text);
}
.admin-audit-outcome--denied > span {
  color: var(--workstel-danger-text);
}
.admin-audit-chevron {
  color: var(--workstel-text-secondary);
}
.admin-audit-event[open] .admin-audit-chevron {
  transform: rotate(180deg);
}
.admin-audit-details {
  display: grid;
  grid-template-columns: 155px minmax(0, 1fr);
  gap: 7px var(--workstel-space-3);
  margin: 0;
  padding: var(--workstel-space-3) var(--workstel-space-4) var(--workstel-space-4);
  background: var(--workstel-surface-subtle);
  border-top: 1px solid var(--workstel-border);
  font-size: var(--workstel-font-xs);
}
.admin-audit-details dt {
  color: var(--workstel-text-secondary);
}
.admin-audit-details dd {
  margin: 0;
  font-family: 'Noto Sans', sans-serif;
  overflow-wrap: anywhere;
}
@media (max-width: 680px) {
  /* Search, the Filters button and Refresh share one row. */
  .admin-audit-toolbar {
    grid-template-columns: minmax(0, 1fr) auto 44px;
  }
  .admin-audit-refresh {
    width: var(--workstel-touch-target);
    height: var(--workstel-touch-target);
  }
  .admin-audit-event summary {
    grid-template-columns: minmax(0, 1fr) auto 18px;
    gap: var(--workstel-space-1) var(--workstel-space-2_5);
    padding: var(--workstel-space-2_5) var(--workstel-space-3);
    min-height: var(--workstel-row-lg);
  }
  .admin-audit-action {
    grid-column: 1;
    grid-row: 1;
  }
  .admin-audit-outcome {
    grid-column: 2;
    grid-row: 1;
  }
  .admin-audit-time {
    grid-column: 1;
    grid-row: 2;
  }
  .admin-audit-scope-name {
    grid-column: 2;
    grid-row: 2;
    text-align: right;
  }
  .admin-audit-chevron {
    grid-column: 3;
    grid-row: 1 / 3;
  }
  .admin-audit-actor {
    display: none;
  }
  .admin-audit-details {
    grid-template-columns: 115px minmax(0, 1fr);
    gap: var(--workstel-space-2);
    padding: var(--workstel-space-3);
  }
}
</style>
