<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import ModulePage from '../../../shared/ModulePage.vue';
import FilterGroup from '../../../shared/filter-group.vue';
import ModuleDialog from '../../../shared/module-dialog.vue';
import KeyboardShortcuts from '../../../shared/keyboard-shortcuts.vue';
import { runtime } from '../../../config/runtime';
import { t } from '../../../i18n';
import type { ModuleAssignment } from '../../../core/module-access';
import { useShortcuts } from '../../../core/use-shortcuts';
import { focusFieldInput } from '../../../core/focus-field';
import type { FocusableField } from '../../../core/focus-field';
import AccountDetail from '../components/AccountDetail.vue';
import AccountForm from '../components/AccountForm.vue';
import ActivityForm from '../components/ActivityForm.vue';
import DealForm from '../components/DealForm.vue';
import {
  accountTypeIcons,
  accountTypeKeys,
  errorMessage,
  formatDay,
  formatMoney,
  formatStay,
  segmentKeys,
  stageKeys,
  useSalesMessages,
} from '../composables/useSalesMessages';
import { createDemoSalesCrmApi, demoDepartments, demoHotelId } from '../demo-api';
import { createLiveSalesCrmApi } from '../live-api';
import { accountTypes, openStages, stages } from '../types';
import type {
  AccountInput,
  AccountType,
  ActivityInput,
  Deal,
  DealInput,
  FollowUpFilter,
  RecordStatus,
  SalesAccount,
  SalesSummary,
  StageFilter,
} from '../types';
import { followUpState, hotelToday } from '../validation';
import '../styles.css';

const props = withDefaults(defineProps<{ access?: ModuleAssignment[] }>(), { access: () => [] });
const emit = defineEmits<{ back: [] }>();
const messages = useSalesMessages();
const api = runtime.demo ? createDemoSalesCrmApi() : createLiveSalesCrmApi();

// Demo mode grants every capability on a sample department; production uses server grants.
const scope = computed<ModuleAssignment[]>(() =>
  runtime.demo
    ? demoDepartments.map((d) => ({
        moduleId: 'sales-crm',
        hotelId: demoHotelId,
        hotelName: '',
        departmentId: d.id,
        departmentCode: d.id,
        departmentName: d.name,
        canRead: true,
        canWrite: true,
        canManage: true,
      }))
    : props.access.filter((row) => row.moduleId === 'sales-crm' && row.canRead),
);
const hotelId = computed(() => scope.value[0]?.hotelId ?? '');
const hotelScope = computed(() => scope.value.filter((row) => row.hotelId === hotelId.value));
const can = (departmentId: string, flag: 'canWrite' | 'canManage') =>
  hotelScope.value.some((row) => row.departmentId === departmentId && row[flag]);
const writableDepartments = computed(() =>
  hotelScope.value
    .filter((row) => row.canWrite)
    .map((row) => ({ id: row.departmentId, name: row.departmentName })),
);
const canWriteAny = computed(() => writableDepartments.value.length > 0);

type Tab = 'pipeline' | 'accounts';
const tab = ref<Tab>('pipeline');
const search = ref('');
const departmentId = ref<string | null>(null);
const stage = ref<StageFilter>('open');
const followUp = ref<FollowUpFilter>('any');
const accountType = ref<AccountType | null>(null);
const accountStatus = ref<RecordStatus | 'all'>('active');
const today = ref(hotelToday());

const deals = ref<Deal[]>([]);
const accounts = ref<SalesAccount[]>([]);
const summary = ref<SalesSummary | null>(null);
const nextCursor = ref<string | null>(null);
const loading = ref(true);
const loadingMore = ref(false);
const failure = ref('');
const notice = ref('');
let controller: AbortController | null = null;
let summaryController: AbortController | null = null;
let searchTimer: ReturnType<typeof setTimeout> | undefined;

