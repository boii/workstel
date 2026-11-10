<script setup lang="ts">
import { ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import {
  errorMessage,
  formatDate,
  useCasualAttendanceMessages,
} from '../composables/useCasualAttendanceMessages';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  name: string;
  day: string;
  save: (kind: 'leave' | 'sick', note: string) => Promise<void>;
}>();
const messages = useCasualAttendanceMessages();
const kind = ref<'leave' | 'sick'>('leave');
const note = ref('');
const saving = ref(false);
const failure = ref('');
watch(open, (value) => {
  if (!value) return;
  kind.value = 'leave';
  note.value = '';
  failure.value = '';
});
async function submit() {
  if (saving.value) return;
  saving.value = true;
  failure.value = '';
  try {
    await props.save(kind.value, note.value.trim());
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
    :title="messages.leaveTitle"
    :subtitle="name + ' · ' + (day ? formatDate(day) : '')"
    :busy="saving"
    :dirty="!!note.trim()"
  >
    <v-form
      id="ca-leave-form"
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
      <span
        id="ca-leave-kind-label"
        class="field-label ca-first-label"
        >{{ messages.leaveKind }}</span
      >
      <v-btn-toggle
        v-model="kind"
        variant="outlined"
        density="comfortable"
        class="choice-group"
        color="primary"
        mandatory
        :disabled="saving"
        aria-labelledby="ca-leave-kind-label"
      >
        <v-btn value="leave">{{ messages.stateLeave }}</v-btn>
        <v-btn value="sick">{{ messages.stateSick }}</v-btn>
      </v-btn-toggle>
      <label
        for="ca-leave-note"
        class="field-label"
        >{{ messages.note }}</label
      ><v-text-field
        id="ca-leave-note"
        v-model="note"
        :disabled="saving"
        :placeholder="messages.notePlaceholder"
        maxlength="200"
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
        form="ca-leave-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ messages.saveMark }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
