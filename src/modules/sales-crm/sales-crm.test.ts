import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModuleRequestError } from '../../core/module-rpc';
import { createDemoSalesCrmApi } from './demo-api';
import {
  parseAccounts,
  parseActivities,
  parseDeals,
  parseEntryReport,
  parseSummary,
} from './live-api';
import type { DealInput } from './types';
import {
  entryDelayDays,
  entryTiming,
  followUpState,
  isCalendarDate,
  validateAccount,
  validateActivity,
  validateDeal,
} from './validation';

const hotel = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const accountId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const deal = {
  id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  hotel_id: hotel,
  department_id: 'd',
  department_name: 'Sales & Marketing',
  account_id: accountId,
  account_name: 'PT Maju Jaya',
  title: 'Annual meeting',
  segment: 'mice',
  stage: 'proposal',
  value_amount: 85000000,
  room_nights: 120,
  arrival_date: '2026-12-12',
  departure_date: '2026-12-14',
  next_follow_up: '2026-11-08',
  lost_reason: '',
  notes: '',
  closed_at: null,
  version: 1,
  updated_at: '2026-11-04T01:00:00Z',
};
const dealInput: DealInput = {
  accountId,
  title: 'Annual meeting',
  segment: 'mice',
  stage: 'lead',
  value: 1000,
  roomNights: null,
  arrivalDate: null,
  departureDate: null,
  nextFollowUp: null,
  lostReason: '',
  notes: '',
};

test('form rules match the server', () => {
  assert.equal(isCalendarDate('2026-02-29'), false);
  assert.equal(isCalendarDate('2028-02-29'), true);
  assert.deepEqual(
    validateAccount({
      name: ' ',
      type: 'corporate',
      contactName: '',
      contactPhone: 'call me',
      contactEmail: 'nope',
      notes: '',
      departmentId: 'd',
    }),
    { name: 'required', contactPhone: 'invalidPhone', contactEmail: 'invalidEmail' },
  );
  assert.deepEqual(validateDeal(dealInput), {});
  assert.deepEqual(validateDeal({ ...dealInput, value: 1.5, departureDate: '2026-12-01' }), {
    value: 'invalidAmount',
    arrivalDate: 'required',
  });
  assert.equal(
    validateDeal({ ...dealInput, arrivalDate: '2026-12-02', departureDate: '2026-12-01' })
      .departureDate,
    'departureBeforeArrival',
  );
  assert.equal(validateDeal({ ...dealInput, stage: 'lost' }).lostReason, 'required');
  const activityInput = {
    type: 'call' as const,
    occurredOn: '2026-11-04',
    summary: 'x',
    dealId: null,
    nextFollowUp: null,
    outcome: null,
    metWith: '',
    reference: '',
  };
  assert.equal(
    validateActivity({ ...activityInput, occurredOn: '2026-11-05' }, '2026-11-04').occurredOn,
    'futureDate',
  );
  // Face-to-face activities need an outcome; calls, emails and notes do not.
  assert.deepEqual(validateActivity(activityInput, '2026-11-04'), {});
  for (const type of ['visit', 'meeting', 'site-inspection'] as const)
    assert.equal(validateActivity({ ...activityInput, type }, '2026-11-04').outcome, 'required');
  assert.deepEqual(
    validateActivity({ ...activityInput, type: 'visit', outcome: 'tentative' }, '2026-11-04'),
    {},
  );
  const tooLong = validateActivity(
    { ...activityInput, metWith: 'x'.repeat(101), reference: 'y'.repeat(101) },
    '2026-11-04',
  );
  assert.deepEqual([tooLong.metWith, tooLong.reference], ['tooLong', 'tooLong']);
});

test('responses are validated before they are shown', () => {
  assert.equal(parseDeals([deal], hotel)[0].value, 85000000);
  for (const broken of [
    { stage: 'paid' },
    { value_amount: -5 },
    { arrival_date: '2026-13-01' },
    { hotel_id: 'other' },
    { account_id: 'not-a-uuid' },
  ])
    assert.throws(() => parseDeals([{ ...deal, ...broken }], hotel), ModuleRequestError);
  assert.throws(
    () =>
      parseAccounts(
        [
          {
            id: accountId,
            hotel_id: hotel,
            department_id: 'd',
            department_name: 'Sales',
            name: 'X',
            account_type: 'friend',
            contact_name: '',
            contact_phone: '',
            contact_email: '',
            notes: '',
            status: 'active',
            version: 1,
            updated_at: '2026-11-04T01:00:00Z',
            open_deals: 0,
            open_value: 0,
            next_follow_up: null,
            last_activity_on: null,
          },
        ],
        hotel,
      ),
    ModuleRequestError,
  );
  assert.throws(
    () => parseActivities([{ id: deal.id, account_id: 'other' }], accountId),
    ModuleRequestError,
  );
  assert.throws(() => parseSummary({ open_count: 1 }, { today: '2026-11-04' }), ModuleRequestError);
});