async function loadSummary() {
  if (!hotelId.value) return;
  summaryController?.abort();
  summaryController = new AbortController();
  try {
    summary.value = await api.summary(hotelId.value, departmentId.value, summaryController.signal);
    today.value = summary.value.today;
  } catch {
    // The figures are optional; the list shows its own error.
    if (!summaryController.signal.aborted) summary.value = null;
  }
}
async function load(after: string | null = null) {
  if (!hotelId.value) return;
  controller?.abort();
  controller = new AbortController();
  if (after) loadingMore.value = true;
  else loading.value = true;
  failure.value = '';
  try {
    if (tab.value === 'pipeline') {
      const page = await api.listDeals(
        {
          hotelId: hotelId.value,
          departmentId: departmentId.value,
          stage: stage.value,
          accountId: null,
          followUp: followUp.value,
          search: search.value ?? '',
          after,
        },
        controller.signal,
      );
      deals.value = after ? [...deals.value, ...page.data] : page.data;
      nextCursor.value = page.nextCursor;
    } else {
      const page = await api.listAccounts(
        {
          hotelId: hotelId.value,
          departmentId: departmentId.value,
          status: accountStatus.value,
          type: accountType.value,
          search: search.value ?? '',
          after,
        },
        controller.signal,
      );
      accounts.value = after ? [...accounts.value, ...page.data] : page.data;
      nextCursor.value = page.nextCursor;
    }
  } catch (error) {
    if (!controller.signal.aborted) failure.value = errorMessage(messages.value, error);
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}
function refresh() {
  void load();
  void loadSummary();
  refreshKey.value++;
}
watch(tab, () => {
  search.value = '';
  nextCursor.value = null;
  void load();
});
watch([stage, followUp, accountType, accountStatus], () => void load());
watch(departmentId, () => refresh());
watch(search, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(), 300);
});
watch(
  hotelId,
  () => {
    void load();
    void loadSummary();
  },
  { immediate: true },
);
onBeforeUnmount(() => {
  controller?.abort();
  summaryController?.abort();
  clearTimeout(searchTimer);
});

const hasFilters = computed(
  () =>
    !!search.value ||
    !!departmentId.value ||
    (tab.value === 'pipeline'
      ? stage.value !== 'open' || followUp.value !== 'any'
      : !!accountType.value || accountStatus.value !== 'active'),
);
// Filters other than search; on phones they share one Filters button.
const filterCount = computed(
  () =>
    (departmentId.value ? 1 : 0) +
    (tab.value === 'pipeline'
      ? (stage.value !== 'open' ? 1 : 0) + (followUp.value !== 'any' ? 1 : 0)
      : (accountType.value ? 1 : 0) + (accountStatus.value !== 'active' ? 1 : 0)),
);
function resetFilterGroup() {
  departmentId.value = null;
  stage.value = 'open';
  followUp.value = 'any';
  accountType.value = null;
  accountStatus.value = 'active';
}
function resetFilters() {
  search.value = '';
  departmentId.value = null;
  stage.value = 'open';
  followUp.value = 'any';
  accountType.value = null;
  accountStatus.value = 'active';
}
function showOverdue() {
  tab.value = 'pipeline';
  stage.value = 'open';
  followUp.value = 'overdue';
}
function showWeek() {
  tab.value = 'pipeline';
  stage.value = 'open';
  followUp.value = 'week';
}

