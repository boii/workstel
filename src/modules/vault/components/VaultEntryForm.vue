<script setup lang="ts">
import { ref, watch } from 'vue';
import { useVaultMessages } from '../composables/useVaultMessages';
import { departmentIds } from '../types';
import type { VaultEntry, VaultEntryInput, VaultField, VaultValidationError } from '../types';
import { normalizeEntry, validateEntry } from '../validation';
const open = defineModel<boolean>({ required: true });
const props = withDefaults(
  defineProps<{
    entry: VaultEntry | null;
    saving?: boolean;
    passwordServiceAvailable?: boolean;
    serverError?: string;
    closeOnSubmit?: boolean;
    allowedDepartments?: readonly (typeof departmentIds)[number][];
  }>(),
  {
    saving: false,
    serverError: '',
    closeOnSubmit: true,
    allowedDepartments: () => [...departmentIds],
  },
);
const emit = defineEmits<{ save: [input: VaultEntryInput, id?: string] }>();
const messages = useVaultMessages();
const draft = ref<VaultEntryInput>({
  name: '',
  username: '',
  website: '',
  departmentId: 'front-office',
  notes: '',
});
const errors = ref<Partial<Record<VaultField, VaultValidationError>>>({});
const departmentKeys = {
  'front-office': 'frontOffice',
  sales: 'sales',
  engineering: 'engineering',
  it: 'it',
} as const;
watch(open, (value) => {
  if (!value) return;
  Object.assign(
    draft.value,
    props.entry
      ? {
          name: props.entry.name,
          username: props.entry.username,
          website: props.entry.website,
          departmentId: props.entry.departmentId,
          notes: props.entry.notes,
        }
      : {
          name: '',
          username: '',
          website: '',
          departmentId: props.allowedDepartments[0] ?? 'front-office',
          notes: '',
        },
  );
  errors.value = {};
});
function submit() {
  if (props.saving) return;
  errors.value = validateEntry(draft.value);
  if (Object.keys(errors.value).length) return;
  emit('save', normalizeEntry(draft.value), props.entry?.id);
  if (props.closeOnSubmit) open.value = false;
}
function fieldError(field: VaultField) {
  const key = errors.value[field];
  return key ? messages.value[key] : '';
}
</script>
<template>
  <v-dialog
    v-model="open"
    :persistent="saving"
    max-width="600"
    ><v-card class="vault-dialog"
      ><div class="vault-dialog-heading">
        <h2>{{ entry ? messages.edit : messages.add }}</h2>
        <v-btn
          icon="mdi-close"
          variant="text"
          :aria-label="messages.close"
          :disabled="saving"
          @click="open = false"
        />
      </div>
      <v-alert
        v-if="serverError"
        type="error"
        variant="tonal"
        class="mb-4"
        >{{ serverError }}</v-alert
      ><v-form @submit.prevent="submit"
        ><label
          for="vault-name"
          class="field-label"
          >{{ messages.name }}</label
        ><v-text-field
          id="vault-name"
          v-model="draft.name"
          autofocus
          autocomplete="off"
          maxlength="150"
          :hint="messages.nameHint"
          :error-messages="fieldError('name')"
        />
        <div class="vault-form-grid">
          <div>
            <label
              for="vault-username"
              class="field-label"
              >{{ messages.username }}</label
            ><v-text-field
              id="vault-username"
              v-model="draft.username"
              autocomplete="off"
              maxlength="150"
              :error-messages="fieldError('username')"
            />
          </div>
          <div>
            <label
              for="vault-department"
              class="field-label"
              >{{ messages.department }}</label
            ><v-select
              id="vault-department"
              v-model="draft.departmentId"
              :items="
                allowedDepartments.map((value) => ({
                  value,
                  title: messages[departmentKeys[value]],
                }))
              "
              :error-messages="fieldError('departmentId')"
            />
          </div>
        </div>
        <label
          for="vault-website"
          class="field-label"
          >{{ messages.website }}</label
        ><v-text-field
          id="vault-website"
          v-model="draft.website"
          type="url"
          placeholder="https://service.example.com"
          maxlength="2048"
          :error-messages="fieldError('website')"
        /><label
          for="vault-password"
          class="field-label"
          >{{ messages.password }}</label
        ><v-text-field
          id="vault-password"
          disabled
          :placeholder="
            passwordServiceAvailable ? messages.managedSeparately : messages.unavailable
          "
          prepend-inner-icon="mdi-lock-outline"
        />
        <p class="vault-field-hint">
          {{ passwordServiceAvailable ? messages.separatePasswordHint : messages.passwordHint }}
        </p>
        <label
          for="vault-notes"
          class="field-label"
          >{{ messages.notes }}</label
        ><v-textarea
          id="vault-notes"
          v-model="draft.notes"
          rows="2"
          maxlength="1000"
          :hint="messages.notesHint"
          persistent-hint
          :error-messages="fieldError('notes')"
        />
        <div class="vault-dialog-actions">
          <v-btn
            variant="text"
            :disabled="saving"
            @click="open = false"
            >{{ messages.cancel }}</v-btn
          ><v-btn
            color="primary"
            type="submit"
            :loading="saving"
            :disabled="saving"
            >{{ messages.save }}</v-btn
          >
        </div></v-form
      ></v-card
    ></v-dialog
  >
</template>
