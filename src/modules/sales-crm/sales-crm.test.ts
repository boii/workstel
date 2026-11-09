import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ModuleRequestError } from '../../core/module-rpc';
import { createDemoSalesCrmApi } from './demo-api';
import { parseAccounts, parseActivities, parseDeals, parseSummary } from './live-api';
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
  assert.equal(
    validateActivity(
      { type: 'call', occurredOn: '2026-11-05', summary: 'x', dealId: null, nextFollowUp: null },
      '2026-11-04',
    ).occurredOn,
    'futureDate',
  );
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
    },
    'key-1',
  );
  const activities = await api.listActivities('demo-hotel', target.accountId, null, null);
  const called = activities.data.filter((a) => a.summary === 'Called');
  assert.equal(called.length, 1);
  assert.equal(called[0].entryTiming, 'on-time');
  assert.ok(activities.data.some((a) => a.entryTiming === 'backdated'));
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
