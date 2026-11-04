<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import { accountTypeKeys, errorMessage, useSalesMessages } from '../composables/useSalesMessages';
import { accountTypes } from '../types';
import type { AccountInput, SalesAccount } from '../types';
import { validateAccount } from '../validation';
import type { ValidationError } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  account: SalesAccount | null;
  departments: { id: string; name: string }[];
  save: (input: AccountInput) => Promise<void>;
}>();
const messages = useSalesMessages();
const blank = (): AccountInput => ({
  name: '',
  type: 'corporate',
  contactName: '',
  contactPhone: '',
  contactEmail: '',
  notes: '',
  departmentId: props.departments[0]?.id ?? '',
});
const draft = ref<AccountInput>(blank());
const errors = ref<Partial<Record<keyof AccountInput, ValidationError>>>({});
const saving = ref(false);
const failure = ref('');
watch(open, (value) => {
  if (!value) return;
  const account = props.account;
  draft.value = account
    ? {
        name: account.name,
        type: account.type,
        contactName: account.contactName,
        contactPhone: account.contactPhone,
        contactEmail: account.contactEmail,
        notes: account.notes,
        departmentId: account.departmentId,
      }
    : blank();
  errors.value = {};
  failure.value = '';
});
const typeItems = computed(() =>
  accountTypes.map((value) => ({ value, title: messages.value[accountTypeKeys[value]] })),
);
async function submit() {
  if (saving.value) return;
  errors.value = validateAccount(draft.value);
  const invalid = Object.keys(errors.value)[0];
  if (invalid) {
    document.getElementById('sales-account-' + invalid)?.focus();
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
const fieldError = (field: keyof AccountInput) =>
  errors.value[field] ? messages.value[errors.value[field]!] : '';
</script>
<template>
  <ModuleDialog
    v-model="open"
    :title="account ? messages.editAccount : messages.addAccount"
    :busy="saving"
  >
    <v-form
      id="sales-account-form"
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
        for="sales-account-name"
        class="field-label sales-first-label"
        >{{ messages.accountName }}</label
      ><v-text-field
        id="sales-account-name"
        v-model="draft.name"
        :disabled="saving"
        :placeholder="messages.accountNamePlaceholder"
        maxlength="150"
        autofocus
        :error-messages="fieldError('name')"
      />
      <div class="sales-form-grid">
        <div>
          <label
            for="sales-account-type"
            class="field-label"
            >{{ messages.accountType }}</label
          ><v-select
            id="sales-account-type"
            v-model="draft.type"
            :disabled="saving"
            :items="typeItems"
            :error-messages="fieldError('type')"
          />
        </div>
        <div v-if="departments.length > 1 || account">
          <label
            for="sales-account-departmentId"
            class="field-label"
            >{{ messages.department }}</label
          ><v-select
            id="sales-account-departmentId"
            v-model="draft.departmentId"
            :disabled="saving || !!account"
            :items="departments"
            item-title="name"
            item-value="id"
            :error-messages="fieldError('departmentId')"
          />
        </div>
      </div>
      <h3 class="sales-form-section">{{ messages.contactSection }}</h3>
      <label
        for="sales-account-contactName"
        class="field-label sales-first-label"
        >{{ messages.contactName }}</label
      ><v-text-field
        id="sales-account-contactName"
        v-model="draft.contactName"
        :disabled="saving"
        maxlength="100"
        autocomplete="off"
        :error-messages="fieldError('contactName')"
      />
      <div class="sales-form-grid">
        <div>
          <label
            for="sales-account-contactPhone"
            class="field-label"
            >{{ messages.contactPhone }}</label
          ><v-text-field
            id="sales-account-contactPhone"
            v-model="draft.contactPhone"
            :disabled="saving"
            type="tel"
            inputmode="tel"
            autocomplete="off"
            maxlength="40"
            :error-messages="fieldError('contactPhone')"
          />
        </div>
        <div>
          <label
            for="sales-account-contactEmail"
            class="field-label"
            >{{ messages.contactEmail }}</label
          ><v-text-field
            id="sales-account-contactEmail"
            v-model="draft.contactEmail"
            :disabled="saving"
            type="email"
            inputmode="email"
            autocomplete="off"
            maxlength="254"
            :error-messages="fieldError('contactEmail')"
          />
        </div>
      </div>
      <label
        for="sales-account-notes"
        class="field-label"
        >{{ messages.notes }}</label
      ><v-textarea
        id="sales-account-notes"
        v-model="draft.notes"
        :disabled="saving"
        rows="2"
        auto-grow
        maxlength="1000"
        :hint="messages.notesHint"
        persistent-hint
        :error-messages="fieldError('notes')"
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
        form="sales-account-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ messages.saveAccount }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
