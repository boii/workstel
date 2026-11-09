<script setup lang="ts">
import { dialogWidth } from '../../../shared/dialog-widths';
import { ref, watch } from 'vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import {
  accountTypeKeys,
  activityIcons,
  activityKeys,
  errorMessage,
  formatDay,
  formatMoney,
  formatStay,
  outcomeKeys,
  stageKeys,
  useSalesMessages,
} from '../composables/useSalesMessages';
import type { Activity, Deal, Page, SalesAccount } from '../types';

const open = defineModel<boolean>({ required: true });
const props = defineProps<{
  account: SalesAccount | null;
  canWrite: boolean;
  canManage: boolean;
  /** Changes whenever the page saved something, so the detail reloads. */
  refreshKey: number;
  loadDeals: (accountId: string, signal: AbortSignal) => Promise<Page<Deal>>;
  loadActivities: (
    accountId: string,
    after: string | null,
    signal: AbortSignal,
  ) => Promise<Page<Activity>>;
}>();
const emit = defineEmits<{
  edit: [];
  archive: [];
  'add-deal': [];
  'edit-deal': [deal: Deal];
  log: [deals: Deal[]];
}>();
const messages = useSalesMessages();
const deals = ref<Deal[]>([]);
const activities = ref<Activity[]>([]);
const nextActivity = ref<string | null>(null);
const loading = ref(false);
const loadingMore = ref(false);
const failure = ref('');
let controller: AbortController | null = null;

