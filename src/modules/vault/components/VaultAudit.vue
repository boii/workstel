<script setup lang="ts">
import { dialogWidth } from '../../../shared/dialog-widths';
import { computed, onMounted, onUnmounted, ref } from 'vue';
import FilterGroup from '../../../shared/filter-group.vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import { vaultRpc, parseAudit } from '../live-api';
import type { AuditEvent } from '../live-api';
import type { StaffAssignment } from '../../../auth/useAuth';
import { locale } from '../../../i18n';
import { useVaultMessages } from '../composables/useVaultMessages';
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ hotelId: string; assignments: StaffAssignment[] }>();
const messages = useVaultMessages();
const search = ref(''),
  outcome = ref<'all' | 'success' | 'denied'>('all');
const filtered = computed(() =>
  events.value.filter(
    (event) =>
      (outcome.value === 'all' || event.outcome === outcome.value) &&
      [
        event.action,
        event.actor_id,
        event.actor_database_role,
        event.resource_id,
        event.correlation_id,
        departmentName(event.department_id),
      ].some((value) => value?.toLowerCase().includes(search.value.trim().toLowerCase())),
  ),
);
const events = ref<AuditEvent[]>([]),
  loading = ref(false),
  failed = ref(false),
  department = ref<string | null>(null);
const departments = computed(() =>
  props.assignments
    .filter((a) => a.hotelId === props.hotelId && a.canAudit)
    .map((a) => ({ value: a.departmentId, title: a.departmentName })),
);
const filterCount = computed(() => (department.value ? 1 : 0) + (outcome.value !== 'all' ? 1 : 0));
const hasFilters = computed(() => !!search.value.trim() || filterCount.value > 0);
function resetFilterGroup() {
  const reload = !!department.value;
  department.value = null;
  outcome.value = 'all';
  if (reload) void load();
}
function resetFilters() {
  search.value = '';
  resetFilterGroup();
}
let sequence = 0;
let controller: AbortController | undefined;
async function load() {
  const current = ++sequence;
  controller?.abort();
  controller = new AbortController();
  loading.value = true;
  failed.value = false;
  events.value = [];
  try {
    const result = await vaultRpc(
      'vault_list_audit',
      { p_hotel_id: props.hotelId, p_department_id: department.value, p_limit: 100 },
      controller.signal,
    );
    if (current === sequence) events.value = parseAudit(result.data, props.hotelId);
  } catch {
    if (current === sequence) failed.value = true;
  } finally {
    if (current === sequence) loading.value = false;
  }
}
function departmentName(id: string | null) {
  return (
    props.assignments.find((a) => a.hotelId === props.hotelId && a.departmentId === id)
      ?.departmentName ?? messages.value.hotel
  );
}
function date(value: string) {
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'medium',
    timeZone: 'Asia/Jakarta',
  }).format(new Date(value));
}
onMounted(() => {
  void load();
});
onUnmounted(() => {
  ++sequence;
  controller?.abort();
});
</script>
<template>
  <ModuleDialog
    v-model="open"
    class="vault-dialog"
    :title="messages.auditTitle"
    :subtitle="filtered.length + ' / ' + events.length + ' ' + messages.auditEvents"
    :width="dialogWidth['5xl']"
    fullscreen
  >
    <template #toolbar>
      <p class="vault-audit-hint">{{ messages.auditHint }}</p>
      <div class="vault-audit-controls">
        <v-text-field
          v-model="search"
          class="vault-audit-search"
          :placeholder="messages.auditSearch"
          :aria-label="messages.auditSearch"
          prepend-inner-icon="mdi-magnify"
          single-line
          hide-details
          density="compact"
          clearable
          @update:model-value="search = $event ?? ''"
        />
        <FilterGroup
          :count="filterCount"
          @reset="resetFilterGroup"
        >
          <v-select
            v-model="department"
            :label="messages.department"
            :items="departments"
            hide-details
            density="compact"
            clearable
            @update:model-value="load"
          />
          <v-select
            v-model="outcome"
            :label="messages.auditOutcome"
            :items="[
              { value: 'all', title: messages.auditAllOutcomes },
              { value: 'success', title: messages.success },
              { value: 'denied', title: messages.denied },
            ]"
            hide-details
            density="compact"
          />
        </FilterGroup>
        <v-btn
          icon="mdi-refresh"
          variant="text"
          :loading="loading"
          :aria-label="messages.refresh"
          :title="messages.refresh"
          @click="load"
        />
      </div>
    </template>
    <div
      class="vault-audit-body"
      :aria-busy="loading"
    >
      <v-skeleton-loader
        v-if="loading"
        type="list-item-two-line@3"
      />
      <v-alert
        v-else-if="failed"
        type="error"
        variant="tonal"
        role="alert"
        >{{ messages.loadError
        }}<v-btn
          variant="text"
          @click="load"
          >{{ messages.retry }}</v-btn
        ></v-alert
      >
      <div
        v-else-if="!filtered.length"
        class="vault-audit-empty"
      >
        <v-icon
          :icon="hasFilters ? 'mdi-filter-off-outline' : 'mdi-history'"
          size="var(--workstel-icon-xl)"
        />
        <p>{{ hasFilters ? messages.auditNoResults : messages.auditEmpty }}</p>
        <v-btn
          v-if="hasFilters"
          variant="text"
          color="primary"
          @click="resetFilters"
          >{{ messages.reset }}</v-btn
        >
      </div>
      <ol
        v-else
        class="vault-audit-list"
      >
        <li
          v-for="event in filtered"
          :key="event.id"
        >
          <details class="vault-audit-event">
            <summary :title="messages.auditDetails">
              <strong class="vault-audit-action">{{ event.action }}</strong>
              <time
                class="vault-audit-time"
                :datetime="event.occurred_at"
                >{{ date(event.occurred_at) }}</time
              >
              <span class="vault-audit-scope">{{ departmentName(event.department_id) }}</span>
              <span
                class="vault-audit-actor"
                :title="event.actor_id ?? event.actor_database_role"
                >{{
                  event.actor_id ? event.actor_id.slice(0, 8) + '…' : event.actor_database_role
                }}</span
              >
              <span
                class="vault-audit-outcome"
                :class="'vault-audit-outcome--' + event.outcome"
                ><span aria-hidden="true">●</span
                >{{ event.outcome === 'success' ? messages.success : messages.denied }}</span
              >
              <v-icon
                class="vault-audit-chevron"
                icon="mdi-chevron-down"
                size="var(--workstel-icon-md)"
              />
            </summary>
            <dl class="vault-audit-details">
              <dt>{{ messages.auditWhen }}</dt>
              <dd>{{ date(event.occurred_at) }}</dd>
              <dt>{{ messages.actor }}</dt>
              <dd>{{ event.actor_id ?? event.actor_database_role }}</dd>
              <dt>{{ messages.department }}</dt>
              <dd>{{ departmentName(event.department_id) }}</dd>
              <dt v-if="event.resource_id">{{ messages.resource }}</dt>
              <dd v-if="event.resource_id">{{ event.resource_id }}</dd>
              <dt>{{ messages.correlation }}</dt>
              <dd>{{ event.correlation_id }}</dd>
              <dt>{{ messages.auditEvent }}</dt>
              <dd>{{ event.id }}</dd>
            </dl>
          </details>
        </li>
      </ol>
    </div>
  </ModuleDialog>
