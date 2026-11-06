<script setup lang="ts">
import { dialogWidth } from '../../../shared/dialog-widths';
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import OptionalFields from '../../../shared/optional-fields.vue';
import { t } from '../../../i18n';
import {
  errorMessage,
  fuelKeys,
  itemKeys,
  useVehicleMessages,
} from '../composables/useVehicleMessages';
import { checklistItems, fuelLevels } from '../types';
import type { ChecklistItem, FuelLevel, InspectionInput, ItemState, Vehicle } from '../types';
import { hasIssue, parseOdometer, validateInspection } from '../validation';
import type { InspectionField, ValidationError } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  vehicle: Vehicle | null;
  record: (input: InspectionInput, idempotencyKey: string) => Promise<void>;
}>();
const messages = useVehicleMessages();
const odometer = ref('');
const fuelLevel = ref<FuelLevel>('full');
const items = ref<Partial<Record<ChecklistItem, ItemState>>>({});
const notes = ref('');
const errors = ref<Partial<Record<InspectionField, ValidationError>>>({});
const saving = ref(false);
const failure = ref('');
// One key per opened form, so a retried submit after a network error is not recorded twice.
let idempotencyKey = '';
watch(open, (value) => {
  if (!value) return;
  odometer.value = '';
  fuelLevel.value = 'full';
  items.value = {};
  notes.value = '';
  errors.value = {};
  failure.value = '';
  idempotencyKey = crypto.randomUUID();
});
const issueMarked = computed(() => hasIssue(items.value));
function markAllOk() {
  items.value = Object.fromEntries(checklistItems.map((item) => [item, 'ok']));
  if (errors.value.items) errors.value = { ...errors.value, items: undefined };
}
async function submit() {
  if (saving.value || !props.vehicle) return;
  errors.value = validateInspection({
    odometer: odometer.value,
    fuelLevel: fuelLevel.value,
    items: items.value,
    notes: notes.value,
  });
  const invalid = (Object.keys(errors.value) as InspectionField[]).find((key) => errors.value[key]);
  if (invalid) {
    document.getElementById('inspection-' + invalid)?.focus();
    return;
  }
  saving.value = true;
  failure.value = '';
  try {
    await props.record(
      {
        odometerKm: parseOdometer(odometer.value) ?? null,
        fuelLevel: fuelLevel.value,
        items: items.value as Record<ChecklistItem, ItemState>,
        notes: notes.value,
      },
      idempotencyKey,
    );
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    saving.value = false;
  }
}
const fieldError = (field: InspectionField) => {
  const key = errors.value[field];
  if (!key) return '';
  return field === 'items' ? messages.value.itemsRequired : messages.value[key];
};
</script>
<template>
  <ModuleDialog
    v-model="open"
    :title="messages.inspectionTitle"
    :subtitle="vehicle ? vehicle.name + ' · ' + vehicle.plateNumber : ''"
    :busy="saving"
    :width="dialogWidth.xl"
  >
    <v-form
      id="inspection-form"
      @submit.prevent="submit"
    >
      <v-alert
        v-if="failure"
        type="error"
        variant="tonal"
        role="alert"
        class="mb-4"
        >{{ failure }}</v-alert
      >
      <div class="inspection-row">
        <div>
          <label
            for="inspection-odometerKm"
            class="field-label inspection-first-label"
            >{{ messages.odometer }}</label
          ><v-text-field
            id="inspection-odometerKm"
            v-model="odometer"
            :disabled="saving"
            inputmode="numeric"
            maxlength="7"
            :hint="messages.odometerHint"
            :error-messages="fieldError('odometerKm')"
          />
        </div>
        <div>
          <span
            id="inspection-fuel-label"
            class="field-label inspection-first-label"
            >{{ messages.fuelLevel }}</span
          ><v-btn-toggle
            v-model="fuelLevel"
            mandatory
            variant="outlined"
            color="primary"
            density="comfortable"
            class="choice-group inspection-fuel"
            role="radiogroup"
            aria-labelledby="inspection-fuel-label"
            :disabled="saving"
            ><v-btn
              v-for="level in fuelLevels"
              :key="level"
              :value="level"
              role="radio"
              :aria-checked="fuelLevel === level"
              >{{ messages[fuelKeys[level]] }}</v-btn
            ></v-btn-toggle
          >
        </div>
      </div>
      <div class="inspection-checklist-heading">
        <span
          id="inspection-items"
          class="field-label"
          tabindex="-1"
          >{{ messages.checklist }}</span
        ><v-btn
          variant="text"
          color="primary"
          size="small"
          :disabled="saving"
          @click="markAllOk"
          >{{ messages.markAllOk }}</v-btn
        >
      </div>
      <p
        class="inspection-hint"
        :class="{ 'inspection-error': errors.items }"
        :role="errors.items ? 'alert' : undefined"
      >
        {{ errors.items ? messages.itemsRequired : messages.checklistHint }}
      </p>
      <ul class="inspection-items">
        <li
          v-for="item in checklistItems"
          :key="item"
          :class="{ 'inspection-item--issue': items[item] === 'issue' }"
        >
          <span :id="'inspection-item-' + item">{{ messages[itemKeys[item]] }}</span>
          <v-btn-toggle
            v-model="items[item]"
            variant="outlined"
            density="comfortable"
            class="choice-group"
            :color="items[item] === 'issue' ? 'error' : 'primary'"
            :aria-labelledby="'inspection-item-' + item"
            :disabled="saving"
            ><v-btn
              value="ok"
              prepend-icon="mdi-check"
              >{{ messages.ok }}</v-btn
            ><v-btn
              value="issue"
              prepend-icon="mdi-alert-outline"
              >{{ messages.issue }}</v-btn
            ></v-btn-toggle
          >
        </li>
      </ul>
      <OptionalFields
        :label="t('addNotes')"
        :filled="!!notes || issueMarked || !!fieldError('notes')"
        :reset-key="open"
      >
        <label
          for="inspection-notes"
          class="field-label"
          >{{ messages.notes }}</label
        ><v-textarea
          id="inspection-notes"
          v-model="notes"
          :disabled="saving"
          rows="2"
          auto-grow
          maxlength="1000"
          :hint="issueMarked ? messages.notesHint : ''"
          :persistent-hint="issueMarked"
          :error-messages="fieldError('notes')"
        />
      </OptionalFields>
    </v-form>
    <template #actions>
      <v-btn
        variant="text"
        :disabled="saving"
        @click="open = false"
        >{{ messages.cancel }}</v-btn
      ><v-btn
        color="primary"
        type="submit"
        form="inspection-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ messages.saveInspection }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
