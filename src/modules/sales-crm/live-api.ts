import { ModuleRequestError, moduleRpc, parseCursor, uuidPattern } from '../../core/module-rpc';
import type { SalesCrmApi } from './api';
import { accountTypes, activityTypes, entryTimings, openStages, segments, stages } from './types';
import type { Activity, Deal, EntryCounts, EntryReport, SalesAccount, SalesSummary } from './types';
import { isCalendarDate } from './validation';

type Rpc = typeof moduleRpc;
type Raw = Record<string, unknown>;
const invalid = () => new ModuleRequestError('INVALID_RESPONSE');
const isText = (value: unknown): value is string => typeof value === 'string';
const isTime = (value: unknown): value is string =>
  isText(value) && !Number.isNaN(Date.parse(value));
const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
const isDay = (value: unknown) => value === null || (isText(value) && isCalendarDate(value));
const allText = (raw: Raw, keys: string[]) => keys.every((key) => isText(raw[key]));

export function parseSummary(data: unknown, meta: Raw | undefined): SalesSummary {
  const raw = data as Raw | null;
  const stageTotals = raw?.stages as Record<string, Raw> | undefined;
  if (
    !raw ||
    ![
      'open_count',
      'open_value',
      'overdue',
      'due_week',
      'won_month_count',
      'won_month_value',
    ].every((key) => isCount(raw[key])) ||
    !stageTotals ||
    !openStages.every(
      (stage) => isCount(stageTotals[stage]?.count) && isCount(stageTotals[stage]?.value),
    ) ||
    !isText(meta?.today) ||
    !isCalendarDate(meta.today)
  )
    throw invalid();
  const total = (stage: string) => ({
    count: Number(stageTotals[stage].count),
    value: Number(stageTotals[stage].value),
  });
  return {
    openCount: Number(raw.open_count),
    openValue: Number(raw.open_value),
    overdue: Number(raw.overdue),
    dueWeek: Number(raw.due_week),
    wonMonthCount: Number(raw.won_month_count),
    wonMonthValue: Number(raw.won_month_value),
    stages: { lead: total('lead'), proposal: total('proposal'), negotiation: total('negotiation') },
    today: meta.today,
  };
}

export function parseAccounts(data: unknown, hotelId: string): SalesAccount[] {
  if (!Array.isArray(data) || data.length > 100) throw invalid();
  return data.map((raw: Raw) => {
    if (
      !raw ||
      !allText(raw, [
        'id',
        'hotel_id',
        'department_id',
        'department_name',
        'name',
        'contact_name',
        'contact_phone',
        'contact_email',
        'notes',
      ]) ||
      raw.hotel_id !== hotelId ||
      !uuidPattern.test(String(raw.id)) ||
      !accountTypes.includes(raw.account_type as never) ||
      !['active', 'archived'].includes(String(raw.status)) ||
      !Number.isInteger(raw.version) ||
      !isTime(raw.updated_at) ||
      !isCount(raw.open_deals) ||
      !isCount(raw.open_value) ||
      !isDay(raw.next_follow_up) ||
      !isDay(raw.last_activity_on)
    )
      throw invalid();
    return {
      id: String(raw.id),
      hotelId,
      departmentId: String(raw.department_id),
      departmentName: String(raw.department_name),
      name: String(raw.name),
      type: raw.account_type as SalesAccount['type'],
      contactName: String(raw.contact_name),
      contactPhone: String(raw.contact_phone),
      contactEmail: String(raw.contact_email),
      notes: String(raw.notes),
      status: raw.status as SalesAccount['status'],
      version: Number(raw.version),
      updatedAt: String(raw.updated_at),
      openDeals: Number(raw.open_deals),
      openValue: Number(raw.open_value),
      nextFollowUp: (raw.next_follow_up as string | null) ?? null,
      lastActivityOn: (raw.last_activity_on as string | null) ?? null,
    };
  });
}