</template>
<style scoped>
.vault-audit-hint {
  font-size: var(--workstel-font-xs);
  color: var(--workstel-text-secondary);
  margin: 0 0 var(--workstel-space-3);
  line-height: var(--workstel-leading-normal);
}
.vault-audit-controls {
  display: grid;
  grid-template-columns: minmax(0, 1fr) repeat(2, minmax(0, 180px)) 40px;
  gap: var(--workstel-space-2);
  align-items: center;
}
.vault-audit-controls > * {
  min-width: 0;
}
.vault-audit-body {
  padding: 0 !important;
  min-height: 0;
  overscroll-behavior: contain;
}
.vault-audit-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.vault-audit-list li + li {
  border-top: 1px solid var(--workstel-border);
}
.vault-audit-event summary {
  box-sizing: border-box;
  line-height: var(--workstel-leading-normal);
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) 150px minmax(60px, 0.5fr) 95px 80px 18px;
  gap: var(--workstel-space-3);
  align-items: center;
  min-height: var(--workstel-row-sm);
  padding: var(--workstel-space-2) var(--workstel-space-5);
  cursor: pointer;
  list-style: none;
}
.vault-audit-event summary::-webkit-details-marker {
  display: none;
}
.vault-audit-event summary:hover {
  background: rgba(var(--v-theme-primary), 0.035);
}
.vault-audit-event summary:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -2px;
}
.vault-audit-action {
  font-size: var(--workstel-font-sm);
  font-weight: var(--workstel-weight-semibold);
  overflow-wrap: anywhere;
}
.vault-audit-time,
.vault-audit-scope,
.vault-audit-actor {
  color: var(--workstel-text-secondary);
  font-size: var(--workstel-font-xs);
  overflow-wrap: anywhere;
}
.vault-audit-time {
  font-family: 'Noto Sans', sans-serif;
  font-size: var(--workstel-font-xs);
}
.vault-audit-actor {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.vault-audit-outcome {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: var(--workstel-font-xs);
  color: var(--workstel-text-secondary);
}
.vault-audit-outcome > span {
  font-size: 7px; /* token-exempt: status dot glyph */
}
.vault-audit-outcome--success > span {
  color: rgb(var(--v-theme-success));
}
.vault-audit-outcome--denied > span {
  color: rgb(var(--v-theme-error));
}
.vault-audit-chevron {
  color: var(--workstel-text-secondary);
}
.vault-audit-event[open] .vault-audit-chevron {
  transform: rotate(180deg);
}
.vault-audit-details {
  display: grid;
  grid-template-columns: 155px minmax(0, 1fr);
  gap: 7px var(--workstel-space-3);
  padding: var(--workstel-space-3) var(--workstel-space-5) var(--workstel-space-4);
  background: rgba(var(--v-theme-primary), 0.025);
  border-top: 1px solid var(--workstel-border);
  font-size: var(--workstel-font-xs);
}
.vault-audit-details dt {
  color: var(--workstel-text-secondary);
}
.vault-audit-details dd {
  margin: 0;
  font-family: 'Noto Sans', sans-serif;
  overflow-wrap: anywhere;
}
.vault-audit-empty {
  padding: 30px var(--workstel-space-5);
  text-align: center;
  color: var(--workstel-text-secondary);
  font-size: var(--workstel-font-sm);
}
.vault-audit-empty p {
  margin: var(--workstel-space-2) 0;
}
@media (max-width: 680px) {
  .vault-audit-hint {
    margin-bottom: var(--workstel-space-2);
  }
  .vault-audit-controls {
    grid-template-columns: minmax(0, 1fr) auto 44px;
  }
  .vault-audit-controls :deep(.v-field__input) {
    min-height: var(--workstel-touch-target);
  }
  .vault-audit-event summary {
    grid-template-columns: minmax(0, 1fr) auto 18px;
    gap: var(--workstel-space-1) var(--workstel-space-2_5);
    padding: var(--workstel-space-2) var(--workstel-space-3_5);
    min-height: var(--workstel-row-md);
  }
  .vault-audit-action {
    grid-column: 1;
    grid-row: 1;
  }
  .vault-audit-outcome {
    grid-column: 2;
    grid-row: 1;
  }
  .vault-audit-time {
    grid-column: 1;
    grid-row: 2;
  }
  .vault-audit-scope {
    grid-column: 2;
    grid-row: 2;
    text-align: right;
  }
  .vault-audit-chevron {
    grid-column: 3;
    grid-row: 1/3;
  }
  .vault-audit-actor {
    display: none;
  }
  .vault-audit-details {
    grid-template-columns: 115px minmax(0, 1fr);
    padding: var(--workstel-space-3) var(--workstel-space-4);
    gap: var(--workstel-space-2);
  }
}
</style>
