<script setup lang="ts">
import VaultDialog from './VaultDialog.vue';
import { nextTick, ref, watch } from 'vue';
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
  accounting: 'accounting',
  'human-resource': 'humanResource',
  'admin-general': 'adminGeneral',
  housekeeping: 'housekeeping',
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
async function submit() {
  if (props.saving) return;
  errors.value = validateEntry(draft.value);
  const invalid = Object.keys(errors.value)[0] as VaultField | undefined;
  if (invalid) {
    await nextTick();
    document
      .getElementById('vault-' + (invalid === 'departmentId' ? 'department' : invalid))
      ?.focus();
    return;
  }
  emit('save', normalizeEntry(draft.value), props.entry?.id);
  if (props.closeOnSubmit) open.value = false;
}
function fieldError(field: VaultField) {
  const key = errors.value[field];
  return key ? messages.value[key] : '';
}
</script>
<template>
  <VaultDialog
    v-model="open"
    :title="entry ? messages.edit : messages.add"
    :busy="saving"
  >
    <v-form
      id="vault-account-form"
      class="vault-entry-form"
      @submit.prevent="submit"
    >
      <div class="vault-account-fields">
        <p class="vault-field-hint vault-password-policy vault-panel-intro">
          <v-icon
            icon="mdi-office-building-outline"
            size="var(--workstel-icon-xs)"
          />
          {{ messages.scopeHint }}
        </p>
        <v-alert
          v-if="serverError"
          role="alert"
          type="error"
          variant="tonal"
          class="mb-4"
          >{{ serverError }}</v-alert
        ><label
          for="vault-name"
          class="field-label"
          >{{ messages.name }}</label
        ><v-text-field
          id="vault-name"
          v-model="draft.name"
          :disabled="saving"
          autofocus
          autocomplete="off"
          maxlength="150"
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
              :disabled="saving"
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
              :disabled="saving"
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
          :disabled="saving"
          type="url"
          placeholder="https://service.example.com"
          maxlength="2048"
          :error-messages="fieldError('website')"
        />
        <p class="vault-field-hint vault-password-policy">
          <v-icon
            icon="mdi-lock-outline"
            size="var(--workstel-icon-xs)"
          />
          {{ passwordServiceAvailable ? messages.separatePasswordHint : messages.passwordHint }}
        </p>
        <label
          for="vault-notes"
          class="field-label"
          >{{ messages.notes }}</label
        ><v-textarea
          id="vault-notes"
          v-model="draft.notes"
          :disabled="saving"
          rows="2"
          maxlength="1000"
          :hint="messages.notesHint"
          persistent-hint
          :error-messages="fieldError('notes')"
        />
      </div>
    </v-form>
    <template #actions>
      <v-btn
        variant="text"
        :disabled="saving"
        @click="open = false"
        >{{ messages.cancel }}</v-btn
      >
      <v-btn
        color="primary"
        type="submit"
        form="vault-account-form"
        :loading="saving"
        :disabled="saving"
        @click.prevent="submit"
        >{{ messages.save }}</v-btn
      >
    </template>
  </VaultDialog>
</template>