test('activity rows carry the server entry timing', () => {
  const row = {
    id: deal.id,
    account_id: accountId,
    deal_id: null,
    deal_title: null,
    activity_type: 'visit',
    occurred_on: '2026-11-01',
    summary: 'Office visit',
    created_at: '2026-11-04T03:00:00Z',
    created_by_email: 'sales@example.com',
    recorded_on: '2026-11-04',
    entry_delay_days: 3,
    entry_timing: 'backdated',
  };
  const [activity] = parseActivities([row], accountId);
  // A server before migration 202611090002 sends no name.
  assert.equal(activity.createdByName, '');
  assert.equal(
    parseActivities([{ ...row, created_by_name: 'Rina Wijaya' }], accountId)[0].createdByName,
    'Rina Wijaya',
  );
  assert.throws(
    () => parseActivities([{ ...row, created_by_name: 7 }], accountId),
    ModuleRequestError,
  );
  // Servers before migration 202611090004 send no outcome fields.
  assert.deepEqual([activity.outcome, activity.metWith, activity.reference], [null, '', '']);
  const withOutcome = parseActivities(
    [{ ...row, outcome: 'tentative', met_with: 'Budi', reference: 'PRO-1' }],
    accountId,
  )[0];
  assert.deepEqual(
    [withOutcome.outcome, withOutcome.metWith, withOutcome.reference],
    ['tentative', 'Budi', 'PRO-1'],
  );
  for (const broken of [{ outcome: 'negotiating' }, { met_with: 1 }, { reference: null }])
    assert.throws(() => parseActivities([{ ...row, ...broken }], accountId), ModuleRequestError);
  assert.equal(activity.recordedOn, '2026-11-04');
  assert.equal(activity.entryDelayDays, 3);
  assert.equal(activity.entryTiming, 'backdated');
  for (const broken of [
    { entry_timing: undefined },
    { entry_timing: 'early' },
    { entry_delay_days: -1 },
    { entry_delay_days: 1.5 },
    { recorded_on: '2026-02-30' },
  ])
    assert.throws(() => parseActivities([{ ...row, ...broken }], accountId), ModuleRequestError);
});

test('entry reports are validated before they are shown', () => {
  const counts = { total: 3, on_time: 1, late: 1, backdated: 1 };
  const entry = {
    id: deal.id,
    account_id: accountId,
    account_name: 'PT Maju Jaya',
    activity_type: 'visit',
    occurred_on: '2026-11-01',
    recorded_on: '2026-11-05',
    created_at: '2026-11-05T03:00:00Z',
    entry_delay_days: 4,
    entry_timing: 'backdated',
    created_by_email: 'rina@example.com',
    created_by_name: 'Rina Wijaya',
  };
  const data = {
    totals: counts,
    people: [{ ...counts, email: 'rina@example.com', name: 'Rina Wijaya' }],
    entries: [entry],
  };
  const meta = { month: '2026-11', entriesTotal: 2 };
  const report = parseEntryReport(data, meta);
  assert.deepEqual(report.totals, { total: 3, onTime: 1, late: 1, backdated: 1 });
  assert.equal(report.people[0].name, 'Rina Wijaya');
  assert.equal(report.entries[0].entryTiming, 'backdated');
  assert.equal(report.entriesTotal, 2);
  // Without outcomes (older servers) every count is zero; with them they are validated.
  assert.equal(report.outcomes.booked, 0);
  assert.equal(parseEntryReport({ ...data, outcomes: { booked: 2 } }, meta).outcomes.booked, 2);
  assert.throws(
    () => parseEntryReport({ ...data, outcomes: { booked: -1 } }, meta),
    ModuleRequestError,
  );
  for (const [brokenData, brokenMeta] of [
    [{ ...data, entries: [{ ...entry, entry_timing: 'on-time' }] }, meta],
    [{ ...data, people: [{ ...counts, email: 'x' }] }, meta],
    [{ ...data, totals: { ...counts, late: -1 } }, meta],
    [data, { ...meta, month: '2026-13' }],
    [data, { month: '2026-11' }],
  ] as const)
    assert.throws(() => parseEntryReport(brokenData, brokenMeta), ModuleRequestError);
});