// Account form and detail
const refreshKey = ref(0);
const accountFormOpen = ref(false);
const editingAccount = ref<SalesAccount | null>(null);
const detailOpen = ref(false);
const detailAccount = ref<SalesAccount | null>(null);
function openAccountForm(account: SalesAccount | null = null) {
  editingAccount.value = account;
  accountFormOpen.value = true;
}
async function saveAccount(input: AccountInput) {
  await api.saveAccount(hotelId.value, input, editingAccount.value ?? undefined);
  notice.value = messages.value.savedAccount;
  if (editingAccount.value && detailAccount.value?.id === editingAccount.value.id)
    detailAccount.value = {
      ...detailAccount.value,
      ...input,
      contactEmail: input.contactEmail.trim().toLowerCase(),
      version: detailAccount.value.version + 1,
    };
  refresh();
}
async function openAccount(accountId: string) {
  const known = accounts.value.find((a) => a.id === accountId);
  if (known) {
    detailAccount.value = known;
    detailOpen.value = true;
    return;
  }
  try {
    // Deals list only the account name, so the account is fetched by name and matched by id.
    const deal = deals.value.find((d) => d.accountId === accountId);
    const page = await api.listAccounts({
      hotelId: hotelId.value,
      departmentId: null,
      status: 'all',
      type: null,
      search: deal?.accountName ?? '',
      after: null,
    });
    const found = page.data.find((a) => a.id === accountId);
    if (!found) throw new Error('not found');
    detailAccount.value = found;
    detailOpen.value = true;
  } catch (error) {
    notice.value = errorMessage(messages.value, error);
  }
}
const archiveConfirmOpen = ref(false);
const archiving = ref(false);
function requestArchive() {
  if (!detailAccount.value) return;
  if (detailAccount.value.status === 'archived') void setArchived(false);
  else archiveConfirmOpen.value = true;
}
async function setArchived(archived: boolean) {
  const account = detailAccount.value;
  if (!account) return;
  archiving.value = true;
  try {
    await api.setAccountArchived(hotelId.value, account, archived);
    notice.value = archived ? messages.value.archivedDone : messages.value.restoredDone;
    detailAccount.value = {
      ...account,
      status: archived ? 'archived' : 'active',
      version: account.version + 1,
    };
    archiveConfirmOpen.value = false;
    refresh();
  } catch (error) {
    notice.value = errorMessage(messages.value, error);
  } finally {
    archiving.value = false;
  }
}
const loadAccountDeals = (accountId: string, signal: AbortSignal) =>
  api.listDeals(
    {
      hotelId: hotelId.value,
      departmentId: null,
      stage: 'all',
      accountId,
      followUp: 'any',
      search: '',
      after: null,
    },
    signal,
  );
const loadActivities = (accountId: string, after: string | null, signal: AbortSignal) =>
  api.listActivities(hotelId.value, accountId, null, after, signal);

// Deal form, with server-side account search for the account picker
const dealFormOpen = ref(false);
const editingDeal = ref<Deal | null>(null);
const dealAccountId = ref<string | null>(null);
const accountOptions = ref<{ id: string; name: string }[]>([]);
let optionsTimer: ReturnType<typeof setTimeout> | undefined;
async function searchAccounts(text: string) {
  try {
    const page = await api.listAccounts({
      hotelId: hotelId.value,
      departmentId: null,
      status: 'active',
      type: null,
      search: text.slice(0, 150),
      after: null,
    });
    const selected = accountOptions.value.find((a) => a.id === dealAccountId.value);
    const found = page.data
      .filter((a) => can(a.departmentId, 'canWrite'))
      .map((a) => ({ id: a.id, name: a.name }));
    accountOptions.value =
      selected && !found.some((a) => a.id === selected.id) ? [selected, ...found] : found;
  } catch {
    accountOptions.value = [];
  }
}
function onAccountSearch(text: string) {
  clearTimeout(optionsTimer);
  optionsTimer = setTimeout(() => void searchAccounts(text), 250);
}
async function openDealForm(deal: Deal | null = null, account: SalesAccount | null = null) {
  editingDeal.value = deal;
  dealAccountId.value = account?.id ?? null;
  if (account) accountOptions.value = [{ id: account.id, name: account.name }];
  else if (!deal) {
    await searchAccounts('');
    if (!accountOptions.value.length) {
      notice.value = messages.value.needAccount;
      return;
    }
  }
  dealFormOpen.value = true;
}
async function saveDeal(input: DealInput) {
  await api.saveDeal(hotelId.value, input, editingDeal.value ?? undefined);
  notice.value = messages.value.savedDeal;
  refresh();
}

// Activity form, from a deal row or an account detail
const activityFormOpen = ref(false);
const activityAccount = ref<{ id: string; name: string } | null>(null);
const activityDeals = ref<Deal[]>([]);
const activityDealId = ref<string | null>(null);
function openActivityForm(
  account: { id: string; name: string },
  list: Deal[],
  dealId: string | null,
) {
  activityAccount.value = account;
  activityDeals.value = list;
  activityDealId.value = dealId;
  activityFormOpen.value = true;
}
async function saveActivity(input: ActivityInput, key: string) {
  if (!activityAccount.value) return;
  await api.logActivity(hotelId.value, activityAccount.value.id, input, key);
  notice.value = messages.value.savedActivity;
  refresh();
}