<style scoped>
.inspection-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.4fr);
  gap: var(--workstel-space-4);
}
.inspection-first-label {
  margin-top: 0;
}
.inspection-fuel {
  width: 100%;
  flex-wrap: nowrap;
}
.inspection-fuel .v-btn {
  flex: 1;
  min-width: 0;
  padding: 0 var(--workstel-space-1);
  font-size: var(--workstel-font-sm);
}
.inspection-checklist-heading {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--workstel-space-2);
}
.inspection-checklist-heading .field-label {
  margin-bottom: 0;
}
.inspection-hint {
  margin: var(--workstel-space-0_5) 0 var(--workstel-space-3);
  font-size: var(--workstel-font-xs);
  color: var(--workstel-text-secondary);
}
.inspection-hint.inspection-error {
  color: rgb(var(--v-theme-error));
}
.inspection-items {
  list-style: none;
  margin: 0;
  padding: 0;
  border: 1px solid var(--workstel-border);
  border-radius: var(--workstel-radius-md);
}
.inspection-items li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--workstel-space-3);
  min-height: var(--workstel-row-md);
  padding: var(--workstel-space-2) var(--workstel-space-2) var(--workstel-space-2)
    var(--workstel-space-3);
  font-size: var(--workstel-font-sm);
}
.inspection-items li + li {
  border-top: 1px solid var(--workstel-border);
}
.inspection-item--issue {
  background: var(--workstel-warning-bg);
}
.inspection-items .v-btn-toggle {
  flex-shrink: 0;
}
.inspection-items .v-btn {
  font-size: var(--workstel-font-sm);
  padding: 0 var(--workstel-space-2_5);
}
@media (max-width: 680px) {
  .inspection-row {
    grid-template-columns: minmax(0, 1fr);
    gap: 0;
  }
  /* Stacked columns need the normal gap above the second label. */
  .inspection-row > div + div .inspection-first-label {
    margin-top: var(--workstel-space-5);
  }
  .inspection-checklist-heading .v-btn {
    min-height: var(--workstel-touch-target);
  }
}
</style>