async function load() {
  const account = props.account;
  if (!account) return;
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  loading.value = true;
  failure.value = '';
  try {
    const [dealPage, activityPage] = await Promise.all([
      props.loadDeals(account.id, signal),
      props.loadActivities(account.id, null, signal),
    ]);
    deals.value = dealPage.data;
    activities.value = activityPage.data;
    nextActivity.value = activityPage.nextCursor;
  } catch (error) {
    if (!signal.aborted) failure.value = errorMessage(messages.value, error);
  } finally {
    if (!signal.aborted) loading.value = false;
  }
}
async function loadMore() {
  if (!props.account || !nextActivity.value) return;
  loadingMore.value = true;
  try {
    const page = await props.loadActivities(
      props.account.id,
      nextActivity.value,
      new AbortController().signal,
    );
    activities.value = [...activities.value, ...page.data];
    nextActivity.value = page.nextCursor;
  } catch (error) {
    failure.value = errorMessage(messages.value, error);
  } finally {
    loadingMore.value = false;
  }
}
watch(open, (value) => {
  if (value) {
    deals.value = [];
    activities.value = [];
    void load();
  } else controller?.abort();
});
watch(
  () => props.refreshKey,
  () => {
    if (open.value) void load();
  },
);
const telLink = (phone: string) => 'tel:' + phone.replace(/[^0-9+]/g, '');
</script>
<template>
  <ModuleDialog
    v-model="open"
    fullscreen
    :title="account?.name ?? ''"
    :subtitle="
      account ? messages[accountTypeKeys[account.type]] + ' · ' + account.departmentName : ''
    "
    :width="dialogWidth['3xl']"
  >
    <template v-if="account">
      <v-alert
        v-if="account.status === 'archived'"
        type="info"
        variant="tonal"
        density="compact"
        class="mb-4"
        >{{ messages.archivedAccount }}</v-alert
      >
      <section
        class="sales-detail-section"
        aria-labelledby="sales-contact-heading"
      >
        <h3 id="sales-contact-heading">{{ messages.contactSection }}</h3>
        <p
          v-if="!account.contactName && !account.contactPhone && !account.contactEmail"
          class="sales-muted"
        >
          {{ messages.noContact }}
        </p>
        <div
          v-else
          class="sales-contact"
        >
          <strong v-if="account.contactName">{{ account.contactName }}</strong>
          <a
            v-if="account.contactPhone"
            :href="telLink(account.contactPhone)"
            :aria-label="messages.call + ' ' + account.contactPhone"
            ><v-icon
              icon="mdi-phone-outline"
              size="var(--workstel-icon-sm)"
            />{{ account.contactPhone }}</a
          >
          <a
            v-if="account.contactEmail"
            :href="'mailto:' + account.contactEmail"
            :aria-label="messages.sendEmail + ' ' + account.contactEmail"
            ><v-icon
              icon="mdi-email-outline"
              size="var(--workstel-icon-sm)"
            />{{ account.contactEmail }}</a
          >
        </div>
        <p
          v-if="account.notes"
          class="sales-notes"
        >
          {{ account.notes }}
        </p>
      </section>

      <v-alert
        v-if="failure"
        type="error"
        variant="tonal"
        role="alert"
        class="mb-4"
        >{{ failure
        }}<v-btn
          variant="text"
          @click="load"
          >{{ messages.retry }}</v-btn
        ></v-alert
      >
      <v-skeleton-loader
        v-else-if="loading && !deals.length && !activities.length"
        type="list-item-two-line, list-item-two-line"
      />
      <template v-else>
        <section
          class="sales-detail-section"
          aria-labelledby="sales-deals-heading"
        >
          <div class="sales-detail-heading">
            <h3 id="sales-deals-heading">{{ messages.accountDeals }}</h3>
            <v-btn
              v-if="canWrite && account.status === 'active'"
              variant="text"
              color="primary"
              prepend-icon="mdi-plus"
              @click="emit('add-deal')"
              >{{ messages.addDeal }}</v-btn
            >
          </div>
          <p
            v-if="!deals.length"
            class="sales-muted"
          >
            {{ messages.noAccountDeals }}
          </p>
          <ul
            v-else
            class="sales-mini-list"
          >
            <li
              v-for="deal in deals"
              :key="deal.id"
            >
              <div>
                <strong>{{ deal.title }}</strong>
                <small
                  >{{ deal.value ? formatMoney(deal.value) : messages.noValue }}
                  <template v-if="deal.arrivalDate">
                    · {{ formatStay(deal.arrivalDate, deal.departureDate) }}</template
                  ></small
                >
              </div>
              <span
                class="sales-stage"
                :class="'sales-stage--' + deal.stage"
                >{{ messages[stageKeys[deal.stage]] }}</span
              >
              <v-btn
                v-if="canWrite"
                icon="mdi-pencil-outline"
                variant="text"
                size="small"
                :aria-label="messages.editDeal + ' — ' + deal.title"
                @click="emit('edit-deal', deal)"
              />
            </li>
          </ul>
        </section>

        <section
          class="sales-detail-section"
          aria-labelledby="sales-activities-heading"
        >
          <div class="sales-detail-heading">
            <h3 id="sales-activities-heading">{{ messages.activities }}</h3>
            <v-btn
              v-if="canWrite && account.status === 'active'"
              variant="text"
              color="primary"
              prepend-icon="mdi-plus"
              @click="emit('log', deals)"
              >{{ messages.logActivity }}</v-btn
            >
          </div>
          <p
            v-if="!activities.length"
            class="sales-muted"
          >
            {{ messages.noActivities }}
          </p>
          <ol
            v-else
            class="sales-timeline"
          >
            <li
              v-for="activity in activities"
              :key="activity.id"
            >
              <v-icon
                :icon="activityIcons[activity.type]"
                size="var(--workstel-icon-md)"
              />
              <div>
                <small
                  ><strong>{{ messages[activityKeys[activity.type]] }}</strong> ·
                  {{ formatDay(activity.occurredOn) }}
                  <template v-if="activity.dealTitle"> · {{ activity.dealTitle }}</template></small
                >
                <p>{{ activity.summary }}</p>
                <div
                  v-if="activity.outcome || activity.metWith || activity.reference"
                  class="sales-outcome-line"
                >
                  <span
                    v-if="activity.outcome"
                    class="sales-outcome"
                    :class="'sales-outcome--' + activity.outcome"
                    >{{ messages[outcomeKeys[activity.outcome]] }}</span
                  ><small v-if="activity.metWith"
                    >{{ messages.activityWith }} {{ activity.metWith }}</small
                  ><small v-if="activity.reference"
                    >{{ messages.activityRef }} {{ activity.reference }}</small
                  >
                </div>
                <small
                  ><template v-if="activity.createdByName || activity.createdByEmail"
                    >{{ messages.activityBy }}
                    <span :title="activity.createdByEmail">{{
                      activity.createdByName || activity.createdByEmail
                    }}</span>
                    · </template
                  >{{ messages.entryRecorded }} {{ formatDay(activity.recordedOn) }}</small
                ><span
                  v-if="activity.entryTiming !== 'on-time'"
                  class="sales-entry"
                  :class="'sales-entry--' + activity.entryTiming"
                  ><v-icon
                    :icon="
                      activity.entryTiming === 'backdated'
                        ? 'mdi-calendar-alert-outline'
                        : 'mdi-clock-alert-outline'
                    "
                    size="15"
                  />{{
                    activity.entryTiming === 'backdated'
                      ? messages.entryBackdated
                      : messages.entryLate
                  }}
                  · {{ activity.entryDelayDays }}
                  {{
                    activity.entryDelayDays === 1 ? messages.entryDayAfter : messages.entryDaysAfter
                  }}</span
                >
              </div>
            </li>
          </ol>
          <v-btn
            v-if="nextActivity"
            variant="text"
            color="primary"
            :loading="loadingMore"
            @click="loadMore"
            >{{ messages.loadMore }}</v-btn
          >
        </section>
      </template>
    </template>
    <template
      v-if="account && (canWrite || canManage)"
      #actions
    >
      <v-btn
        v-if="canManage"
        variant="text"
        :prepend-icon="
          account.status === 'active' ? 'mdi-archive-outline' : 'mdi-archive-arrow-up-outline'
        "
        @click="emit('archive')"
        >{{ account.status === 'active' ? messages.archive : messages.restore }}</v-btn
      >
      <v-btn
        v-if="canWrite"
        color="primary"
        variant="tonal"
        prepend-icon="mdi-pencil-outline"
        @click="emit('edit')"
        >{{ messages.editAccount }}</v-btn
      >
    </template>
  </ModuleDialog>
</template>