export function parseDeals(data: unknown, hotelId: string): Deal[] {
  if (!Array.isArray(data) || data.length > 100) throw invalid();
  return data.map((raw: Raw) => {
    if (
      !raw ||
      !allText(raw, [
        'id',
        'hotel_id',
        'department_id',
        'department_name',
        'account_id',
        'account_name',
        'title',
        'lost_reason',
        'notes',
      ]) ||
      raw.hotel_id !== hotelId ||
      !uuidPattern.test(String(raw.id)) ||
      !uuidPattern.test(String(raw.account_id)) ||
      !segments.includes(raw.segment as never) ||
      !stages.includes(raw.stage as never) ||
      !isCount(raw.value_amount) ||
      !(raw.room_nights === null || isCount(raw.room_nights)) ||
      !isDay(raw.arrival_date) ||
      !isDay(raw.departure_date) ||
      !isDay(raw.next_follow_up) ||
      !(raw.closed_at === null || isTime(raw.closed_at)) ||
      !Number.isInteger(raw.version) ||
      !isTime(raw.updated_at)
    )
      throw invalid();
    return {
      id: String(raw.id),
      hotelId,
      departmentId: String(raw.department_id),
      departmentName: String(raw.department_name),
      accountId: String(raw.account_id),
      accountName: String(raw.account_name),
      title: String(raw.title),
      segment: raw.segment as Deal['segment'],
      stage: raw.stage as Deal['stage'],
      value: Number(raw.value_amount),
      roomNights: raw.room_nights === null ? null : Number(raw.room_nights),
      arrivalDate: (raw.arrival_date as string | null) ?? null,
      departureDate: (raw.departure_date as string | null) ?? null,
      nextFollowUp: (raw.next_follow_up as string | null) ?? null,
      lostReason: String(raw.lost_reason),
      notes: String(raw.notes),
      closedAt: (raw.closed_at as string | null) ?? null,
      version: Number(raw.version),
      updatedAt: String(raw.updated_at),
    };
  });
}

export function parseActivities(data: unknown, accountId: string): Activity[] {
  if (!Array.isArray(data) || data.length > 100) throw invalid();
  return data.map((raw: Raw) => {
    if (
      !raw ||
      !isText(raw.id) ||
      !uuidPattern.test(raw.id) ||
      raw.account_id !== accountId ||
      !(raw.deal_id === null || (isText(raw.deal_id) && uuidPattern.test(raw.deal_id))) ||
      !(raw.deal_title === null || isText(raw.deal_title)) ||
      !activityTypes.includes(raw.activity_type as never) ||
      !isText(raw.occurred_on) ||
      !isCalendarDate(raw.occurred_on) ||
      !isText(raw.summary) ||
      !isTime(raw.created_at) ||
      !isText(raw.created_by_email) ||
      !(raw.created_by_name === undefined || isText(raw.created_by_name)) ||
      !isText(raw.recorded_on) ||
      !isCalendarDate(raw.recorded_on) ||
      !Number.isInteger(raw.entry_delay_days) ||
      (raw.entry_delay_days as number) < 0 ||
      !entryTimings.includes(raw.entry_timing as never)
    )
      throw invalid();
    return {
      id: raw.id,
      accountId,
      dealId: (raw.deal_id as string | null) ?? null,
      dealTitle: (raw.deal_title as string | null) ?? '',
      type: raw.activity_type as Activity['type'],
      occurredOn: raw.occurred_on,
      summary: raw.summary,
      createdAt: String(raw.created_at),
      createdByEmail: raw.created_by_email,
      // Servers before migration 202611090002 send no name; the email is shown instead.
      createdByName: (raw.created_by_name as string | undefined) ?? '',
      recordedOn: raw.recorded_on,
      entryDelayDays: raw.entry_delay_days as number,
      entryTiming: raw.entry_timing as Activity['entryTiming'],
    };
  });
}

function parseCounts(raw: Raw | null | undefined): EntryCounts {
  if (!raw || !['total', 'on_time', 'late', 'backdated'].every((key) => isCount(raw[key])))
    throw invalid();
  return {
    total: Number(raw.total),
    onTime: Number(raw.on_time),
    late: Number(raw.late),
    backdated: Number(raw.backdated),
  };
}
export function parseEntryReport(data: unknown, meta: Raw | undefined): EntryReport {
  const raw = data as Raw | null;
  const people = raw?.people;
  const entries = raw?.entries;
  if (
    !raw ||
    !Array.isArray(people) ||
    !Array.isArray(entries) ||
    entries.length > 100 ||
    !isText(meta?.month) ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(meta.month) ||
    !isCount(meta.entriesTotal)
  )
    throw invalid();
  return {
    month: meta.month,
    totals: parseCounts(raw.totals as Raw),
    people: people.map((row: Raw) => {
      if (!row || !isText(row.email) || !isText(row.name)) throw invalid();
      return { ...parseCounts(row), email: row.email, name: row.name };
    }),
    entries: entries.map((row: Raw) => {
      if (
        !row ||
        !isText(row.id) ||
        !uuidPattern.test(row.id) ||
        !isText(row.account_id) ||
        !uuidPattern.test(row.account_id) ||
        !allText(row, ['account_name', 'created_by_email', 'created_by_name']) ||
        !activityTypes.includes(row.activity_type as never) ||
        !isText(row.occurred_on) ||
        !isCalendarDate(row.occurred_on) ||
        !isText(row.recorded_on) ||
        !isCalendarDate(row.recorded_on) ||
        !isCount(row.entry_delay_days) ||
        (row.entry_timing !== 'late' && row.entry_timing !== 'backdated')
      )
        throw invalid();
      return {
        id: row.id,
        accountId: row.account_id,
        accountName: String(row.account_name),
        type: row.activity_type as EntryReport['entries'][number]['type'],
        occurredOn: row.occurred_on,
        recordedOn: row.recorded_on,
        entryDelayDays: row.entry_delay_days,
        entryTiming: row.entry_timing,
        createdByEmail: String(row.created_by_email),
        createdByName: String(row.created_by_name),
      };
    }),
    entriesTotal: Number(meta.entriesTotal),
  };
}

