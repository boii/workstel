<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import type { CasualAttendanceApi } from '../api';
import {
  confirmationHintKeys,
  confirmationKeys,
  errorMessage,
  isConflict,
  useCasualAttendanceMessages,
} from '../composables/useCasualAttendanceMessages';
import { confirmationModes } from '../types';
import type { ConfirmationMode, DepartmentSettings } from '../types';

/** Self check-in settings for one department at a time; managers only. */
const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  api: CasualAttendanceApi;
  hotelId: string;
  departments: { id: string; name: string }[];
}>();
const emit = defineEmits<{ saved: [] }>();
const messages = useCasualAttendanceMessages();

const rows = ref<DepartmentSettings[]>([]);
const departmentId = ref('');
const selfEnabled = ref(false);
const confirmation = ref<ConfirmationMode>('on_fail');
const loading = ref(false);
const saving = ref(false);
const failure = ref('');

const current = computed(() => rows.value.find((row) => row.departmentId === departmentId.value));
const dirty = computed(
  () =>
    !!current.value &&
    (current.value.selfEnabled !== selfEnabled.value ||
      current.value.confirmation !== confirmation.value),
);
function fill() {
  selfEnabled.value = current.value?.selfEnabled ?? false;
  confirmation.value = current.value?.confirmation ?? 'on_fail';
}
async function load() {
  loading.value = true;
  failure.value = '';
  try {
    const managed = new Set(props.departments.map((d) => d.id));
    rows.value = (await props.api.listSettings(props.hotelId, null)).filter((row) =>
      managed.has(row.departmentId),
    );
    if (!rows.value.some((row) => row.departmentId === departmentId.value))
      departmentId.value = rows.value[0]?.departmentId ?? '';
    fill();
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    loading.value = false;
  }
}
watch(open, (value) => {
  if (value) void load();
});
watch(departmentId, fill);

async function submit() {
  const row = current.value;
  if (saving.value || !row) return;
  saving.value = true;
  failure.value = '';
  try {
    await props.api.saveSettings(
      props.hotelId,
      row.departmentId,
      { selfEnabled: selfEnabled.value, confirmation: confirmation.value },
      row.version,
    );
    open.value = false;
    emit('saved');
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
    if (isConflict(error)) await load();
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <ModuleDialog
    v-model="open"
    :title="messages.settingsTitle"
    :busy="saving"
    :dirty="dirty"
  >
    <v-form
      id="ca-settings-form"
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
      <p class="ca-subtitle">{{ messages.settingsDescription }}</p>
      <v-skeleton-loader
        v-if="loading && !rows.length"
        type="list-item-two-line"
        :aria-label="messages.settingsTitle"
      />
      <template v-else-if="rows.length">
        <template v-if="rows.length > 1">
          <label
            for="ca-settings-department"
            class="field-label"
            >{{ messages.department }}</label
          ><v-select
            id="ca-settings-department"
            v-model="departmentId"
            :items="rows"
            item-title="departmentName"
            item-value="departmentId"
            :disabled="saving || dirty"
          />
        </template>
        <v-switch
          v-model="selfEnabled"
          color="primary"
          inset
          hide-details
          :disabled="saving"
          :label="messages.selfEnabled"
        />
        <span
          id="ca-settings-confirmation-label"
          class="field-label"
          >{{ messages.confirmation }}</span
        >
        <v-btn-toggle
          v-model="confirmation"
          variant="outlined"
          density="comfortable"
          class="choice-group"
          color="primary"
          mandatory
          :disabled="saving || !selfEnabled"
          aria-labelledby="ca-settings-confirmation-label"
        >
          <v-btn
            v-for="mode in confirmationModes"
            :key="mode"
            :value="mode"
            >{{ messages[confirmationKeys[mode]] }}</v-btn
          >
        </v-btn-toggle>
        <p class="ca-hint">{{ messages[confirmationHintKeys[confirmation]] }}</p>
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
        form="ca-settings-form"
        :loading="saving"
        :disabled="!current"
        @click.prevent="submit"
        >{{ messages.save }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
