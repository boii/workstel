import { ModuleRequestError } from '../../core/module-rpc';
import type { SalesCrmApi } from './api';
import { openStages } from './types';
import type { Activity, Deal, SalesAccount, SalesSummary, Stage } from './types';
import { addDays, hotelToday, isEmail, isPhone } from './validation';

export const demoHotelId = 'demo-hotel';
export const demoDepartments = [{ id: 'sales', name: 'Sales & Marketing' }];
const isOpen = (stage: Stage) => (openStages as readonly string[]).includes(stage);

/** In-memory demo CRM that mirrors the server rules; it resets on reload. */
export function createDemoSalesCrmApi(today = hotelToday()): SalesCrmApi {
  const now = new Date().toISOString();
  const department = demoDepartments[0];
  const accounts: SalesAccount[] = (
    [
      ['PT Nusantara Energi', 'corporate', 'Rina Wijaya', '+62 812-1100-2200', 'rina@example.com'],
      ['Sinar Tour & Travel', 'travel-agent', 'Agus Santoso', '+62 813-4455-6677', ''],
      ['Dinas Pariwisata Provinsi', 'government', 'Dewi Lestari', '', 'dewi@example.com'],
      ['Bintang Wedding Organizer', 'wedding', 'Maya Putri', '+62 811-9988-7766', ''],
    ] as const
  ).map(([name, type, contactName, contactPhone, contactEmail], index) => ({
    id: 'demo-account-' + (index + 1),
    hotelId: demoHotelId,
    departmentId: department.id,
    departmentName: department.name,
    name,
    type,
    contactName,
    contactPhone,
    contactEmail,
    notes: '',
    status: 'active',
    version: 1,
    updatedAt: now,
    openDeals: 0,
    openValue: 0,
    nextFollowUp: null,
    lastActivityOn: null,
  }));
  const deals: Deal[] = (
    [
      [0, 'Annual leadership meeting', 'mice', 'proposal', 185000000, 240, 40, -2],
      [0, 'Corporate rate 2027', 'corporate', 'negotiation', 320000000, 1200, null, 0],
      [1, 'Group series December', 'group', 'lead', 96000000, 160, 35, 4],
      [2, 'Regional tourism forum', 'mice', 'won', 145000000, 180, 20, null],
      [3, 'Garden wedding package', 'wedding', 'lead', 75000000, 30, 90, 10],
    ] as const
  ).map(([account, title, segment, stage, value, roomNights, arrivalIn, followUpIn], index) => ({
    id: 'demo-deal-' + (index + 1),
    hotelId: demoHotelId,
    departmentId: department.id,
    departmentName: department.name,
    accountId: accounts[account].id,
    accountName: accounts[account].name,
    title,
    segment,
    stage,
    value,
    roomNights,
    arrivalDate: arrivalIn === null ? null : addDays(today, arrivalIn),
    departureDate: arrivalIn === null ? null : addDays(today, arrivalIn + 2),
    nextFollowUp: followUpIn === null ? null : addDays(today, followUpIn),
    lostReason: '',
    notes: '',
    closedAt: stage === 'won' ? now : null,
    version: 1,
    updatedAt: now,
  }));
  const activities: Activity[] = [
    {
      id: 'demo-activity-1',
      accountId: accounts[0].id,
      dealId: deals[0].id,
      dealTitle: deals[0].title,
      type: 'site-inspection',
      occurredOn: addDays(today, -6),
      summary: 'Ballroom and breakout rooms viewed with the event committee.',
      createdAt: now,
      createdByEmail: 'sales@example.com',
    },
    {
      id: 'demo-activity-2',
      accountId: accounts[0].id,
      dealId: deals[0].id,
      dealTitle: deals[0].title,
      type: 'email',
      occurredOn: addDays(today, -4),
      summary: 'Proposal sent with room block and meeting package.',
      createdAt: now,
      createdByEmail: 'sales@example.com',
    },
  ];
  const keys = new Set<string>();
  const account = (id: string) => {
    const found = accounts.find((entry) => entry.id === id);
    if (!found) throw new ModuleRequestError('ACCESS_DENIED');
    return found;
  };
  const withTotals = (entry: SalesAccount): SalesAccount => {
    const open = deals.filter((d) => d.accountId === entry.id && isOpen(d.stage));
    const followUps = open.map((d) => d.nextFollowUp).filter((d): d is string => !!d);
    const days = activities.filter((a) => a.accountId === entry.id).map((a) => a.occurredOn);
    return {
      ...entry,
      openDeals: open.length,
      openValue: open.reduce((sum, d) => sum + d.value, 0),
      nextFollowUp: followUps.sort()[0] ?? null,
      lastActivityOn: days.sort().at(-1) ?? null,
    };
  };
  const listedDeals = () => deals.filter((d) => account(d.accountId).status === 'active');
  return {
    async summary() {
      const live = listedDeals();
      const open = live.filter((d) => isOpen(d.stage));
      const month = today.slice(0, 7);
      const won = live.filter(
        (d) => d.stage === 'won' && hotelToday(new Date(d.closedAt!)).startsWith(month),
      );
      const stage = (name: Stage) => {
        const rows = live.filter((d) => d.stage === name);
        return { count: rows.length, value: rows.reduce((sum, d) => sum + d.value, 0) };
      };
      const summary: SalesSummary = {
        openCount: open.length,
        openValue: open.reduce((sum, d) => sum + d.value, 0),
        overdue: open.filter((d) => d.nextFollowUp && d.nextFollowUp < today).length,
        dueWeek: open.filter(
          (d) => d.nextFollowUp && d.nextFollowUp >= today && d.nextFollowUp <= addDays(today, 6),
        ).length,
        wonMonthCount: won.length,
        wonMonthValue: won.reduce((sum, d) => sum + d.value, 0),
        stages: {
          lead: stage('lead'),
          proposal: stage('proposal'),
          negotiation: stage('negotiation'),
        },
        today,
      };
      return summary;
    },
    async listAccounts(query) {
      const search = query.search.trim().toLowerCase();
      const data = accounts
        .filter(
          (a) =>
            (query.status === 'all' || a.status === query.status) &&
            (!query.type || a.type === query.type) &&
            (!search ||
              (a.name + ' ' + a.contactName + ' ' + a.contactEmail).toLowerCase().includes(search)),
        )
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(withTotals);
      return { data, nextCursor: null };
    },
    async saveAccount(_hotelId, input, existing) {
      const phone = input.contactPhone.trim();
      const email = input.contactEmail.trim().toLowerCase();
      if (phone && !isPhone(phone)) throw new ModuleRequestError('INVALID_PHONE');
      if (email && !isEmail(email)) throw new ModuleRequestError('INVALID_EMAIL');
      const fields = {
        name: input.name.trim(),
        type: input.type,
        contactName: input.contactName.trim(),
        contactPhone: phone,
        contactEmail: email,
        notes: input.notes.trim(),
        updatedAt: new Date().toISOString(),
      };
      if (!existing) {
        accounts.push({
          ...fields,
          id: crypto.randomUUID(),
          hotelId: demoHotelId,
          departmentId: department.id,
          departmentName: department.name,
          status: 'active',
          version: 1,
          openDeals: 0,
          openValue: 0,
          nextFollowUp: null,
          lastActivityOn: null,
        });
        return;
      }
      const target = account(existing.id);
      if (target.version !== existing.version) throw new ModuleRequestError('VERSION_CONFLICT');
      Object.assign(target, fields, { version: target.version + 1 });
      for (const deal of deals) if (deal.accountId === target.id) deal.accountName = target.name;
    },
    async setAccountArchived(_hotelId, entry, archived) {
      const target = account(entry.id);
      if (target.version !== entry.version) throw new ModuleRequestError('VERSION_CONFLICT');
      Object.assign(target, {
        status: archived ? 'archived' : 'active',
        version: target.version + 1,
      });
    },
    async listDeals(query) {
      const search = query.search.trim().toLowerCase();
      const weekEnd = addDays(today, 6);
      const data = (
        query.accountId ? deals.filter((d) => d.accountId === query.accountId) : listedDeals()
      )
        .filter(
          (d) =>
            (query.stage === 'all' ||
              d.stage === query.stage ||
              (query.stage === 'open' && isOpen(d.stage))) &&
            (query.followUp === 'any' ||
              (isOpen(d.stage) &&
                !!d.nextFollowUp &&
                (query.followUp === 'overdue'
                  ? d.nextFollowUp < today
                  : d.nextFollowUp >= today && d.nextFollowUp <= weekEnd))) &&
            (!search || (d.title + ' ' + d.accountName).toLowerCase().includes(search)),
        )
        .sort(
          (a, b) =>
            (a.nextFollowUp ?? '9999-12-31').localeCompare(b.nextFollowUp ?? '9999-12-31') ||
            a.title.localeCompare(b.title),
        )
        .map((d) => ({ ...d }));
      return { data, nextCursor: null };
    },
    async saveDeal(_hotelId, input, existing) {
      const owner = account(input.accountId);
      if (input.stage === 'lost' && !input.lostReason.trim())
        throw new ModuleRequestError('LOST_REASON_REQUIRED');
      const closed = !isOpen(input.stage);
      const fields = {
        title: input.title.trim(),
        segment: input.segment,
        stage: input.stage,
        value: input.value ?? 0,
        roomNights: input.roomNights,
        arrivalDate: input.arrivalDate,
        departureDate: input.departureDate,
        nextFollowUp: closed ? null : input.nextFollowUp,
        lostReason: input.stage === 'lost' ? input.lostReason.trim() : '',
        notes: input.notes.trim(),
        updatedAt: new Date().toISOString(),
      };
      if (!existing) {
        if (owner.status !== 'active') throw new ModuleRequestError('ACCOUNT_ARCHIVED');
        deals.push({
          ...fields,
          id: crypto.randomUUID(),
          hotelId: demoHotelId,
          departmentId: owner.departmentId,
          departmentName: owner.departmentName,
          accountId: owner.id,
          accountName: owner.name,
          closedAt: closed ? fields.updatedAt : null,
          version: 1,
        });
        return;
      }
      const target = deals.find((d) => d.id === existing.id);
      if (!target || target.accountId !== owner.id) throw new ModuleRequestError('ACCESS_DENIED');
      if (target.version !== existing.version) throw new ModuleRequestError('VERSION_CONFLICT');
      const closedAt = !closed
        ? null
        : target.stage === input.stage
          ? target.closedAt
          : fields.updatedAt;
      Object.assign(target, fields, { closedAt, version: target.version + 1 });
    },
    async listActivities(_hotelId, accountId, dealId) {
      account(accountId);
      const data = activities
        .filter((a) => a.accountId === accountId && (!dealId || a.dealId === dealId))
        .sort(
          (a, b) =>
            b.occurredOn.localeCompare(a.occurredOn) || b.createdAt.localeCompare(a.createdAt),
        )
        .map((a) => ({ ...a }));
      return { data, nextCursor: null };
    },
    async logActivity(_hotelId, accountId, input, idempotencyKey) {
      if (keys.has(idempotencyKey)) return;
      const owner = account(accountId);
      if (owner.status !== 'active') throw new ModuleRequestError('ACCOUNT_ARCHIVED');
      const deal = input.dealId ? deals.find((d) => d.id === input.dealId) : undefined;
      if (input.dealId && deal?.accountId !== accountId)
        throw new ModuleRequestError('INVALID_INPUT');
      if (input.nextFollowUp) {
        if (!deal) throw new ModuleRequestError('INVALID_INPUT');
        if (!isOpen(deal.stage)) throw new ModuleRequestError('DEAL_CLOSED');
        Object.assign(deal, { nextFollowUp: input.nextFollowUp, version: deal.version + 1 });
      }
      keys.add(idempotencyKey);
      activities.push({
        id: crypto.randomUUID(),
        accountId,
        dealId: deal?.id ?? null,
        dealTitle: deal?.title ?? '',
        type: input.type,
        occurredOn: input.occurredOn,
        summary: input.summary.trim(),
        createdAt: new Date().toISOString(),
        createdByEmail: 'demo@example.com',
      });
    },
  };
}
