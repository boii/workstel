<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import OptionalFields from '../../../shared/optional-fields.vue';
import {
  errorMessage,
  shiftKeys,
  typeKeys,
  useCasualAttendanceMessages,
} from '../composables/useCasualAttendanceMessages';
import { personTypes, shifts } from '../types';
import type { Person, PersonInput } from '../types';
import { hotelToday, validatePerson } from '../validation';
import type { PersonField, ValidationError } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  person: Person | null;
  departments: { id: string; name: string }[];
  save: (input: PersonInput) => Promise<void>;
}>();
const messages = useCasualAttendanceMessages();
const empty = (): PersonInput => ({
  name: '',
  type: 'casual',
  origin: '',
  departmentId: props.departments[0]?.id ?? '',
  startDate: hotelToday(),
  endDate: null,
  shift: 'morning',
  notes: '',
});
const draft = ref<PersonInput>(empty());
const errors = ref<Partial<Record<PersonField, ValidationError>>>({});
const saving = ref(false);
const failure = ref('');
const initial = ref('');
const opened = ref(0);
const dirty = computed(() => JSON.stringify(draft.value) !== initial.value);
watch(open, (value) => {
  if (!value) return;
  const person = props.person;
  draft.value = person
    ? {
        name: person.name,
        type: person.type,
        origin: person.origin,
        departmentId: person.departmentId,
        startDate: person.startDate,
        endDate: person.endDate,
        shift: person.shift,
        notes: person.notes,
      }
    : empty();
  initial.value = JSON.stringify(draft.value);
  errors.value = {};
  failure.value = '';
  opened.value++;
});
const shiftItems = computed(() =>
  shifts.map((shift) => ({ value: shift, title: messages.value[shiftKeys[shift]] })),
);
async function submit() {
  if (saving.value) return;
  errors.value = validatePerson(draft.value);
  const invalid = Object.keys(errors.value)[0];
  if (invalid) {
    document.getElementById('ca-person-' + invalid)?.focus();
    return;
  }
  saving.value = true;
  failure.value = '';
  try {
    await props.save({ ...draft.value, endDate: draft.value.endDate || null });
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    saving.value = false;
  }
}
const fieldError = (field: PersonField) =>
  errors.value[field] ? messages.value[errors.value[field]!] : '';
</script>
<template>
  <ModuleDialog
    v-model="open"
    :title="person ? messages.editPerson : messages.add"
    :subtitle="person ? '' : messages.addHint"
    :busy="saving"
    :dirty="dirty"
  >
    <v-form
      id="ca-person-form"
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
      <label
        for="ca-person-name"
        class="field-label ca-first-label"
        >{{ messages.name }}</label
      ><v-text-field
        id="ca-person-name"
        v-model="draft.name"
        :disabled="saving"
        :placeholder="messages.namePlaceholder"
        maxlength="80"
        autocomplete="off"
        autofocus
        :error-messages="fieldError('name')"
      />
      <span
        id="ca-person-type-label"
        class="field-label"
        >{{ messages.type }}</span
      >
      <v-btn-toggle
        v-model="draft.type"
        variant="outlined"
        density="comfortable"
        class="choice-group"
        color="primary"
        mandatory
        :disabled="saving"
        aria-labelledby="ca-person-type-label"
      >
        <v-btn
          v-for="type in personTypes"
          :key="type"
          :value="type"
          >{{ messages[typeKeys[type]] }}</v-btn
        >
      </v-btn-toggle>
      <div class="ca-form-grid">
        <div>
          <label
            for="ca-person-origin"
            class="field-label"
            >{{ messages.origin }}</label
          ><v-text-field
            id="ca-person-origin"
            v-model="draft.origin"
            :disabled="saving"
            :placeholder="messages.originPlaceholder"
            maxlength="100"
            :error-messages="fieldError('origin')"
          />
        </div>
        <div>
          <label
            for="ca-person-departmentId"
            class="field-label"
            >{{ messages.department }}</label
          ><v-select
            id="ca-person-departmentId"
            v-model="draft.departmentId"
            :disabled="saving"
            :items="departments"
            item-title="name"
            item-value="id"
            :error-messages="fieldError('departmentId')"
          />
        </div>
      </div>
      <div class="ca-form-grid">
        <div>
          <label
            for="ca-person-startDate"
            class="field-label"
            >{{ messages.startDate }}</label
          ><v-text-field
            id="ca-person-startDate"
            v-model="draft.startDate"
            type="date"
            :disabled="saving"
            min="2000-01-01"
            :error-messages="fieldError('startDate')"
          />
        </div>
        <div>
          <label
            for="ca-person-endDate"
            class="field-label"
            >{{ messages.endDate }}</label
          ><v-text-field
            id="ca-person-endDate"
            :model-value="draft.endDate ?? ''"
            type="date"
            :disabled="saving"
            :min="draft.startDate || '2000-01-01'"
            :hint="messages.endDateHint"
            persistent-hint
            :error-messages="fieldError('endDate')"
            @update:model-value="draft.endDate = $event || null"
          />
        </div>
      </div>
      <label
        for="ca-person-shift"
        class="field-label"
        >{{ messages.shift }}</label
      ><v-select
        id="ca-person-shift"
        v-model="draft.shift"
        :disabled="saving"
        :items="shiftItems"
      />
      <OptionalFields
        :label="messages.addNotes"
        :filled="!!draft.notes.trim()"
        :reset-key="opened"
      >
        <label
          for="ca-person-notes"
          class="field-label"
          >{{ messages.notes }}</label
        ><v-textarea
          id="ca-person-notes"
          v-model="draft.notes"
          :disabled="saving"
          rows="2"
          auto-grow
          maxlength="500"
          :error-messages="fieldError('notes')"
        />
      </OptionalFields>
      <p
        v-if="person"
        class="ca-hint"
      >
        {{ messages.departmentLockedHint }}
      </p>
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
        form="ca-person-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ messages.save }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
