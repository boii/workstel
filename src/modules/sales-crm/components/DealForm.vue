<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import OptionalFields from '../../../shared/optional-fields.vue';
import { t } from '../../../i18n';
import {
  errorMessage,
  segmentKeys,
  stageKeys,
  useSalesMessages,
} from '../composables/useSalesMessages';
import { segments, stages } from '../types';
import type { Deal, DealInput, Segment, Stage } from '../types';
import { validateDeal } from '../validation';
import type { ValidationError } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  deal: Deal | null;
  /** Accounts the user can add deals to; a new deal may preselect one. */
  accounts: { id: string; name: string }[];
  accountId: string | null;
  save: (input: DealInput) => Promise<void>;
}>();
/** Account names are searched on the server, so long account lists stay usable. */
const emit = defineEmits<{ search: [text: string] }>();
const messages = useSalesMessages();

// Number and date inputs are edited as text and converted on submit.
interface Draft {
  accountId: string;
  title: string;
  segment: Segment;
  stage: Stage;
  value: string;
  roomNights: string;
  arrivalDate: string;
  departureDate: string;
  nextFollowUp: string;
  lostReason: string;
  notes: string;
}
const draft = ref<Draft>(empty());
function empty(): Draft {
  return {
    accountId: props.accountId ?? props.accounts[0]?.id ?? '',
    title: '',
    segment: 'corporate',
    stage: 'lead',
    value: '',
    roomNights: '',
    arrivalDate: '',
    departureDate: '',
    nextFollowUp: '',
    lostReason: '',
    notes: '',
  };
}
const errors = ref<Partial<Record<keyof DealInput, ValidationError>>>({});
const saving = ref(false);
const failure = ref('');
watch(open, (value) => {
  if (!value) return;
  const deal = props.deal;
  draft.value = deal
    ? {
        accountId: deal.accountId,
        title: deal.title,
        segment: deal.segment,
        stage: deal.stage,
        value: String(deal.value),
        roomNights: deal.roomNights === null ? '' : String(deal.roomNights),
        arrivalDate: deal.arrivalDate ?? '',
        departureDate: deal.departureDate ?? '',
        nextFollowUp: deal.nextFollowUp ?? '',
        lostReason: deal.lostReason,
        notes: deal.notes,
      }
    : empty();
  errors.value = {};
  failure.value = '';
});
const closed = computed(() => draft.value.stage === 'won' || draft.value.stage === 'lost');
const accountItems = computed(() => {
  const deal = props.deal;
  return deal && !props.accounts.some((a) => a.id === deal.accountId)
    ? [{ id: deal.accountId, name: deal.accountName }, ...props.accounts]
    : props.accounts;
});
const segmentItems = computed(() =>
  segments.map((value) => ({ value, title: messages.value[segmentKeys[value]] })),
);
const stageItems = computed(() =>
  stages.map((value) => ({ value, title: messages.value[stageKeys[value]] })),
);
// Rupiah amounts may be typed with thousand separators (85.000.000); counts may not.
const toNumber = (value: string, grouped = false) => {
  const text = grouped ? value.trim().replace(/[.,\s]/g, '') : value.trim();
  return text === '' ? null : /^\d+$/.test(text) ? Number(text) : NaN;
};
const toDay = (value: string) => (value.trim() ? value.trim() : null);
function input(): DealInput {
  const d = draft.value;
  return {
    accountId: d.accountId,
    title: d.title,
    segment: d.segment,
    stage: d.stage,
    value: toNumber(d.value, true) ?? 0,
    roomNights: toNumber(d.roomNights),
    arrivalDate: toDay(d.arrivalDate),
    departureDate: toDay(d.departureDate),
    nextFollowUp: closed.value ? null : toDay(d.nextFollowUp),
    lostReason: d.stage === 'lost' ? d.lostReason : '',
    notes: d.notes,
  };
}
async function submit() {
  if (saving.value) return;
  const value = input();
  errors.value = validateDeal(value);
  const invalid = Object.keys(errors.value)[0];
  if (invalid) {
    document.getElementById('sales-deal-' + invalid)?.focus();
    return;
  }
  saving.value = true;
  failure.value = '';
  try {
    await props.save(value);
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    saving.value = false;
  }
}
const fieldError = (field: keyof DealInput) =>
  errors.value[field] ? messages.value[errors.value[field]!] : '';
