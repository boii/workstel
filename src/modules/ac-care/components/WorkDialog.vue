<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import { errorMessage, serviceKeys, useAcCareMessages } from '../composables/useAcCareMessages';
import type { AcUnit, ServiceType, Technician } from '../types';

/** Postpone a task with a reason, or (supervisors) assign it to a technician. */
const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  mode: 'postpone' | 'assign';
  unit: AcUnit | null;
  type: ServiceType;
  technicians: Technician[];
  submit: (value: string) => Promise<void>;
}>();
const messages = useAcCareMessages();
const value = ref('');
const fieldError = ref('');
const saving = ref(false);
const failure = ref('');
watch(open, (isOpen) => {
  if (!isOpen) return;
  value.value = '';
  fieldError.value = '';
  failure.value = '';
});
const technicianItems = computed(() =>
  props.technicians.map((person) => ({ value: person.userId, title: person.email })),
);
async function save() {
  if (saving.value) return;
  fieldError.value = !value.value.trim()
    ? messages.value.required
    : value.value.length > 200
      ? messages.value.tooLong
      : '';
  if (fieldError.value) {
    document.getElementById('ac-work-value')?.focus();
    return;
  }
  saving.value = true;
  failure.value = '';
  try {
    await props.submit(value.value);
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    saving.value = false;
  }
}
</script>
<template>
  <ModuleDialog
    v-model="open"
    :title="mode === 'postpone' ? messages.postponeTitle : messages.assignTitle"
    :subtitle="unit ? unit.code + ' · ' + messages[serviceKeys[type]] : ''"
    :busy="saving"
    :dirty="mode === 'postpone' && !!value.trim()"
  >
    <v-form
      id="ac-work-form"
      @submit.prevent="save"
    >
      <v-alert
        v-if="failure"
        type="error"
        variant="tonal"
        role="alert"
        class="mb-4"
        >{{ failure }}</v-alert
      >
      <template v-if="mode === 'postpone'">
        <label
          for="ac-work-value"
          class="field-label ac-first-label"
          >{{ messages.postponeReason }}</label
        ><v-text-field
          id="ac-work-value"
          v-model="value"
          :disabled="saving"
          maxlength="200"
          autofocus
          :placeholder="messages.postponePlaceholder"
          :error-messages="fieldError"
        />
      </template>
      <template v-else>
        <label
          for="ac-work-value"
          class="field-label ac-first-label"
          >{{ messages.technician }}</label
        ><v-select
          id="ac-work-value"
          v-model="value"
          :items="technicianItems"
          :disabled="saving"
          :no-data-text="messages.noTechnicianGrants"
          :error-messages="fieldError"
        />
      </template>
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
        form="ac-work-form"
        :loading="saving"
        @click.prevent="save"
        >{{ mode === 'postpone' ? messages.postpone : messages.assign }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
