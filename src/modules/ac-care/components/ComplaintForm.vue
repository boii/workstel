<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import { complaintKeys, errorMessage, useAcCareMessages } from '../composables/useAcCareMessages';
import { complaintKinds } from '../types';
import type { AcUnit, ComplaintKind } from '../types';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  unit: AcUnit | null;
  record: (kind: ComplaintKind, note: string, idempotencyKey: string) => Promise<void>;
}>();
const messages = useAcCareMessages();
const kind = ref<ComplaintKind>('not-cold');
const note = ref('');
const noteError = ref('');
const saving = ref(false);
const failure = ref('');
const dirty = computed(() => kind.value !== 'not-cold' || !!note.value.trim());
let idempotencyKey = '';
watch(open, (value) => {
  if (!value) return;
  kind.value = 'not-cold';
  note.value = '';
  noteError.value = '';
  failure.value = '';
  idempotencyKey = crypto.randomUUID();
});
async function submit() {
  if (saving.value || !props.unit) return;
  noteError.value =
    kind.value === 'other' && !note.value.trim()
      ? messages.value.required
      : note.value.length > 500
        ? messages.value.tooLong
        : '';
  if (noteError.value) {
    document.getElementById('ac-complaint-note')?.focus();
    return;
  }
  saving.value = true;
  failure.value = '';
  try {
    await props.record(kind.value, note.value, idempotencyKey);
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    saving.value = false;
  }
}
const kindItems = computed(() =>
  complaintKinds.map((value) => ({ value, title: messages.value[complaintKeys[value]] })),
);
</script>
<template>
  <ModuleDialog
    v-model="open"
    :title="messages.complaintTitle"
    :subtitle="unit ? unit.code + ' · ' + unit.location : ''"
    :busy="saving"
    :dirty="dirty"
  >
    <v-form
      id="ac-complaint-form"
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
        for="ac-complaint-kind"
        class="field-label ac-first-label"
        >{{ messages.complaintKind }}</label
      ><v-select
        id="ac-complaint-kind"
        v-model="kind"
        :items="kindItems"
        :disabled="saving"
      />
      <label
        for="ac-complaint-note"
        class="field-label"
        >{{ messages.complaintNote }}</label
      ><v-textarea
        id="ac-complaint-note"
        v-model="note"
        :disabled="saving"
        rows="2"
        auto-grow
        maxlength="500"
        :hint="kind === 'other' ? '' : messages.optional"
        persistent-hint
        :error-messages="noteError"
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
        form="ac-complaint-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ messages.reportComplaint }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
