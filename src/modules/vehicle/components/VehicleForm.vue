<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import { useVehicleMessages, errorMessage } from '../composables/useVehicleMessages';
import type { Vehicle, VehicleInput } from '../types';
import { normalizePlate, validateVehicle } from '../validation';
import type { ValidationError, VehicleField } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  vehicle: Vehicle | null;
  departments: { id: string; name: string }[];
  save: (input: VehicleInput) => Promise<void>;
}>();
const messages = useVehicleMessages();
const draft = ref<VehicleInput>({ name: '', plateNumber: '', departmentId: '' });
const errors = ref<Partial<Record<VehicleField, ValidationError>>>({});
const saving = ref(false);
const failure = ref('');
const initial = ref('');
const dirty = computed(() => JSON.stringify(draft.value) !== initial.value);
watch(open, (value) => {
  if (!value) return;
  draft.value = props.vehicle
    ? {
        name: props.vehicle.name,
        plateNumber: props.vehicle.plateNumber,
        departmentId: props.vehicle.departmentId,
      }
    : { name: '', plateNumber: '', departmentId: props.departments[0]?.id ?? '' };
  initial.value = JSON.stringify(draft.value);
  errors.value = {};
  failure.value = '';
});
async function submit() {
  if (saving.value) return;
  errors.value = validateVehicle(draft.value);
  const invalid = Object.keys(errors.value)[0];
  if (invalid) {
    document.getElementById('vehicle-' + invalid)?.focus();
    return;
  }
  saving.value = true;
  failure.value = '';
  try {
    await props.save({ ...draft.value, plateNumber: normalizePlate(draft.value.plateNumber) });
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    saving.value = false;
  }
}
const fieldError = (field: VehicleField) =>
  errors.value[field] ? messages.value[errors.value[field]!] : '';
</script>
<template>
  <ModuleDialog
    v-model="open"
    :title="vehicle ? messages.edit : messages.add"
    :busy="saving"
    :dirty="dirty"
  >
    <v-form
      id="vehicle-form"
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
        for="vehicle-name"
        class="field-label vehicle-first-label"
        >{{ messages.name }}</label
      ><v-text-field
        id="vehicle-name"
        v-model="draft.name"
        :disabled="saving"
        :placeholder="messages.namePlaceholder"
        maxlength="100"
        autofocus
        :error-messages="fieldError('name')"
      /><label
        for="vehicle-plateNumber"
        class="field-label"
        >{{ messages.plateNumber }}</label
      ><v-text-field
        id="vehicle-plateNumber"
        v-model="draft.plateNumber"
        :disabled="saving"
        :placeholder="messages.platePlaceholder"
        maxlength="20"
        autocomplete="off"
        :error-messages="fieldError('plateNumber')"
      /><label
        for="vehicle-departmentId"
        class="field-label"
        >{{ messages.department }}</label
      ><v-select
        id="vehicle-departmentId"
        v-model="draft.departmentId"
        :disabled="saving"
        :items="departments"
        item-title="name"
        item-value="id"
        :error-messages="fieldError('departmentId')"
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
        form="vehicle-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ messages.save }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
<style scoped>
.vehicle-first-label {
  margin-top: 0;
}
</style>