export function createLiveSalesCrmApi(rpc: Rpc = moduleRpc): SalesCrmApi {
  return {
    async entryReport(hotelId, departmentId, month, signal) {
      const result = await rpc(
        'sales_entry_report',
        { p_hotel_id: hotelId, p_department_id: departmentId, p_month: month + '-01' },
        signal,
      );
      return parseEntryReport(result.data, result.meta);
    },
    async summary(hotelId, departmentId, signal) {
      const result = await rpc(
        'sales_summary',
        { p_hotel_id: hotelId, p_department_id: departmentId },
        signal,
      );
      return parseSummary(result.data, result.meta);
    },
    async listAccounts(query, signal) {
      const result = await rpc(
        'sales_accounts_list',
        {
          p_hotel_id: query.hotelId,
          p_department_id: query.departmentId,
          p_status: query.status,
          p_type: query.type,
          p_search: query.search.trim().slice(0, 150),
          p_after: query.after,
          p_limit: 50,
        },
        signal,
      );
      return {
        data: parseAccounts(result.data, query.hotelId),
        nextCursor: parseCursor(result.meta),
      };
    },
    async saveAccount(hotelId, input, existing) {
      await rpc('sales_account_save', {
        p_hotel_id: hotelId,
        p_department_id: input.departmentId,
        p_input: {
          name: input.name.trim(),
          type: input.type,
          contactName: input.contactName.trim(),
          contactPhone: input.contactPhone.trim(),
          contactEmail: input.contactEmail.trim(),
          notes: input.notes.trim(),
        },
        p_account_id: existing?.id ?? null,
        p_expected_version: existing?.version ?? null,
        p_action: 'save',
      });
    },
    async setAccountArchived(hotelId, account, archived) {
      await rpc('sales_account_save', {
        p_hotel_id: hotelId,
        p_department_id: account.departmentId,
        p_input: null,
        p_account_id: account.id,
        p_expected_version: account.version,
        p_action: archived ? 'archive' : 'restore',
      });
    },
    async listDeals(query, signal) {
      const result = await rpc(
        'sales_deals_list',
        {
          p_hotel_id: query.hotelId,
          p_department_id: query.departmentId,
          p_stage: query.stage,
          p_account_id: query.accountId,
          p_follow_up: query.followUp,
          p_search: query.search.trim().slice(0, 150),
          p_after: query.after,
          p_limit: 50,
        },
        signal,
      );
      return {
        data: parseDeals(result.data, query.hotelId),
        nextCursor: parseCursor(result.meta),
      };
    },
    async saveDeal(hotelId, input, existing) {
      await rpc('sales_deal_save', {
        p_hotel_id: hotelId,
        p_input: {
          accountId: input.accountId,
          title: input.title.trim(),
          segment: input.segment,
          stage: input.stage,
          value: input.value ?? 0,
          roomNights: input.roomNights,
          arrivalDate: input.arrivalDate,
          departureDate: input.departureDate,
          nextFollowUp: input.nextFollowUp,
          lostReason: input.lostReason.trim(),
          notes: input.notes.trim(),
        },
        p_deal_id: existing?.id ?? null,
        p_expected_version: existing?.version ?? null,
      });
    },
    async listActivities(hotelId, accountId, dealId, after, signal) {
      const result = await rpc(
        'sales_activities_list',
        {
          p_hotel_id: hotelId,
          p_account_id: accountId,
          p_deal_id: dealId,
          p_after: after,
          p_limit: 30,
        },
        signal,
      );
      return {
        data: parseActivities(result.data, accountId),
        nextCursor: parseCursor(result.meta),
      };
    },
    async logActivity(hotelId, accountId, input, idempotencyKey) {
      await rpc('sales_activity_log', {
        p_hotel_id: hotelId,
        p_account_id: accountId,
        p_deal_id: input.dealId,
        p_input: {
          type: input.type,
          occurredOn: input.occurredOn,
          summary: input.summary.trim(),
          nextFollowUp: input.nextFollowUp,
        },
        p_idempotency_key: idempotencyKey,
      });
    },
  };
}
