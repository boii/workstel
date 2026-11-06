<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import OptionalFields from '../../../shared/optional-fields.vue';
import { t } from '../../../i18n';
import {
  entryKeys,
  errorMessage,
  formatQuantity,
  useBinCardMessages,
} from '../composables/useBinCardMessages';
import { entryTypes } from '../types';
import type { EntryType, StockEntryInput, StockItem } from '../types';
import { entryDelta, parseQuantity, validateEntry } from '../validation';
import type { EntryField, ValidationError } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  item: StockItem | null;
  record: (input: StockEntryInput, idempotencyKey: string) => Promise<void>;
}>();
const messages = useBinCardMessages();
const type = ref<EntryType>('receipt');
const quantity = ref('');
const reference = ref('');
const notes = ref('');
const errors = ref<Partial<Record<EntryField, ValidationError>>>({});
const saving = ref(false);
const failure = ref('');
// One key per opened form, so a retried submit after a network error is not recorded twice.
let idempotencyKey = '';
watch(open, (value) => {
  if (!value) return;
  type.value = 'receipt';
  quantity.value = '';
  reference.value = '';
  notes.value = '';
  errors.value = {};
  failure.value = '';
  idempotencyKey = crypto.randomUUID();
});
watch([type, quantity], () => {
  if (errors.value.quantity) errors.value = { ...errors.value, quantity: undefined };
});
const balance = computed(() => props.item?.balance ?? 0);
const preview = computed(() => {
  const amount = parseQuantity(quantity.value);
  if (amount === undefined) return null;
  const next = balance.value + entryDelta(type.value, amount, balance.value);
  return next < 0 ? null : Math.round(next * 1000) / 1000;
});
async function submit() {
  if (saving.value || !props.item) return;
  errors.value = validateEntry(
    { type: type.value, quantity: quantity.value, reference: reference.value, notes: notes.value },
    balance.value,
  );
  const invalid = (Object.keys(errors.value) as EntryField[]).find((key) => errors.value[key]);
  if (invalid) {
    document.getElementById('bin-entry-' + invalid)?.focus();
    return;
  }
  saving.value = true;
  failure.value = '';
  try {
    await props.record(
      {
        type: type.value,
        quantity: parseQuantity(quantity.value)!,
        reference: reference.value,
        notes: notes.value,
      },
      idempotencyKey,
    );
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    saving.value = false;
  }
}
const fieldError = (field: EntryField) =>
  errors.value[field] ? messages.value[errors.value[field]!] : '';
const unit = computed(() => props.item?.unit ?? '');
</script>
<template>
  <ModuleDialog
    v-model="open"
    sheet
    :title="messages.entryTitle"
    :subtitle="item ? item.code + ' · ' + item.name : ''"
    :busy="saving"
  >
    <v-form
      id="bin-entry-form"
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
      <div class="entry-balances">
        <div>
          <small>{{ messages.currentBalance }}</small>
          <strong>{{ formatQuantity(balance) }} {{ unit }}</strong>
        </div>
        <v-icon
          icon="mdi-arrow-right"
          size="var(--workstel-icon-md)"
        />
        <div aria-live="polite">
          <small>{{ messages.newBalance }}</small>
          <strong>{{ preview === null ? '—' : formatQuantity(preview) + ' ' + unit }}</strong>
        </div>
      </div>
      <span
        id="bin-entry-type"
        class="field-label"
        >{{ messages.entryType }}</span
      ><v-btn-toggle
        v-model="type"
        mandatory
        variant="outlined"
        color="primary"
        class="choice-group entry-types"
        aria-labelledby="bin-entry-type"
        :disabled="saving"
        ><v-btn
          v-for="entryType in entryTypes"
          :key="entryType"
          :value="entryType"
          >{{ messages[entryKeys[entryType]] }}</v-btn
        ></v-btn-toggle
      >
      <label
        for="bin-entry-quantity"
        class="field-label"
        >{{ type === 'adjustment' ? messages.countedQuantity : messages.quantity }}</label
      ><v-text-field
        id="bin-entry-quantity"
        v-model="quantity"
        :disabled="saving"
        inputmode="decimal"
        maxlength="15"
        :suffix="unit"
        :hint="type === 'adjustment' ? messages.countHint : ''"
        :persistent-hint="type === 'adjustment'"
        :error-messages="fieldError('quantity')"
      /><OptionalFields
        :label="t('addReferenceNotes')"
        :filled="!!reference || !!notes || !!fieldError('reference') || !!fieldError('notes')"
        :reset-key="open"
      >
        <label
          for="bin-entry-reference"
          class="field-label"
          >{{ messages.reference }}</label
        ><v-text-field
          id="bin-entry-reference"
          v-model="reference"
          :disabled="saving"
          :placeholder="messages.referencePlaceholder"
          maxlength="60"
          :error-messages="fieldError('reference')"
        /><label
          for="bin-entry-notes"
          class="field-label"
          >{{ messages.notes }}</label
        ><v-textarea
          id="bin-entry-notes"
          v-model="notes"
          :disabled="saving"
          rows="2"
          auto-grow
          maxlength="500"
          :error-messages="fieldError('notes')"
        />
      </OptionalFields>
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
        form="bin-entry-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ messages.saveEntry }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
<style scoped>
.entry-balances {
  display: flex;
  align-items: center;
  gap: var(--workstel-space-4);
  padding: var(--workstel-space-3) var(--workstel-space-3_5);
  border-radius: var(--workstel-radius-md);
  background: var(--workstel-surface-muted);
}
.entry-balances > div {
  display: flex;
  flex-direction: column;
  gap: var(--workstel-space-0_5);
}
.entry-balances small {
  font-size: var(--workstel-font-xs);
  color: var(--workstel-text-secondary);
}
.entry-balances strong {
  font:
    600 var(--workstel-font-md) 'Noto Sans',
    sans-serif;
}
.entry-balances .v-icon {
  color: var(--workstel-text-secondary);
}
.entry-types {
  width: 100%;
  flex-wrap: nowrap;
}
.entry-types .v-btn {
  flex: 1;
  min-width: 0;
  font-size: var(--workstel-font-sm);
}
</style>
