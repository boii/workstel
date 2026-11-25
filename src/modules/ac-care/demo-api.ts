import { ModuleRequestError } from '../../core/module-rpc';
import type { AcCareApi } from './api';
import { serviceTypes } from './types';
import type {
  AcUnit,
  AttentionReason,
  HistoryEntry,
  ServiceInput,
  ServiceType,
  UnitInput,
  Work,
} from './types';
import {
  addDays,
  defaultIntervals,
  hotelToday,
  isCode,
  needsPressureAndCurrent,
  needsTemperatures,
  normalizeCode,
  previewReasons,
  serviceItems,
} from './validation';

export const demoHotelId = 'demo-hotel';
export const demoDepartments = [{ id: 'ac-care', name: 'Engineering' }];
const me = 'demo@example.com';
const technicians = [
  { userId: 'demo-user', email: me },
  { userId: 'demo-budi', email: 'budi@example.com' },
  { userId: 'demo-siti', email: 'siti@example.com' },
];
const rank = (type: ServiceType) => serviceTypes.indexOf(type);

interface StoredUnit extends Omit<
  AcUnit,
  'areaMine' | 'complaints60d' | 'refills90d' | 'lastService' | 'schedule'
> {
  createdAt: string;
}
interface StoredWork extends Omit<Work, 'mine' | 'userEmail'> {
  unitId: string;
  type: ServiceType;
  userId: string;
}

