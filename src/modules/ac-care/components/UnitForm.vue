<script setup lang="ts">
import { dialogWidth } from '../../../shared/dialog-widths';
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import OptionalFields from '../../../shared/optional-fields.vue';
import {
  errorMessage,
  refrigerantKeys,
  serviceKeys,
  unitTypeKeys,
  useAcCareMessages,
} from '../composables/useAcCareMessages';
import { refrigerants, serviceTypes, unitTypes } from '../types';
import type { AcUnit, ServiceType, UnitInput } from '../types';
import { defaultIntervals, normalizeCode, parseNumber, validateUnit } from '../validation';
import type { UnitField, ValidationError } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  unit: AcUnit | null;
  areas: string[];
  save: (input: UnitInput) => Promise<void>;
}>();
const messages = useAcCareMessages();
const blank = (): UnitInput => ({
  code: '',
  location: '',
  area: '',
  unitType: 'split',
  brand: '',
  capacity: '',
  refrigerant: 'r32',
  ratedCurrent: null,
  installedOn: '',
  warrantyUntil: '',
  intervals: { ...defaultIntervals },
});
const draft = ref<UnitInput>(blank());
// Number fields are edited as text so a half-typed value is not lost.
const rated = ref('');
const intervals = ref<Record<ServiceType, string>>({
  filter: '',
  routine: '',
  major: '',
  annual: '',
});
const errors = ref<Partial<Record<UnitField, ValidationError>>>({});
const saving = ref(false);
const failure = ref('');
const snapshot = () => JSON.stringify([draft.value, rated.value, intervals.value]);
const initial = ref('');
const dirty = computed(() => snapshot() !== initial.value);
watch(open, (value) => {
  if (!value) return;
  const unit = props.unit;
  draft.value = unit
    ? {
        code: unit.code,
        location: unit.location,
        area: unit.area,
        unitType: unit.unitType,
        brand: unit.brand,
        capacity: unit.capacity,
        refrigerant: unit.refrigerant,
        ratedCurrent: unit.ratedCurrent,
        installedOn: unit.installedOn ?? '',
        warrantyUntil: unit.warrantyUntil ?? '',
        intervals: { ...unit.intervals },
      }
    : blank();
  rated.value = draft.value.ratedCurrent === null ? '' : String(draft.value.ratedCurrent);
  intervals.value = Object.fromEntries(
    serviceTypes.map((type) => [type, String(draft.value.intervals[type])]),
  ) as Record<ServiceType, string>;
  errors.value = {};
  failure.value = '';
  initial.value = snapshot();
});
const detailsFilled = computed(
  () =>
    !!draft.value.brand ||
    !!draft.value.capacity ||
    !!rated.value ||
    !!draft.value.installedOn ||
    !!draft.value.warrantyUntil ||
    serviceTypes.some((type) => intervals.value[type] !== String(defaultIntervals[type])) ||
    ['brand', 'capacity', 'ratedCurrent', ...serviceTypes].some(
      (field) => errors.value[field as UnitField],
    ),
);
async function submit() {
  if (saving.value) return;
  const ratedCurrent = parseNumber(rated.value);
  const input: UnitInput = {
    ...draft.value,
    ratedCurrent: ratedCurrent ?? null,
    intervals: Object.fromEntries(
      serviceTypes.map((type) => [
        type,
        /^\d{1,3}$/.test(intervals.value[type].trim()) ? Number(intervals.value[type]) : -1,
      ]),
    ) as Record<ServiceType, number>,
  };
  errors.value = validateUnit(input);
  if (ratedCurrent === undefined) errors.value.ratedCurrent = 'invalidNumber';
  const invalid = Object.keys(errors.value)[0];
  if (invalid) {
    document.getElementById('ac-unit-' + invalid)?.focus();
    return;
  }
  saving.value = true;
  failure.value = '';
  try {
    await props.save({ ...input, code: normalizeCode(input.code) });
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    saving.value = false;
  }
}
const fieldError = (field: UnitField) =>
  errors.value[field] ? messages.value[errors.value[field]!] : '';