test('entry timing thresholds match the server', () => {
  assert.equal(entryDelayDays('2026-11-04', '2026-11-04'), 0);
  assert.equal(entryDelayDays('2026-10-30', '2026-11-04'), 5);
  assert.equal(entryDelayDays('2026-11-05', '2026-11-04'), 0);
  assert.deepEqual([0, 1, 2, 3, 30].map(entryTiming), [
    'on-time',
    'late',
    'late',
    'backdated',
    'backdated',
  ]);
});

test('follow-up states use the hotel calendar day', () => {
  assert.equal(followUpState('2026-11-03', '2026-11-04'), 'overdue');
  assert.equal(followUpState('2026-11-04', '2026-11-04'), 'today');
  assert.equal(followUpState('2026-11-10', '2026-11-04'), 'soon');
  assert.equal(followUpState('2026-11-11', '2026-11-04'), 'later');
  assert.equal(followUpState(null, '2026-11-04'), 'none');
});

test('demo CRM keeps the pipeline, follow-ups and archiving consistent', async () => {
  const today = '2026-11-04';
  const api = createDemoSalesCrmApi(today);
  const query = {
    hotelId: 'demo-hotel',
    departmentId: null,
    stage: 'open' as const,
    accountId: null,
    followUp: 'any' as const,
    search: '',
    after: null,
  };
  const open = (await api.listDeals(query)).data;
  assert.equal(open.length, 4);
  assert.equal((await api.listDeals({ ...query, followUp: 'overdue' })).data.length, 1);
  const summary = await api.summary('demo-hotel', null);
  assert.equal(summary.openCount, 4);
  assert.equal(summary.overdue, 1);
  const target = open[0];
  await api.logActivity(
    'demo-hotel',
    target.accountId,
    {
      type: 'call',
      occurredOn: today,
      summary: 'Called',
      dealId: target.id,
      nextFollowUp: '2026-11-20',
      outcome: 'proposal-sent',
      metWith: ' Rina ',
      reference: '',
    },
    'key-1',
  );
  await api.logActivity(
    'demo-hotel',
    target.accountId,
    {
      type: 'call',
      occurredOn: today,
      summary: 'Called',
      dealId: target.id,
      nextFollowUp: '2026-11-20',
      outcome: 'proposal-sent',
      metWith: ' Rina ',
      reference: '',
    },
    'key-1',
  );
  const activities = await api.listActivities('demo-hotel', target.accountId, null, null);
  const called = activities.data.filter((a) => a.summary === 'Called');
  assert.equal(called.length, 1);
  assert.equal(called[0].entryTiming, 'on-time');
  assert.ok(activities.data.some((a) => a.entryTiming === 'backdated'));
  assert.deepEqual([called[0].outcome, called[0].metWith], ['proposal-sent', 'Rina']);
  await assert.rejects(
    api.logActivity(
      'demo-hotel',
      target.accountId,
      {
        type: 'visit',
        occurredOn: today,
        summary: 'No outcome',
        dealId: null,
        nextFollowUp: null,
        outcome: null,
        metWith: '',
        reference: '',
      },
      'key-2',
    ),
    ModuleRequestError,
  );
  const report = await api.entryReport('demo-hotel', null, today.slice(0, 7));
  assert.ok(report.outcomes['proposal-sent'] >= 1);
  assert.equal(
    report.totals.total,
    report.totals.onTime + report.totals.late + report.totals.backdated,
  );
  assert.equal(
    report.people.reduce((sum, p) => sum + p.total, 0),
    report.totals.total,
  );
  assert.ok(report.entries.every((e) => e.entryTiming !== ('on-time' as string)));
  await assert.rejects(api.entryReport('demo-hotel', null, '2099-01'), ModuleRequestError);
  assert.equal((await api.summary('demo-hotel', null)).overdue, 0);
  await assert.rejects(
    api.saveDeal('demo-hotel', { ...dealInput, accountId: target.accountId, stage: 'lost' }),
    (error: unknown) =>
      error instanceof ModuleRequestError && error.code === 'LOST_REASON_REQUIRED',
  );
  const [account] = (
    await api.listAccounts({
      hotelId: 'demo-hotel',
      departmentId: null,
      status: 'active',
      type: null,
      search: target.accountName,
      after: null,
    })
  ).data;
  await api.setAccountArchived('demo-hotel', account, true);
  assert.ok((await api.listDeals(query)).data.every((d) => d.accountId !== account.id));
});
