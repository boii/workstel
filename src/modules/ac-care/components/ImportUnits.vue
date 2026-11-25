<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import { errorMessage, fill, useAcCareMessages } from '../composables/useAcCareMessages';
import type { ImportRow } from '../types';
import { parseUnitLines } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  save: (rows: ImportRow[]) => Promise<{ added: number; skipped: number }>;
}>();
const emit = defineEmits<{ done: [text: string] }>();
const messages = useAcCareMessages();
const text = ref('');
const saving = ref(false);
const failure = ref('');
const dirty = computed(() => !!text.value.trim());
watch(open, (value) => {
  if (!value) return;
  text.value = '';
  failure.value = '';
});
const parsed = computed(() => parseUnitLines(text.value));
const ready = computed(
  () =>
    parsed.value.rows.length > 0 && !parsed.value.invalid.length && parsed.value.rows.length <= 500,
);
async function submit() {
  if (saving.value || !ready.value) return;
  saving.value = true;
  failure.value = '';
  try {
    const result = await props.save(parsed.value.rows);
    emit('done', fill(messages.value.importDone, result));
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
    :title="messages.importUnits"
    :busy="saving"
    :dirty="dirty"
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
      for="ac-import"
      class="field-label ac-first-label"
      >{{ messages.importUnits }}</label
    ><v-textarea
      id="ac-import"
      v-model="text"
      :disabled="saving"
      rows="8"
      class="ac-import"
      :placeholder="messages.importPlaceholder"
      :hint="messages.importHint"
      persistent-hint
    />
    <p
      v-if="parsed.invalid.length"
      class="ac-error-text"
      role="alert"
    >
      {{ messages.importInvalid }} {{ parsed.invalid.join(', ') }}
    </p>
    <p
      v-else-if="parsed.rows.length"
      class="ac-hint"
    >
      {{ parsed.rows.length }} {{ messages.importPreview }}
    </p>
    <template #actions="{ close }">
      <v-btn
        variant="text"
        :disabled="saving"
        @click="close"
        >{{ messages.cancel }}</v-btn
      ><v-btn
        color="primary"
        :loading="saving"
        :disabled="!ready"
        @click="submit"
        >{{ messages.importAction }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
