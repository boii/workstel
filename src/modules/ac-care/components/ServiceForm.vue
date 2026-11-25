<script setup lang="ts">
import { dialogWidth } from '../../../shared/dialog-widths';
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import {
  errorMessage,
  fill,
  formatDay,
  formatNumber,
  itemKeys,
  reasonKeys,
  refrigerantKeys,
  serviceKeys,
  useAcCareMessages,
} from '../composables/useAcCareMessages';
import { serviceTypes } from '../types';
import type { AcUnit, ItemState, ServiceInput, ServiceOutcome, ServiceType } from '../types';
import {
  daysBetween,
  earlyService,
  hotelToday,
  needsPressureAndCurrent,
  needsTemperatures,
  parseNumber,
  pressureRangeFor,
  previewReasons,
  serviceItems,
  validateService,
} from '../validation';
import type { ServiceField, ValidationError } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  unit: AcUnit | null;
  initialType: ServiceType;
  today: string;
  record: (input: ServiceInput, idempotencyKey: string) => Promise<ServiceOutcome>;
}>();
const messages = useAcCareMessages();
const type = ref<ServiceType>('filter');
const items = ref<Partial<Record<string, ItemState>>>({});
const returnTemp = ref('');
const supplyTemp = ref('');
const pressure = ref('');
const current = ref('');
const refrigerantAdded = ref(false);
const notes = ref('');
const errors = ref<Partial<Record<ServiceField, ValidationError>>>({});
const saving = ref(false);
const failure = ref('');
const snapshot = () =>
  JSON.stringify([
    type.value,
    items.value,
    returnTemp.value,
    supplyTemp.value,
    pressure.value,
    current.value,
    refrigerantAdded.value,
    notes.value,
  ]);
