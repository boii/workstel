<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import {
  activityKeys,
  errorMessage,
  outcomeKeys,
  useSalesMessages,
} from '../composables/useSalesMessages';
import { activityOutcomes, activityTypes, openStages, outcomeRequiredTypes } from '../types';
import type { ActivityInput, Deal } from '../types';
import {
  entryDelayDays,
  entryTiming,
  hotelToday,
  isCalendarDate,
  validateActivity,
} from '../validation';
import type { ValidationError } from '../validation';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  accountName: string;
  /** The account's main contact, offered as the client contact. */
  contactName?: string;
  /** Deals of the account; only open deals can take a new follow-up date. */
  deals: Deal[];
  dealId: string | null;
  save: (input: ActivityInput, idempotencyKey: string) => Promise<void>;
}>();
const messages = useSalesMessages();
const today = ref(hotelToday());
const draft = ref<ActivityInput>(blank());
function blank(): ActivityInput {
  return {
    type: 'call',
    occurredOn: today.value,
    summary: '',
    outcome: null,
    metWith: props.contactName ?? '',
    reference: '',
    dealId: props.dealId,
    nextFollowUp: null,
  };
}
const followUp = ref('');
// One key per opened form, so a retried submit cannot log the activity twice.
let idempotencyKey = crypto.randomUUID();
const errors = ref<Partial<Record<keyof ActivityInput, ValidationError>>>({});
const saving = ref(false);
const failure = ref('');
const initial = ref('');
const dirty = computed(() => JSON.stringify(draft.value) !== initial.value || !!followUp.value);
watch(open, (value) => {
  if (!value) return;
  today.value = hotelToday();
  draft.value = blank();
  initial.value = JSON.stringify(draft.value);
  followUp.value = '';
  idempotencyKey = crypto.randomUUID();
  errors.value = {};
  failure.value = '';
});
const typeItems = computed(() =>
  activityTypes.map((value) => ({ value, title: messages.value[activityKeys[value]] })),
);
const outcomeRequired = computed(() => outcomeRequiredTypes.includes(draft.value.type));
const outcomeItems = computed(() => [
  ...(outcomeRequired.value ? [] : [{ value: null, title: messages.value.outcomeNone }]),
  ...activityOutcomes.map((value) => ({ value, title: messages.value[outcomeKeys[value]] })),
]);
const dealItems = computed(() => [
  { value: null, title: messages.value.activityNoDeal },
  ...props.deals.map((deal) => ({ value: deal.id, title: deal.title })),
]);
const selectedDealOpen = computed(() => {
  const deal = props.deals.find((d) => d.id === draft.value.dealId);
  return !!deal && (openStages as readonly string[]).includes(deal.stage);
});
async function submit() {
  if (saving.value) return;
  const input: ActivityInput = {
    ...draft.value,
    nextFollowUp: selectedDealOpen.value && followUp.value ? followUp.value : null,
  };
  errors.value = validateActivity(input, today.value);
  const invalid = Object.keys(errors.value)[0];
  if (invalid) {
    document.getElementById('sales-activity-' + invalid)?.focus();
    return;
  }
  saving.value = true;
  failure.value = '';
  try {
    await props.save(input, idempotencyKey);
    open.value = false;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    saving.value = false;
  }
}
// Preview of the server's entry timing, so a past date is not a surprise in the log.
const dateHint = computed(() => {
  if (!isCalendarDate(draft.value.occurredOn) || draft.value.occurredOn > today.value) return '';
  const timing = entryTiming(entryDelayDays(draft.value.occurredOn, today.value));
  if (timing === 'late') return messages.value.entryLateHint;
  return timing === 'backdated' ? messages.value.entryBackdatedHint : '';
});
const fieldError = (field: keyof ActivityInput) =>
  errors.value[field] ? messages.value[errors.value[field]!] : '';
</script>
<template>
  <ModuleDialog
    v-model="open"
    :title="messages.logActivity"
    :subtitle="accountName"
    :busy="saving"
    :dirty="dirty"
  >
    <v-form
      id="sales-activity-form"
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
      <div class="sales-form-grid">
        <div>
          <label
            for="sales-activity-type"
            class="field-label sales-first-label"
            >{{ messages.activityType }}</label
          ><v-select
            id="sales-activity-type"
            v-model="draft.type"
            :disabled="saving"
            :items="typeItems"
            :error-messages="fieldError('type')"
          />
        </div>
        <div>
          <label
            for="sales-activity-occurredOn"
            class="field-label sales-first-label"
            >{{ messages.occurredOn }}</label
          ><v-text-field
            id="sales-activity-occurredOn"
            v-model="draft.occurredOn"
            :disabled="saving"
            type="date"
            min="2000-01-01"
            :max="today"
            :hint="dateHint"
            :persistent-hint="!!dateHint"
            :error-messages="fieldError('occurredOn')"
          />
        </div>
      </div>
      <label
        for="sales-activity-summary"
        class="field-label"
        >{{ messages.activitySummary }}</label
      ><v-textarea
        id="sales-activity-summary"
        v-model="draft.summary"
        :disabled="saving"
        :placeholder="messages.activitySummaryPlaceholder"
        rows="3"
        auto-grow
        maxlength="1000"
        autofocus
        :error-messages="fieldError('summary')"
      />
      <label
        for="sales-activity-outcome"
        class="field-label"
        >{{ messages.activityOutcome }}</label
      ><v-select
        id="sales-activity-outcome"
        v-model="draft.outcome"
        :disabled="saving"
        :items="outcomeItems"
        :placeholder="outcomeRequired ? undefined : messages.outcomeNone"
        :hint="outcomeRequired ? '' : messages.activityOutcomeOptional"
        :persistent-hint="!outcomeRequired"
        :error-messages="fieldError('outcome')"
        @update:model-value="errors.outcome = undefined"
      />
      <div class="sales-form-grid">
        <div>
          <label
            for="sales-activity-metWith"
            class="field-label"
            >{{ messages.activityMetWith }}</label
          ><v-text-field
            id="sales-activity-metWith"
            v-model="draft.metWith"
            :disabled="saving"
            :placeholder="messages.activityMetWithPlaceholder"
            maxlength="100"
            :error-messages="fieldError('metWith')"
          />
        </div>
        <div>
          <label
            for="sales-activity-reference"
            class="field-label"
            >{{ messages.activityReference }}</label
          ><v-text-field
            id="sales-activity-reference"
            v-model="draft.reference"
            :disabled="saving"
            :placeholder="messages.activityReferencePlaceholder"
            maxlength="100"
            :error-messages="fieldError('reference')"
          />
        </div>
      </div>
      <template v-if="deals.length">
        <label
          for="sales-activity-dealId"
          class="field-label"
          >{{ messages.activityDeal }}</label
        ><v-select
          id="sales-activity-dealId"
          v-model="draft.dealId"
          :disabled="saving"
          :items="dealItems"
        />
      </template>
      <template v-if="selectedDealOpen">
        <label
          for="sales-activity-nextFollowUp"
          class="field-label"
          >{{ messages.activityFollowUp }}</label
        ><v-text-field
          id="sales-activity-nextFollowUp"
          v-model="followUp"
          :disabled="saving"
          type="date"
          :min="today"
          max="2100-12-31"
          :hint="messages.activityFollowUpHint"
          persistent-hint
          :error-messages="fieldError('nextFollowUp')"
        />
      </template>
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
        form="sales-activity-form"
        :loading="saving"
        @click.prevent="submit"
        >{{ messages.saveActivity }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