</script>
<template>
  <ModuleDialog
    v-model="open"
    :title="deal ? messages.editDeal : messages.addDeal"
    :subtitle="deal ? deal.accountName : ''"
    :busy="saving"
    :width="620"
  >
    <v-form
      id="sales-deal-form"
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
      <template v-if="!deal">
        <label
          for="sales-deal-accountId"
          class="field-label sales-first-label"
          >{{ messages.account }}</label
        ><v-autocomplete
          id="sales-deal-accountId"
          v-model="draft.accountId"
          :disabled="saving"
          :items="accountItems"
          item-title="name"
          item-value="id"
          no-filter
          :error-messages="fieldError('accountId')"
          @update:search="(text: string) => emit('search', text ?? '')"
        />
      </template>
      <label
        for="sales-deal-title"
        class="field-label"
        :class="{ 'sales-first-label': !!deal }"
        >{{ messages.dealTitle }}</label
      ><v-text-field
        id="sales-deal-title"
        v-model="draft.title"
        :disabled="saving"
        :placeholder="messages.dealTitlePlaceholder"
        maxlength="150"
        :autofocus="!!deal"
        :error-messages="fieldError('title')"
      />
      <div class="sales-form-grid">
        <div>
          <label
            for="sales-deal-stage"
            class="field-label"
            >{{ messages.stage }}</label
          ><v-select
            id="sales-deal-stage"
            v-model="draft.stage"
            :disabled="saving"
            :items="stageItems"
            :error-messages="fieldError('stage')"
          />
        </div>
        <div>
          <label
            for="sales-deal-segment"
            class="field-label"
            >{{ messages.segment }}</label
          ><v-select
            id="sales-deal-segment"
            v-model="draft.segment"
            :disabled="saving"
            :items="segmentItems"
            :error-messages="fieldError('segment')"
          />
        </div>
      </div>
      <template v-if="draft.stage === 'lost'">
        <label
          for="sales-deal-lostReason"
          class="field-label"
          >{{ messages.lostReason }}</label
        ><v-text-field
          id="sales-deal-lostReason"
          v-model="draft.lostReason"
          :disabled="saving"
          :placeholder="messages.lostReasonPlaceholder"
          maxlength="300"
          :error-messages="fieldError('lostReason')"
        />
      </template>
      <div class="sales-form-grid">
        <div>
          <label
            for="sales-deal-value"
            class="field-label"
            >{{ messages.value }}</label
          ><v-text-field
            id="sales-deal-value"
            v-model="draft.value"
            :disabled="saving"
            inputmode="numeric"
            placeholder="0"
            maxlength="17"
            :error-messages="fieldError('value')"
          />
        </div>
        <div>
          <label
            for="sales-deal-roomNights"
            class="field-label"
            >{{ messages.roomNights }}</label
          ><v-text-field
            id="sales-deal-roomNights"
            v-model="draft.roomNights"
            :disabled="saving"
            inputmode="numeric"
            maxlength="7"
            :error-messages="fieldError('roomNights')"
          />
        </div>
        <div>
          <label
            for="sales-deal-arrivalDate"
            class="field-label"
            >{{ messages.arrivalDate }}</label
          ><v-text-field
            id="sales-deal-arrivalDate"
            v-model="draft.arrivalDate"
            :disabled="saving"
            type="date"
            min="2000-01-01"
            max="2100-12-31"
            :error-messages="fieldError('arrivalDate')"
          />
        </div>
        <div>
          <label
            for="sales-deal-departureDate"
            class="field-label"
            >{{ messages.departureDate }}</label
          ><v-text-field
            id="sales-deal-departureDate"
            v-model="draft.departureDate"
            :disabled="saving"
            type="date"
            :min="draft.arrivalDate || '2000-01-01'"
            max="2100-12-31"
            :error-messages="fieldError('departureDate')"
          />
        </div>
      </div>
      <template v-if="!closed">
        <label
          for="sales-deal-nextFollowUp"
          class="field-label"
          >{{ messages.nextFollowUp }}</label
        ><v-text-field
          id="sales-deal-nextFollowUp"
          v-model="draft.nextFollowUp"
          :disabled="saving"
          type="date"
          min="2000-01-01"
          max="2100-12-31"
          :hint="messages.nextFollowUpHint"
          persistent-hint
          :error-messages="fieldError('nextFollowUp')"
        />
      </template>
      <OptionalFields
        :label="t('addNotes')"
        :filled="!!draft.notes || !!fieldError('notes')"
        :reset-key="open"
      >
        <label
          for="sales-deal-notes"
          class="field-label"
          >{{ messages.notes }}</label
        ><v-textarea
          id="sales-deal-notes"
          v-model="draft.notes"
          :disabled="saving"
          rows="2"
          auto-grow
          maxlength="1000"
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
        form="sales-deal-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ messages.saveDeal }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