/** In-memory demo that mirrors the server rules; it resets on reload. */
export function createDemoAcCareApi(): AcCareApi {
  const department = demoDepartments[0];
  const nowIso = () => new Date().toISOString();
  const daysAgo = (days: number) => new Date(Date.now() - days * 86400000).toISOString();
  const units: StoredUnit[] = [];
  const history = new Map<string, HistoryEntry[]>();
  const work: StoredWork[] = [];
  const members: { area: string; userId: string; backup: boolean }[] = [
    { area: 'Floor 1', userId: 'demo-user', backup: false },
    { area: 'Floor 1', userId: 'demo-budi', backup: true },
    { area: 'Floor 2', userId: 'demo-budi', backup: false },
    { area: 'Floor 2', userId: 'demo-user', backup: true },
    { area: 'Public area', userId: 'demo-siti', backup: false },
  ];
  const keys = new Map<string, string>();

  const addUnit = (
    code: string,
    location: string,
    area: string,
    extra: Partial<StoredUnit> = {},
  ) => {
    const unit: StoredUnit = {
      id: crypto.randomUUID(),
      hotelId: demoHotelId,
      departmentId: department.id,
      departmentName: department.name,
      code,
      location,
      area,
      unitType: 'split',
      brand: 'Daikin',
      capacity: '1.5 PK',
      refrigerant: 'r32',
      ratedCurrent: 5.5,
      installedOn: '2022-03-01',
      warrantyUntil: '2027-03-01',
      intervals: { ...defaultIntervals },
      condition: 'normal',
      archived: false,
      version: 1,
      createdAt: daysAgo(400),
      ...extra,
    };
    units.push(unit);
    history.set(unit.id, []);
    return unit;
  };
  const addService = (
    unit: StoredUnit,
    type: ServiceType,
    days: number,
    email: string,
    extra: Partial<HistoryEntry & { kind: 'service' }> = {},
  ) => {
    history.get(unit.id)!.push({
      kind: 'service',
      id: crypto.randomUUID(),
      at: daysAgo(days),
      byEmail: email,
      serviceType: type,
      items: Object.fromEntries(serviceItems(type).map((item) => [item, 'ok'])),
      returnTemp: type === 'filter' ? null : 25,
      supplyTemp: type === 'filter' ? null : 15,
      pressurePsi: type === 'major' ? 125 : null,
      currentAmp: type === 'major' ? 5.1 : null,
      refrigerantAdded: false,
      result: 'normal',
      reasons: [],
      notes: '',
      ...extra,
    });
  };
  // Floor 1 rooms: a mix of overdue, due this week and recently serviced units.
  [
    ['101', 25, 60, 178],
    ['102', 19, 85, 150],
    ['103', 10, 30, 150],
    ['104', 3, 95, 150],
    ['105', 22, 80, 150],
  ].forEach(([room, filter, routine, major]) => {
    const unit = addUnit(String(room), 'Room ' + room, 'Floor 1');
    addService(unit, 'annual', 300, 'budi@example.com');
    addService(unit, 'major', Number(major), 'siti@example.com');
    addService(unit, 'routine', Number(routine), 'budi@example.com');
    addService(unit, 'filter', Number(filter), me);
  });
  [
    ['201', 15, 40],
    ['202', 30, 89],
    ['203', 5, 20],
    ['204', 20, 70],
  ].forEach(([room, filter, routine]) => {
    const unit = addUnit(String(room), 'Room ' + room, 'Floor 2', {
      refrigerant: room === '204' ? 'r22' : 'r32',
      installedOn: room === '204' ? '2012-06-01' : '2022-03-01',
      warrantyUntil: room === '204' ? '2014-06-01' : '2027-03-01',
    });
    addService(unit, 'annual', 200, 'siti@example.com');
    addService(unit, 'major', 170, 'siti@example.com');
    addService(unit, 'routine', Number(routine), 'budi@example.com');
    addService(unit, 'filter', Number(filter), 'budi@example.com');
  });
  const lobby = addUnit('LOBBY-1', 'Lobby', 'Public area', {
    unitType: 'cassette',
    capacity: '5 PK',
    ratedCurrent: 12,
    intervals: { filter: 14, routine: 60, major: 180, annual: 365 },
  });
  addService(lobby, 'annual', 100, 'siti@example.com');
  addService(lobby, 'routine', 62, 'siti@example.com');
  addService(lobby, 'filter', 16, 'siti@example.com');
  const ballroom = addUnit('BALL-1', 'Ballroom', 'Public area', {
    unitType: 'standing',
    capacity: '10 PK',
    ratedCurrent: 18,
    condition: 'attention',
  });
  addService(ballroom, 'annual', 210, 'siti@example.com');
  addService(ballroom, 'major', 200, 'siti@example.com', {
    refrigerantAdded: true,
    result: 'attention',
    reasons: ['pressure'],
    pressurePsi: 92,
    notes: 'Low suction pressure; refrigerant added.',
  });
  addService(ballroom, 'routine', 50, 'siti@example.com', {
    refrigerantAdded: true,
    result: 'attention',
    reasons: ['repeat-refill'],
    notes: 'Topped up again. Check for a leak at the flare joints.',
  });
  history.get(ballroom.id)!.push({
    kind: 'complaint',
    id: crypto.randomUUID(),
    at: daysAgo(4),
    byEmail: 'banquet@example.com',
    complaint: 'not-cold',
    notes: 'Wedding set-up, room stayed warm.',
  });
  // Registered recently and not serviced yet: its schedule starts on the registration day.
  addUnit('OFF-ENG', 'Engineering office', '', { capacity: '1 PK', createdAt: daysAgo(16) });
  work.push(
    {
      unitId: units.find((u) => u.code === '102')!.id,
      type: 'filter',
      state: 'claimed',
      userId: 'demo-budi',
      note: '',
      at: nowIso(),
      expiresAt: new Date(Date.now() + 8 * 3600000).toISOString(),
      assigned: false,
    },
    {
      unitId: units.find((u) => u.code === '202')!.id,
      type: 'filter',
      state: 'postponed',
      userId: 'demo-budi',
      note: 'Guest in room until 14:00.',
      at: nowIso(),
      expiresAt: null,
      assigned: false,
    },
  );

  const find = (id: string) => {
    const unit = units.find((u) => u.id === id);
    if (!unit) throw new ModuleRequestError('ACCESS_DENIED');
    return unit;
  };
  const email = (userId: string) => technicians.find((t) => t.userId === userId)?.email ?? '';
  const services = (unit: StoredUnit) =>
    history
      .get(unit.id)!
      .filter((entry): entry is HistoryEntry & { kind: 'service' } => entry.kind === 'service')
      .sort((a, b) => b.at.localeCompare(a.at));
  const liveWork = (unitId: string, type: ServiceType) =>
    work.find(
      (w) =>
        w.unitId === unitId &&
        w.type === type &&
        (w.state === 'postponed' || Date.parse(w.expiresAt!) > Date.now()),
    );
  const view = (unit: StoredUnit): AcUnit => {
    const done = services(unit);
    const sixty = Date.now() - 60 * 86400000;
    const ninety = Date.now() - 90 * 86400000;
    return {
      ...unit,
      areaMine: members.some(
        (m) => m.userId === 'demo-user' && m.area.toUpperCase() === unit.area.toUpperCase(),
      ),
      complaints60d: history
        .get(unit.id)!
        .filter((e) => e.kind === 'complaint' && Date.parse(e.at) > sixty).length,
      refills90d: done.filter((s) => s.refrigerantAdded && Date.parse(s.at) > ninety).length,
      lastService: done[0]
        ? { type: done[0].serviceType, doneAt: done[0].at, result: done[0].result }
        : null,
      schedule: serviceTypes
        .filter((type) => unit.intervals[type] > 0)
        .map((type) => {
          const last = done.find((s) => rank(s.serviceType) >= rank(type))?.at ?? null;
          const held = liveWork(unit.id, type);
          return {
            type,
            intervalDays: unit.intervals[type],
            lastDoneAt: last,
            dueOn: addDays(hotelToday(new Date(last ?? unit.createdAt)), unit.intervals[type]),
            work: held
              ? {
                  state: held.state,
                  userEmail: email(held.userId),
                  mine: held.userId === 'demo-user',
                  note: held.note,
                  at: held.at,
                  expiresAt: held.expiresAt,
                  assigned: held.assigned,
                }
              : null,
          };
        }),
    };
  };
  const save = (input: UnitInput, existing?: { id: string; version: number }) => {
    const code = normalizeCode(input.code);
    if (!isCode(code) || !input.location.trim()) throw new ModuleRequestError('INVALID_INPUT');
    if (units.some((u) => u.code === code && u.id !== existing?.id))
      throw new ModuleRequestError('DUPLICATE_CODE');
    const fields = {
      code,
      location: input.location.trim(),
      area: input.area.trim(),
      unitType: input.unitType,
      brand: input.brand.trim(),
      capacity: input.capacity.trim(),
      refrigerant: input.refrigerant,
      ratedCurrent: input.ratedCurrent,
      installedOn: input.installedOn || null,
      warrantyUntil: input.warrantyUntil || null,
      intervals: { ...input.intervals },
    };
    if (!existing) {
      addUnit(code, fields.location, fields.area, { ...fields, createdAt: nowIso() });
      return;
    }
    const unit = find(existing.id);
    if (unit.version !== existing.version) throw new ModuleRequestError('VERSION_CONFLICT');
    Object.assign(unit, fields, { version: unit.version + 1 });
  };

  return {
    async listUnits(_hotelId, _departmentId, includeArchived) {
      return {
        units: units
          .filter((u) => includeArchived || !u.archived)
          .map(view)
          .sort(
            (a, b) =>
              a.area.localeCompare(b.area) ||
              a.code.localeCompare(b.code, undefined, { numeric: true }),
          ),
        today: hotelToday(),
        serverNow: nowIso(),
      };
    },
    async saveUnit(_hotelId, _departmentId, input, existing) {
      save(input, existing);
    },
    async setUnitState(_hotelId, entry, action) {
      const unit = find(entry.id);
      if (unit.version !== entry.version) throw new ModuleRequestError('VERSION_CONFLICT');
      if (action === 'archive' || action === 'restore') unit.archived = action === 'archive';
      else unit.condition = action;
      unit.version++;
    },
    async importUnits(_hotelId, _departmentId, rows) {
      let added = 0;
      for (const row of rows) {
        if (units.some((u) => u.code === normalizeCode(row.code))) continue;
        save({
          ...row,
          ratedCurrent: null,
          installedOn: '',
          warrantyUntil: '',
          intervals: { ...defaultIntervals },
        });
        added++;
      }
      return { added, skipped: rows.length - added };
    },
    async setWork(_hotelId, entry, type, action, options = {}) {
      const unit = find(entry.id);
      if (unit.archived) throw new ModuleRequestError('UNIT_ARCHIVED');
      if (!unit.intervals[type]) throw new ModuleRequestError('NOT_SCHEDULED');
      if (action === 'postpone' && !options.note?.trim())
        throw new ModuleRequestError('INVALID_INPUT');
      const index = work.findIndex((w) => w.unitId === unit.id && w.type === type);
      if (index >= 0) work.splice(index, 1);
      if (action === 'release') return;
      const userId = action === 'assign' ? options.userId! : 'demo-user';
      if (!technicians.some((t) => t.userId === userId))
        throw new ModuleRequestError('ASSIGNEE_INVALID');
      work.push({
        unitId: unit.id,
        type,
        state: action === 'postpone' ? 'postponed' : 'claimed',
        userId,
        note: options.note?.trim() ?? '',
        at: nowIso(),
        expiresAt: action === 'postpone' ? null : new Date(Date.now() + 8 * 3600000).toISOString(),
        assigned: action === 'assign' && userId !== 'demo-user',
      });
    },
    async recordService(_hotelId, entry, input: ServiceInput, idempotencyKey) {
      const unit = find(entry.id);
      const earlier = keys.get(idempotencyKey);
      if (earlier) {
        const saved = services(unit).find((s) => s.id === earlier)!;
        return { id: saved.id, result: saved.result, reasons: saved.reasons };
      }
      if (unit.archived) throw new ModuleRequestError('UNIT_ARCHIVED');
      // The demo user is a supervisor, so a task claimed by someone else may be recorded.
      if (
        (needsTemperatures(input.serviceType) && input.returnTemp === null) ||
        (needsPressureAndCurrent(input.serviceType) &&
          (input.pressurePsi === null || input.currentAmp === null))
      )
        throw new ModuleRequestError('READINGS_REQUIRED');
      const reasons: AttentionReason[] = previewReasons(unit, input);
      if (
        input.refrigerantAdded &&
        services(unit).some(
          (s) => s.refrigerantAdded && Date.parse(s.at) > Date.now() - 90 * 86400000,
        )
      )
        reasons.push('repeat-refill');
      const result = reasons.length ? 'attention' : 'normal';
      if (result === 'attention' && !input.notes.trim())
        throw new ModuleRequestError('NOTES_REQUIRED');
      const id = crypto.randomUUID();
      history.get(unit.id)!.push({
        kind: 'service',
        id,
        at: nowIso(),
        byEmail: me,
        serviceType: input.serviceType,
        items: { ...input.items },
        returnTemp: input.returnTemp,
        supplyTemp: input.supplyTemp,
        pressurePsi: input.pressurePsi,
        currentAmp: input.currentAmp,
        refrigerantAdded: input.refrigerantAdded,
        result,
        reasons,
        notes: input.notes.trim(),
      });
      keys.set(idempotencyKey, id);
      for (let i = work.length - 1; i >= 0; i--)
        if (work[i].unitId === unit.id && rank(work[i].type) <= rank(input.serviceType))
          work.splice(i, 1);
      unit.condition = result;
      return { id, result, reasons };
    },
    async recordComplaint(_hotelId, entry, kind, note, idempotencyKey) {
      const unit = find(entry.id);
      if (keys.has(idempotencyKey)) return;
      if (unit.archived) throw new ModuleRequestError('UNIT_ARCHIVED');
      if (kind === 'other' && !note.trim()) throw new ModuleRequestError('INVALID_INPUT');
      const id = crypto.randomUUID();
      history.get(unit.id)!.push({
        kind: 'complaint',
        id,
        at: nowIso(),
        byEmail: me,
        complaint: kind,
        notes: note.trim(),
      });
      keys.set(idempotencyKey, id);
      if (unit.condition === 'normal') unit.condition = 'attention';
    },
    async unitHistory(_hotelId, entry, before) {
      const all = [...history.get(find(entry.id).id)!].sort(
        (a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id),
      );
      const start = before ? all.findIndex((e) => e.id === before.id) + 1 : 0;
      const data = all.slice(start, start + 20);
      const last = data[data.length - 1];
      return {
        data,
        nextCursor: data.length === 20 && last ? { at: last.at, id: last.id } : null,
      };
    },
    async listAreas() {
      const names = new Map<string, number>();
      for (const unit of units)
        if (!unit.archived && unit.area) names.set(unit.area, (names.get(unit.area) ?? 0) + 1);
      for (const member of members) if (!names.has(member.area)) names.set(member.area, 0);
      return {
        areas: [...names.entries()]
          .sort((a, b) => a[0].localeCompare(b[0]))
          .map(([area, count]) => ({
            area,
            units: count,
            members: members
              .filter((m) => m.area.toUpperCase() === area.toUpperCase())
              .sort((a, b) => Number(a.backup) - Number(b.backup))
              .map((m) => ({ userId: m.userId, email: email(m.userId), backup: m.backup })),
          })),
        technicians: [...technicians],
      };
    },
    async setAreaMember(_hotelId, _departmentId, area, userId, action, backup) {
      const name =
        units.find((u) => u.area.toUpperCase() === area.trim().toUpperCase())?.area ??
        members.find((m) => m.area.toUpperCase() === area.trim().toUpperCase())?.area ??
        area.trim();
      for (let i = members.length - 1; i >= 0; i--)
        if (members[i].area === name && members[i].userId === userId) members.splice(i, 1);
      if (action === 'add') members.push({ area: name, userId, backup });
    },
  };
}