const typeItems = computed(() =>
  unitTypes.map((value) => ({ value, title: messages.value[unitTypeKeys[value]] })),
);
const refrigerantItems = computed(() =>
  refrigerants.map((value) => ({ value, title: messages.value[refrigerantKeys[value]] })),
);
</script>
<template>
  <ModuleDialog
    v-model="open"
    fullscreen
    :title="unit ? messages.editUnit : messages.addUnit"
    :busy="saving"
    :dirty="dirty"
    :width="dialogWidth.xl"
  >
    <v-form
      id="ac-unit-form"
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
      <div class="ac-form-row">
        <div>
          <label
            for="ac-unit-code"
            class="field-label ac-first-label"
            >{{ messages.code }}</label
          ><v-text-field
            id="ac-unit-code"
            v-model="draft.code"
            :disabled="saving"
            maxlength="20"
            autocomplete="off"
            autofocus
            :hint="messages.codeHint"
            :error-messages="fieldError('code')"
          />
        </div>
        <div>
          <label
            for="ac-unit-area"
            class="field-label ac-first-label"
            >{{ messages.area }}</label
          ><v-combobox
            id="ac-unit-area"
            v-model="draft.area"
            :items="areas"
            :disabled="saving"
            maxlength="40"
            :hint="messages.areaHint"
            :error-messages="fieldError('area')"
            @update:model-value="draft.area = $event ?? ''"
          />
        </div>
      </div>
      <label
        for="ac-unit-location"
        class="field-label"
        >{{ messages.location }}</label
      ><v-text-field
        id="ac-unit-location"
        v-model="draft.location"
        :disabled="saving"
        maxlength="80"
        :placeholder="messages.locationPlaceholder"
        :error-messages="fieldError('location')"
      />
      <div class="ac-form-row">
        <div>
          <label
            for="ac-unit-type"
            class="field-label"
            >{{ messages.unitType }}</label
          ><v-select
            id="ac-unit-type"
            v-model="draft.unitType"
            :items="typeItems"
            :disabled="saving"
          />
        </div>
        <div>
          <label
            for="ac-unit-refrigerant"
            class="field-label"
            >{{ messages.refrigerant }}</label
          ><v-select
            id="ac-unit-refrigerant"
            v-model="draft.refrigerant"
            :items="refrigerantItems"
            :disabled="saving"
          />
        </div>
      </div>
      <OptionalFields
        :label="messages.moreDetails"
        :filled="detailsFilled"
        :reset-key="open"
      >
        <div class="ac-form-row">
          <div>
            <label
              for="ac-unit-brand"
              class="field-label"
              >{{ messages.brand }}</label
            ><v-text-field
              id="ac-unit-brand"
              v-model="draft.brand"
              :disabled="saving"
              maxlength="40"
              :error-messages="fieldError('brand')"
            />
          </div>
          <div>
            <label
              for="ac-unit-capacity"
              class="field-label"
              >{{ messages.capacity }}</label
            ><v-text-field
              id="ac-unit-capacity"
              v-model="draft.capacity"
              :disabled="saving"
              maxlength="20"
              :placeholder="messages.capacityPlaceholder"
              :error-messages="fieldError('capacity')"
            />
          </div>
        </div>
        <label
          for="ac-unit-ratedCurrent"
          class="field-label"
          >{{ messages.ratedCurrent }}</label
        ><v-text-field
          id="ac-unit-ratedCurrent"
          v-model="rated"
          :disabled="saving"
          inputmode="decimal"
          maxlength="6"
          :hint="messages.ratedCurrentHint"
          :error-messages="fieldError('ratedCurrent')"
        />
        <div class="ac-form-row">
          <div>
            <label
              for="ac-unit-installedOn"
              class="field-label"
              >{{ messages.installedOn }}</label
            ><v-text-field
              id="ac-unit-installedOn"
              v-model="draft.installedOn"
              type="date"
              min="1980-01-01"
              :disabled="saving"
            />
          </div>
          <div>
            <label
              for="ac-unit-warrantyUntil"
              class="field-label"
              >{{ messages.warrantyUntil }}</label
            ><v-text-field
              id="ac-unit-warrantyUntil"
              v-model="draft.warrantyUntil"
              type="date"
              min="1980-01-01"
              :disabled="saving"
            />
          </div>
        </div>
        <span class="field-label">{{ messages.intervals }}</span>
        <p class="ac-hint">{{ messages.intervalsHint }}</p>
        <div class="ac-interval-grid">
          <div
            v-for="type in serviceTypes"
            :key="type"
          >
            <label
              :for="'ac-unit-' + type"
              class="ac-interval-label"
              >{{ messages[serviceKeys[type]] }}</label
            ><v-text-field
              :id="'ac-unit-' + type"
              v-model="intervals[type]"
              :disabled="saving"
              inputmode="numeric"
              maxlength="3"
              :error-messages="fieldError(type)"
            />
          </div>
        </div>
      </OptionalFields>
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
        form="ac-unit-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ messages.save }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