const opened = ref('');
const dirty = computed(() => snapshot() !== opened.value);
// One key per opened form, so a retried submit after a network error is not recorded twice.
let idempotencyKey = '';
watch(open, (value) => {
  if (!value) return;
  type.value = props.initialType;
  items.value = {};
  returnTemp.value = '';
  supplyTemp.value = '';
  pressure.value = '';
  current.value = '';
  refrigerantAdded.value = false;
  notes.value = '';
  errors.value = {};
  failure.value = '';
  idempotencyKey = crypto.randomUUID();
  opened.value = snapshot();
});
const checklist = computed(() => serviceItems(type.value));
// Items of a smaller service carry over when a larger one is chosen; extra ones are dropped.
watch(type, () => {
  items.value = Object.fromEntries(
    Object.entries(items.value).filter(([item]) => checklist.value.includes(item as never)),
  );
  errors.value = {};
});
const parsed = (value: string) => parseNumber(value);
const input = computed<ServiceInput>(() => ({
  serviceType: type.value,
  items: Object.fromEntries(
    checklist.value.map((item) => [item, items.value[item]]).filter(([, v]) => v),
  ),
  returnTemp: parsed(returnTemp.value) ?? null,
  supplyTemp: parsed(supplyTemp.value) ?? null,
  pressurePsi: parsed(pressure.value) ?? null,
  currentAmp: parsed(current.value) ?? null,
  refrigerantAdded: refrigerantAdded.value,
  notes: notes.value,
}));
const drop = computed(() =>
  input.value.returnTemp !== null && input.value.supplyTemp !== null
    ? input.value.returnTemp - input.value.supplyTemp
    : null,
);
const reasons = computed(() => (props.unit ? previewReasons(props.unit, input.value) : []));
const range = computed(() => (props.unit ? pressureRangeFor(props.unit.refrigerant) : undefined));
// A service that is not due yet can still be recorded (a complaint, a leak), but needs a reason.
const early = computed(() =>
  props.unit ? earlyService(props.unit, type.value, props.today) : null,
);
const earlyText = computed(() => {
  const entry = early.value;
  if (!entry) return '';
  const warning = fill(messages.value.earlyWarning, {
    service: messages.value[serviceKeys[entry.type]],
    date: formatDay(entry.dueOn),
    days: daysBetween(props.today, entry.dueOn),
  });
  return entry.lastDoneAt
    ? warning +
        ' ' +
        fill(messages.value.earlyLastDone, {
          date: formatDay(hotelToday(new Date(entry.lastDoneAt))),
        })
    : warning;
});
function markAllOk() {
  items.value = Object.fromEntries(checklist.value.map((item) => [item, 'ok']));
  if (errors.value.items) errors.value = { ...errors.value, items: undefined };
}
async function submit() {
  if (saving.value || !props.unit) return;
  errors.value = validateService(input.value, props.unit, !!early.value);
  const numbers: [string, ServiceField][] = [
    [returnTemp.value, 'temperatures'],
    [supplyTemp.value, 'temperatures'],
    [pressure.value, 'pressurePsi'],
    [current.value, 'currentAmp'],
  ];
  for (const [text, field] of numbers)
    if (parsed(text) === undefined) errors.value[field] = 'invalidNumber';
  const invalid = (Object.keys(errors.value) as ServiceField[]).find((key) => errors.value[key]);
  if (invalid) {
    document.getElementById('ac-service-' + invalid)?.focus();
    return;
  }
  saving.value = true;
  failure.value = '';
  try {
    await props.record(input.value, idempotencyKey);
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    saving.value = false;
  }
}
const fieldError = (field: ServiceField) => {
  const key = errors.value[field];
  if (!key) return '';
  return field === 'items' ? messages.value.itemsRequired : messages.value[key];
};
const optionalHint = (required: boolean) => (required ? '' : messages.value.optional);
</script>
<template>
  <ModuleDialog
    v-model="open"
    fullscreen
    :title="messages.serviceTitle"
    :subtitle="unit ? unit.code + ' · ' + unit.location : ''"
    :busy="saving"
    :dirty="dirty"
    :width="dialogWidth.xl"
  >
    <v-form
      id="ac-service-form"
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
      <v-alert
        v-if="early"
        type="info"
        variant="tonal"
        density="compact"
        class="mb-4"
        >{{ earlyText }} {{ messages.earlyHint }}</v-alert
      >
      <span
        id="ac-service-type-label"
        class="field-label ac-first-label"
        >{{ messages.serviceType }}</span
      ><v-btn-toggle
        v-model="type"
        mandatory
        variant="outlined"
        color="primary"
        density="comfortable"
        class="choice-group ac-service-types"
        role="radiogroup"
        aria-labelledby="ac-service-type-label"
        :disabled="saving"
        ><v-btn
          v-for="option in serviceTypes"
          :key="option"
          :value="option"
          role="radio"
          :aria-checked="type === option"
          >{{ messages[serviceKeys[option]] }}</v-btn
        ></v-btn-toggle
      >

      <div class="ac-checklist-heading">
        <span
          id="ac-service-items"
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
        class="ac-hint"
        :class="{ 'ac-error-text': errors.items }"
        :role="errors.items ? 'alert' : undefined"
      >
        {{ errors.items ? messages.itemsRequired : messages.checklistHint }}
      </p>
      <ul class="ac-items">
        <li
          v-for="item in checklist"
          :key="item"
          :class="{ 'ac-item--issue': items[item] === 'issue' }"
        >
          <span :id="'ac-item-' + item">{{ messages[itemKeys[item]] }}</span>
          <v-btn-toggle
            v-model="items[item]"
            variant="outlined"
            density="comfortable"
            class="choice-group"
            :color="items[item] === 'issue' ? 'error' : 'primary'"
            :aria-labelledby="'ac-item-' + item"
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

      <span class="field-label">{{ messages.readings }}</span>
      <div class="ac-form-row">
        <div>
          <label
            for="ac-service-temperatures"
            class="ac-interval-label"
            >{{ messages.returnTemp }}</label
          ><v-text-field
            id="ac-service-temperatures"
            v-model="returnTemp"
            :disabled="saving"
            inputmode="decimal"
            maxlength="5"
            :hint="optionalHint(needsTemperatures(type))"
            persistent-hint
            :error-messages="fieldError('temperatures')"
          />
        </div>
        <div>
          <label
            for="ac-service-supply"
            class="ac-interval-label"
            >{{ messages.supplyTemp }}</label
          ><v-text-field
            id="ac-service-supply"
            v-model="supplyTemp"
            :disabled="saving"
            inputmode="decimal"
            maxlength="5"
            :hint="
              drop === null
                ? optionalHint(needsTemperatures(type))
                : fill(messages.temperatureDrop, { value: formatNumber(drop) })
            "
            persistent-hint
          />
        </div>
      </div>
      <div class="ac-form-row">
        <div>
          <label
            for="ac-service-pressurePsi"
            class="ac-interval-label"
            >{{ messages.pressurePsi }}</label
          ><v-text-field
            id="ac-service-pressurePsi"
            v-model="pressure"
            :disabled="saving"
            inputmode="numeric"
            maxlength="3"
            :hint="
              unit && range
                ? fill(messages.pressureHint, {
                    gas: messages[refrigerantKeys[unit.refrigerant]],
                    min: range[0],
                    max: range[1],
                  })
                : optionalHint(needsPressureAndCurrent(type))
            "
            persistent-hint
            :error-messages="fieldError('pressurePsi')"
          />
        </div>
        <div>
          <label
            for="ac-service-currentAmp"
            class="ac-interval-label"
            >{{ messages.currentAmp }}</label
          ><v-text-field
            id="ac-service-currentAmp"
            v-model="current"
            :disabled="saving"
            inputmode="decimal"
            maxlength="5"
            :hint="
              unit?.ratedCurrent
                ? fill(messages.currentHint, { value: formatNumber(unit.ratedCurrent) })
                : optionalHint(needsPressureAndCurrent(type))
            "
            persistent-hint
            :error-messages="fieldError('currentAmp')"
          />
        </div>
      </div>
      <v-checkbox
        v-model="refrigerantAdded"
        :label="messages.refrigerantAdded"
        :disabled="saving"
        hide-details
        class="ac-checkbox"
      />

      <v-alert
        v-if="reasons.length"
        type="warning"
        variant="tonal"
        density="compact"
        class="ac-attention"
      >
        {{ messages.willNeedAttention }}
        <ul>
          <li
            v-for="reason in reasons"
            :key="reason"
          >
            {{ messages[reasonKeys[reason]] }}
          </li>
        </ul>
      </v-alert>
      <label
        for="ac-service-notes"
        class="field-label"
        >{{ messages.notes }}</label
      ><v-textarea
        id="ac-service-notes"
        v-model="notes"
        :disabled="saving"
        rows="2"
        auto-grow
        maxlength="1000"
        :hint="reasons.length ? messages.notesHint : early ? messages.earlyHint : messages.optional"
        persistent-hint
        :error-messages="fieldError('notes')"
      />
    </v-form>
    <template #actions="{ close }">
      <v-btn
        variant="text"
        :disabled="saving"
        @click="close"
        >{{ messages.cancel }}</v-btn
      ><v-btn
        color="primary"
        type="submit"
        form="ac-service-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ messages.recordService }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
