<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import { vaultRpc, parseAudit } from '../live-api';
import type { AuditEvent } from '../live-api';
import type { StaffAssignment } from '../../../auth/useAuth';
import { locale } from '../../../i18n';
import { useVaultMessages } from '../composables/useVaultMessages';
const open = defineModel<boolean>({ required: true });
const props = defineProps<{ hotelId: string; assignments: StaffAssignment[] }>();
const messages = useVaultMessages();
const events = ref<AuditEvent[]>([]),
  loading = ref(false),
  failed = ref(false),
  department = ref<string | null>(null);
const departments = computed(() =>
  props.assignments
    .filter((a) => a.hotelId === props.hotelId && a.canAudit)
    .map((a) => ({ value: a.departmentId, title: a.departmentName })),
);
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
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
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
  <v-dialog
    v-model="open"
    max-width="820"
    scrollable
  >
    <v-card class="vault-dialog">
      <div class="vault-dialog-heading">
        <h2>{{ messages.auditTitle }}</h2>
        <v-btn
          icon="mdi-close"
          variant="text"
          :aria-label="messages.close"
          @click="open = false"
        />
      </div>
      <p class="vault-field-hint">{{ messages.auditHint }}</p>
      <v-card-text class="pa-0">
        <div class="vault-audit-toolbar">
          <v-select
            v-model="department"
            :label="messages.department"
            :items="departments"
            clearable
            @update:model-value="load"
          />
          <v-btn
            variant="text"
            color="primary"
            :loading="loading"
            @click="load"
            >{{ messages.refresh }}</v-btn
          >
        </div>
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
        <p
          v-else-if="!events.length"
          class="vault-field-hint"
        >
          {{ messages.auditEmpty }}
        </p>
        <ol
          v-else
          class="vault-audit-list"
        >
          <li
            v-for="event in events"
            :key="event.id"
          >
            <div class="vault-audit-heading">
              <strong>{{ event.action }}</strong
              ><v-chip
                size="small"
                :color="event.outcome === 'success' ? 'success' : 'error'"
                >{{ event.outcome === 'success' ? messages.success : messages.denied }}</v-chip
              >
            </div>
            <p>{{ departmentName(event.department_id) }} · {{ date(event.occurred_at) }}</p>
            <dl class="vault-details">
              <dt>{{ messages.actor }}</dt>
              <dd>{{ event.actor_id ?? event.actor_database_role }}</dd>
              <dt v-if="event.resource_id">{{ messages.resource }}</dt>
              <dd v-if="event.resource_id">{{ event.resource_id }}</dd>
              <dt>{{ messages.correlation }}</dt>
              <dd>{{ event.correlation_id }}</dd>
            </dl>
          </li>
        </ol>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>
<style scoped>
.vault-audit-list {
  list-style: none;
  padding: 0;
}
.vault-audit-list li {
  padding: 18px 0;
  border-top: 1px solid #e8edf0;
  overflow-wrap: anywhere;
}
.vault-audit-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  font-size: 13px;
}
.vault-audit-list p {
  font-size: 12px;
  color: #73818b;
  margin: 8px 0;
}
</style>
