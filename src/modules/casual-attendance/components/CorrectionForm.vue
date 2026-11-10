<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import {
  errorMessage,
  formatClock,
  formatDate,
  useCasualAttendanceMessages,
} from '../composables/useCasualAttendanceMessages';
import type { AttendanceRecord, CorrectionInput } from '../types';
import { hotelClock, validateCorrection } from '../validation';
import type { CorrectionField, ValidationError } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  name: string;
  day: string;
  record: AttendanceRecord | null;
  save: (input: CorrectionInput) => Promise<void>;
}>();
const messages = useCasualAttendanceMessages();
const draft = ref<CorrectionInput>({ checkIn: '', checkOut: '', reason: '' });
const errors = ref<Partial<Record<CorrectionField, ValidationError>>>({});
const saving = ref(false);
const failure = ref('');
const initial = ref('');
const dirty = computed(() => JSON.stringify(draft.value) !== initial.value);
watch(open, (value) => {
  if (!value) return;
  const record = props.record;
  draft.value = {
    checkIn: record?.checkIn ? hotelClock(record.checkIn) : '',
    checkOut: record?.checkOut ? hotelClock(record.checkOut) : '',
    reason: '',
  };
  initial.value = JSON.stringify(draft.value);
  errors.value = {};
  failure.value = '';
});
const recorded = computed(() => {
  const record = props.record;
  if (!record?.checkIn) return '';
  return (
    messages.value.recordedAt +
    ' ' +
    formatClock(record.checkIn) +
    (record.checkOut ? '–' + formatClock(record.checkOut) : '')
  );
});
async function submit() {
  if (saving.value) return;
  errors.value = validateCorrection(draft.value);
  const invalid = Object.keys(errors.value)[0];
  if (invalid) {
    document.getElementById('ca-correct-' + invalid)?.focus();
    return;
  }
  saving.value = true;
  failure.value = '';
  try {
    await props.save({ ...draft.value, reason: draft.value.reason.trim() });
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    saving.value = false;
  }
}
const fieldError = (field: CorrectionField) =>
  errors.value[field] ? messages.value[errors.value[field]!] : '';
</script>
<template>
  <ModuleDialog
    v-model="open"
    :title="messages.correctTitle"
    :subtitle="name + ' · ' + (day ? formatDate(day) : '')"
    :busy="saving"
    :dirty="dirty"
  >
    <v-form
      id="ca-correct-form"
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
      <div class="ca-form-grid">
        <div>
          <label
            for="ca-correct-checkIn"
            class="field-label ca-first-label"
            >{{ messages.checkIn }}</label
          ><v-text-field
            id="ca-correct-checkIn"
            v-model="draft.checkIn"
            type="time"
            :disabled="saving"
            :hint="recorded"
            persistent-hint
            :error-messages="fieldError('checkIn')"
          />
        </div>
        <div>
          <label
            for="ca-correct-checkOut"
            class="field-label ca-first-label"
            >{{ messages.checkOut }}</label
          ><v-text-field
            id="ca-correct-checkOut"
            v-model="draft.checkOut"
            type="time"
            :disabled="saving"
            :error-messages="fieldError('checkOut')"
          />
        </div>
      </div>
      <p class="ca-hint">{{ messages.nextDayHint }}</p>
      <label
        for="ca-correct-reason"
        class="field-label"
        >{{ messages.correctionReason }}</label
      ><v-text-field
        id="ca-correct-reason"
        v-model="draft.reason"
        :disabled="saving"
        :placeholder="messages.reasonPlaceholder"
        maxlength="200"
        :error-messages="fieldError('reason')"
      />
      <p class="ca-hint">{{ messages.correctionHint }}</p>
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
        form="ca-correct-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ messages.saveCorrection }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
