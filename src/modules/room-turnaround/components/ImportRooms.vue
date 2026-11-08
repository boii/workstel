<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import { errorMessage, useRoomTurnaroundMessages } from '../composables/useRoomTurnaroundMessages';
import type { RoomInput } from '../types';
import { parseRoomLines } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  save: (rows: RoomInput[]) => Promise<{ added: number; skipped: number }>;
}>();
const emit = defineEmits<{ done: [text: string] }>();
const messages = useRoomTurnaroundMessages();
const text = ref('');
const saving = ref(false);
const failure = ref('');
const dirty = computed(() => !!text.value.trim());
watch(open, (value) => {
  if (!value) return;
  text.value = '';
  failure.value = '';
});
const parsed = computed(() => parseRoomLines(text.value));
async function submit() {
  const { rows, invalid } = parsed.value;
  if (saving.value || !rows.length || invalid.length || rows.length > 500) return;
  saving.value = true;
  failure.value = '';
  try {
    const result = await props.save(rows);
    emit(
      'done',
      messages.value.importDone
        .replace('{added}', String(result.added))
        .replace('{skipped}', String(result.skipped)),
    );
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
    :title="messages.importRooms"
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
      for="hk-import"
      class="field-label hk-first-label"
      >{{ messages.importRooms }}</label
    ><v-textarea
      id="hk-import"
      v-model="text"
      :disabled="saving"
      rows="8"
      class="hk-import"
      :placeholder="messages.importPlaceholder"
      :hint="messages.importHint"
      persistent-hint
    />
    <p
      v-if="parsed.invalid.length"
      class="hk-import-error"
      role="alert"
    >
      {{ messages.importInvalid }} {{ parsed.invalid.join(', ') }}
    </p>
    <p
      v-else-if="parsed.rows.length"
      class="hk-muted"
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
        :disabled="!parsed.rows.length || parsed.invalid.length > 0 || parsed.rows.length > 500"
        @click="submit"
        >{{ messages.importAction }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