const searchField = ref<FocusableField | null>(null);
const shortcutsOpen = ref(false);
const anyDialog = computed(
  () =>
    accountFormOpen.value ||
    dealFormOpen.value ||
    activityFormOpen.value ||
    detailOpen.value ||
    shortcutsOpen.value,
);
useShortcuts(() => [
  { key: '/', run: () => focusFieldInput(searchField.value) },
  { key: '?', shift: true, run: () => (shortcutsOpen.value = true) },
  { key: 'n', when: () => canWriteAny.value && !anyDialog.value, run: () => void openDealForm() },
  {
    key: 'a',
    when: () => canWriteAny.value && !anyDialog.value,
    run: () => openAccountForm(),
  },
]);
const shortcutRows = computed(() => [
  {
    keys: '/',
    label: tab.value === 'pipeline' ? messages.value.searchDeals : messages.value.searchAccounts,
  },
  ...(canWriteAny.value
    ? [
        { keys: 'N', label: messages.value.addDeal },
        { keys: 'A', label: messages.value.addAccount },
      ]
    : []),
  { keys: '?', label: t('shortcutList') },
  { keys: 'Esc', label: t('shortcutClose') },
]);

const stageItems = computed(() => [
  { value: 'open', title: messages.value.stageOpen },
  ...stages.map((value) => ({ value, title: messages.value[stageKeys[value]] })),
  { value: 'all', title: messages.value.stageAll },
]);
const followUpItems = computed(() => [
  { value: 'any', title: messages.value.followUpAny },
  { value: 'overdue', title: messages.value.followUpOverdue },
  { value: 'week', title: messages.value.followUpWeek },
]);
const typeItems = computed(() => [
  { value: null, title: messages.value.allTypes },
  ...accountTypes.map((value) => ({ value, title: messages.value[accountTypeKeys[value]] })),
]);
const statusItems = computed(() => [
  { value: 'active', title: messages.value.active },
  { value: 'archived', title: messages.value.archived },
  { value: 'all', title: messages.value.allAccounts },
]);
const departmentItems = computed(() => [
  { value: null, title: messages.value.allDepartments },
  ...hotelScope.value.map((row) => ({ value: row.departmentId, title: row.departmentName })),
]);
const rows = computed(() =>
  tab.value === 'pipeline' ? deals.value.length : accounts.value.length,
);
const pipelineTotal = computed(() =>
  summary.value ? openStages.reduce((sum, name) => sum + summary.value!.stages[name].value, 0) : 0,
);
const followUpLabel = (deal: Deal) => {
  const state = followUpState(deal.nextFollowUp, today.value);
  if (state === 'none') return '';
  if (state === 'today') return messages.value.followUpToday;
  return formatDay(deal.nextFollowUp!);
};
const dealCount = (count: number, withNumber = true) => {
  const word = count === 1 ? messages.value.summaryDealOne : messages.value.summaryDealsCount;
  return withNumber ? count + ' ' + word : word;
};
const isOpenStage = (deal: Deal) => (openStages as readonly string[]).includes(deal.stage);
</script>
<template>
  <div class="sales-module">
    <button
      class="sales-breadcrumb"
      @click="emit('back')"
    >
      <v-icon
        icon="mdi-arrow-left"
        size="16"
      />{{ messages.back }}
    </button>
    <ModulePage
      :title="messages.title"
      :description="rows + ' ' + (tab === 'pipeline' ? messages.deals : messages.accounts)"
      :loading="loading"
      :error="failure"
      :empty="!rows"
      :empty-title="
        hasFilters
          ? messages.noResults
          : tab === 'pipeline'
            ? messages.emptyDealsTitle
            : messages.emptyAccountsTitle
      "
      :empty-description="
        hasFilters
          ? messages.noResultsHint
          : !canWriteAny
            ? messages.emptyReadOnly
            : tab === 'pipeline'
              ? messages.emptyDealsDescription
              : messages.emptyAccountsDescription
      "
      :retry-label="messages.retry"
      @retry="load()"
    >
      <template #actions>
        <template v-if="canWriteAny">
          <v-btn
            variant="tonal"
            color="primary"
            prepend-icon="mdi-domain-plus"
            @click="openAccountForm()"
            >{{ messages.addAccount }}</v-btn
          ><v-btn
            color="primary"
            class="module-primary-action"
            prepend-icon="mdi-plus"
            @click="openDealForm()"
            >{{ messages.addDeal }}</v-btn
          >
        </template>
      </template>
      <template #toolbar>
        <v-alert
          v-if="runtime.demo"
          type="info"
          variant="tonal"
          density="compact"
          icon="mdi-handshake-outline"
          class="sales-notice"
          >{{ messages.demoNotice }}</v-alert
        >
        <div
          v-if="summary"
          class="sales-summary"
        >
          <div class="sales-tile">
            <span>{{ messages.summaryOpen }}</span>
            <strong>{{ formatMoney(summary.openValue, true) }}</strong>
            <small>{{ dealCount(summary.openCount) }}</small>
            <div
              v-if="pipelineTotal"
              class="sales-pipeline-bar"
              aria-hidden="true"
            >
              <i
                v-for="name in openStages"
                :key="name"
                :class="'sales-stage-fill--' + name"
                :style="{ flexGrow: summary.stages[name].value }"
              />
            </div>
          </div>
          <button
            type="button"
            class="sales-tile sales-tile--action"
            :class="{ 'sales-tile--alert': summary.overdue > 0 }"
            :aria-pressed="tab === 'pipeline' && followUp === 'overdue'"
            @click="showOverdue"
          >
            <span>{{ messages.summaryOverdue }}</span>
            <strong>{{ summary.overdue }}</strong>
            <small>{{ dealCount(summary.overdue, false) }}</small>
          </button>
          <button
            type="button"
            class="sales-tile sales-tile--action"
            :aria-pressed="tab === 'pipeline' && followUp === 'week'"
            @click="showWeek"
          >
            <span>{{ messages.summaryWeek }}</span>
            <strong>{{ summary.dueWeek }}</strong>
            <small>{{ dealCount(summary.dueWeek, false) }}</small>
          </button>
          <div class="sales-tile">
            <span>{{ messages.summaryWon }}</span>
            <strong>{{ formatMoney(summary.wonMonthValue, true) }}</strong>
            <small>{{ dealCount(summary.wonMonthCount) }}</small>
          </div>
        </div>
        <v-tabs
          v-model="tab"
          color="primary"
          density="compact"
          class="sales-tabs"
        >
          <v-tab
            value="pipeline"
            prepend-icon="mdi-chart-timeline-variant"
            >{{ messages.tabPipeline }}</v-tab
          >
          <v-tab
            value="accounts"
            prepend-icon="mdi-domain"
            >{{ messages.tabAccounts }}</v-tab
          >
        </v-tabs>
        <div class="sales-toolbar">
          <v-text-field
            ref="searchField"
            v-model="search"
            class="sales-search"
            :placeholder="tab === 'pipeline' ? messages.searchDeals : messages.searchAccounts"
            :aria-label="tab === 'pipeline' ? messages.searchDeals : messages.searchAccounts"
            prepend-inner-icon="mdi-magnify"
            single-line
            clearable
            maxlength="150"
          />
          <FilterGroup
            :count="filterCount"
            @reset="resetFilterGroup"
          >
            <template v-if="tab === 'pipeline'">
              <v-select
                v-model="stage"
                :items="stageItems"
                :label="messages.stage"
              />
              <v-select
                v-model="followUp"
                :items="followUpItems"
                :label="messages.followUp"
              />
            </template>
            <template v-else>
              <v-select
                v-model="accountType"
                :items="typeItems"
                :label="messages.accountType"
              />
              <v-select
                v-model="accountStatus"
                :items="statusItems"
                :label="messages.status"
              />
            </template>
            <v-select
              v-if="hotelScope.length > 1"
              v-model="departmentId"
              :items="departmentItems"
              :label="messages.department"
            />
          </FilterGroup>
        </div>
      </template>
      <template #empty-action>
        <v-btn
          v-if="hasFilters"
          variant="text"
          color="primary"
          @click="resetFilters"
          >{{ messages.reset }}</v-btn
        ><v-btn
          v-else-if="canWriteAny"
          variant="tonal"
          color="primary"
          prepend-icon="mdi-plus"
          @click="tab === 'pipeline' ? openDealForm() : openAccountForm()"
          >{{ tab === 'pipeline' ? messages.addDeal : messages.addAccount }}</v-btn
        >
      </template>

      <ul
        v-if="tab === 'pipeline'"
        class="sales-list"
      >
        <li
          v-for="deal in deals"
          :key="deal.id"
          class="sales-row"
        >
          <div class="sales-identity">
            <span
              class="sales-stage"
              :class="'sales-stage--' + deal.stage"
              >{{ messages[stageKeys[deal.stage]] }}</span
            >
            <div>
              <strong>{{ deal.title }}</strong>
              <button
                type="button"
                class="sales-link"
                :aria-label="messages.viewAccount + ' — ' + deal.accountName"
                @click="openAccount(deal.accountId)"
              >
                {{ deal.accountName }}
              </button>
              <small>
                {{ formatMoney(deal.value) }} · {{ messages[segmentKeys[deal.segment]] }}
                <template v-if="deal.arrivalDate">
                  · {{ formatStay(deal.arrivalDate, deal.departureDate) }}</template
                >
                <template v-if="deal.roomNights">
                  · {{ deal.roomNights }} {{ messages.roomNightsUnit }}</template
                >
                <template v-if="hotelScope.length > 1"> · {{ deal.departmentName }}</template>
              </small>
              <small
                v-if="deal.stage === 'lost' && deal.lostReason"
                class="sales-lost-reason"
                >{{ messages.lostReason }}: {{ deal.lostReason }}</small
              >
            </div>
          </div>
          <div class="sales-actions">
            <span
              v-if="isOpenStage(deal) && deal.nextFollowUp"
              class="sales-follow-up"
              :class="'sales-follow-up--' + followUpState(deal.nextFollowUp, today)"
              ><v-icon
                :icon="
                  followUpState(deal.nextFollowUp, today) === 'overdue'
                    ? 'mdi-alert-circle-outline'
                    : 'mdi-calendar-clock-outline'
                "
                size="15"
              /><span class="sr-only">{{ messages.nextFollowUp }}: </span
              >{{ followUpLabel(deal) }}</span
            ><span
              v-else-if="deal.closedAt"
              class="sales-follow-up"
              >{{ messages.closedOn }} {{ formatDay(hotelToday(new Date(deal.closedAt))) }}</span
            ><v-btn
              v-if="can(deal.departmentId, 'canWrite')"
              color="primary"
              variant="tonal"
              prepend-icon="mdi-plus"
              :aria-label="messages.logActivity + ' — ' + deal.title"
              @click="
                openActivityForm({ id: deal.accountId, name: deal.accountName }, [deal], deal.id)
              "
              >{{ messages.logActivity }}</v-btn
            ><v-menu
              ><template #activator="{ props: menu }"
                ><v-btn
                  v-bind="menu"
                  icon="mdi-dots-vertical"
                  variant="text"
                  :aria-label="messages.moreActions + ' — ' + deal.title" /></template
              ><v-list density="compact"
                ><v-list-item
                  v-if="can(deal.departmentId, 'canWrite')"
                  prepend-icon="mdi-pencil-outline"
                  :title="messages.editDeal"
                  @click="openDealForm(deal)" /><v-list-item
                  prepend-icon="mdi-domain"
                  :title="messages.viewAccount"
                  @click="openAccount(deal.accountId)" /></v-list
            ></v-menu>
          </div>
        </li>
      </ul>
      <ul
        v-else
        class="sales-list"
      >
        <li
          v-for="account in accounts"
          :key="account.id"
          class="sales-row"
          :class="{ 'sales-row--archived': account.status === 'archived' }"
        >
          <div class="sales-identity">
            <v-icon
              :icon="accountTypeIcons[account.type]"
              size="22"
              class="sales-type-icon"
            />
            <div>
              <strong>{{ account.name }}</strong>
              <span
                v-if="account.contactName || account.contactPhone"
                class="sales-contact-line"
                >{{ [account.contactName, account.contactPhone].filter(Boolean).join(' · ') }}</span
              >
              <small>
                <span class="sales-chip">{{ messages[accountTypeKeys[account.type]] }}</span>
                {{ account.openDeals }} {{ messages.openDeals.toLowerCase() }}
                <template v-if="account.openValue">
                  · {{ formatMoney(account.openValue) }}</template
                >
                <template v-if="account.lastActivityOn">
                  · {{ messages.lastActivity }} {{ formatDay(account.lastActivityOn) }}</template
                >
                <template v-if="hotelScope.length > 1"> · {{ account.departmentName }}</template>
              </small>
            </div>
          </div>
          <div class="sales-actions">
            <span
              v-if="account.nextFollowUp"
              class="sales-follow-up"
              :class="'sales-follow-up--' + followUpState(account.nextFollowUp, today)"
              ><v-icon
                icon="mdi-calendar-clock-outline"
                size="15"
              /><span class="sr-only">{{ messages.nextFollowUp }}: </span
              >{{ formatDay(account.nextFollowUp) }}</span
            ><v-btn
              color="primary"
              variant="tonal"
              append-icon="mdi-chevron-right"
              :aria-label="messages.viewAccount + ' — ' + account.name"
              @click="openAccount(account.id)"
              >{{ messages.viewAccount }}</v-btn
            >
          </div>
        </li>
      </ul>
      <v-btn
        v-if="nextCursor"
        variant="text"
        color="primary"
        class="mt-3"
        :loading="loadingMore"
        @click="load(nextCursor)"
        >{{ messages.loadMore }}</v-btn
      >
    </ModulePage>

    <AccountForm
      v-model="accountFormOpen"
      :account="editingAccount"
      :departments="writableDepartments"
      :save="saveAccount"
    />
    <DealForm
      v-model="dealFormOpen"
      :deal="editingDeal"
      :accounts="accountOptions"
      :account-id="dealAccountId"
      :save="saveDeal"
      @search="onAccountSearch"
    />
    <ActivityForm
      v-model="activityFormOpen"
      :account-name="activityAccount?.name ?? ''"
      :deals="activityDeals"
      :deal-id="activityDealId"
      :save="saveActivity"
    />
    <AccountDetail
      v-model="detailOpen"
      :account="detailAccount"
      :can-write="!!detailAccount && can(detailAccount.departmentId, 'canWrite')"
      :can-manage="!!detailAccount && can(detailAccount.departmentId, 'canManage')"
      :refresh-key="refreshKey"
      :load-deals="loadAccountDeals"
      :load-activities="loadActivities"
      @edit="openAccountForm(detailAccount)"
      @archive="requestArchive"
      @add-deal="openDealForm(null, detailAccount)"
      @edit-deal="(deal: Deal) => openDealForm(deal)"
      @log="(list: Deal[]) => detailAccount && openActivityForm(detailAccount, list, null)"
    />
    <ModuleDialog
      v-model="archiveConfirmOpen"
      :title="messages.archiveConfirmTitle"
      :subtitle="detailAccount?.name ?? ''"
      :busy="archiving"
      :width="460"
    >
      <p>{{ messages.archiveConfirmText }}</p>
      <template #actions>
        <v-btn
          variant="text"
          :disabled="archiving"
          @click="archiveConfirmOpen = false"
          >{{ messages.cancel }}</v-btn
        ><v-btn
          color="primary"
          :loading="archiving"
          @click="setArchived(true)"
          >{{ messages.archive }}</v-btn
        >
      </template>
    </ModuleDialog>
    <KeyboardShortcuts
      v-model="shortcutsOpen"
      :rows="shortcutRows"
    />
    <v-snackbar
      :model-value="!!notice"
      timeout="3000"
      @update:model-value="notice = ''"
      >{{ notice }}</v-snackbar
    >
  </div>
</template>
