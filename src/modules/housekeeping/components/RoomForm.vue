<script setup lang="ts">
import { ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import { errorMessage, useHousekeepingMessages } from '../composables/useHousekeepingMessages';
import type { Room, RoomInput } from '../types';
import { validateRoom } from '../validation';
import type { ValidationError } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  room: Room | null;
  save: (input: RoomInput) => Promise<void>;
}>();
const messages = useHousekeepingMessages();
const draft = ref<RoomInput>({ roomNumber: '', floor: '', roomType: '' });
const errors = ref<Partial<Record<keyof RoomInput, ValidationError>>>({});
const saving = ref(false);
const failure = ref('');
watch(open, (value) => {
  if (!value) return;
  draft.value = props.room
    ? { roomNumber: props.room.number, floor: props.room.floor, roomType: props.room.roomType }
    : { roomNumber: '', floor: '', roomType: '' };
  errors.value = {};
  failure.value = '';
});
async function submit() {
  if (saving.value) return;
  errors.value = validateRoom(draft.value);
  const invalid = Object.keys(errors.value)[0];
  if (invalid) {
    document.getElementById('hk-room-' + invalid)?.focus();
    return;
  }
  saving.value = true;
  failure.value = '';
  try {
    await props.save({ ...draft.value });
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    saving.value = false;
  }
}
const fieldError = (field: keyof RoomInput) =>
  errors.value[field] ? messages.value[errors.value[field]!] : '';
</script>
<template>
  <ModuleDialog
    v-model="open"
    :title="room ? messages.editRoom : messages.addRoom"
    :busy="saving"
    :width="460"
  >
    <v-form
      id="hk-room-form"
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
      <div class="hk-form-grid">
        <div>
          <label
            for="hk-room-roomNumber"
            class="field-label hk-first-label"
            >{{ messages.roomNumber }}</label
          ><v-text-field
            id="hk-room-roomNumber"
            v-model="draft.roomNumber"
            :disabled="saving"
            maxlength="10"
            autocomplete="off"
            autofocus
            :error-messages="fieldError('roomNumber')"
          />
        </div>
        <div>
          <label
            for="hk-room-floor"
            class="field-label hk-first-label"
            >{{ messages.floorLabel }}</label
          ><v-text-field
            id="hk-room-floor"
            v-model="draft.floor"
            :disabled="saving"
            maxlength="10"
            autocomplete="off"
            :error-messages="fieldError('floor')"
          />
        </div>
      </div>
      <label
        for="hk-room-roomType"
        class="field-label"
        >{{ messages.roomType }}</label
      ><v-text-field
        id="hk-room-roomType"
        v-model="draft.roomType"
        :disabled="saving"
        maxlength="50"
        :placeholder="messages.roomTypePlaceholder"
        :error-messages="fieldError('roomType')"
      />
    </v-form>
    <template #actions>
      <v-btn
        variant="text"
        :disabled="saving"
        @click="open = false"
        >{{ messages.cancel }}</v-btn
      ><v-btn
        color="primary"
        type="submit"
        form="hk-room-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ messages.saveRoom }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
