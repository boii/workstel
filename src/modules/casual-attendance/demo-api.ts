import { ModuleRequestError } from '../../core/module-rpc';
import type { CasualAttendanceApi } from './api';
import type { AttendanceRecord, Person, PersonInput } from './types';
import {
  addDays,
  correctionTimes,
  daysBetween,
  hotelInstant,
  hotelToday,
  lateMinutes,
  shiftStart,
  workedMinutes,
} from './validation';

export const demoHotelId = 'demo-hotel';
export const demoDepartments = [
  { id: 'housekeeping', name: 'Housekeeping' },
  { id: 'front-office', name: 'Front Office' },
];

const departmentName = (id: string) => demoDepartments.find((d) => d.id === id)?.name ?? '';
const isScheduled = (person: Person, day: string) =>
  person.status === 'active' &&
  person.startDate <= day &&
  (person.endDate === null || person.endDate >= day);
const error = (code: string) => new ModuleRequestError(code);

/** In-memory demo data that mirrors the server rules; it resets on reload. */
export function createDemoCasualAttendanceApi(
  now: () => Date = () => new Date(),
): CasualAttendanceApi {
  const today = hotelToday(now());
  const stamp = new Date().toISOString();
  const people: Person[] = (
    [
      ['Rina Kartika', 'casual', 'PT Mitra Kerja', 'housekeeping', -21, 3, 'morning'],
      ['Siti Nurhaliza', 'casual', 'PT Mitra Kerja', 'housekeeping', -30, null, 'morning'],
      ['Budi Santoso', 'daily', '', 'housekeeping', -7, null, 'afternoon'],
      ['Agus Wijaya', 'casual', 'PT Mitra Kerja', 'housekeeping', -14, 14, 'afternoon'],
      ['Putri Ayu', 'trainee', 'SMK Pariwisata 2', 'housekeeping', -9, 80, 'morning'],
      ['Dimas Prasetyo', 'trainee', 'Politeknik Pariwisata', 'front-office', -9, 82, 'morning'],
      ['Yoga Pratama', 'trainee', 'SMK Pariwisata 2', 'front-office', -100, -10, 'morning'],
    ] as const
  ).map(([name, type, origin, departmentId, start, end, shift], index) => ({
    id: 'demo-person-' + (index + 1),
    hotelId: demoHotelId,
    departmentId,
    departmentName: departmentName(departmentId),
    name,
    type,
    origin,
    startDate: addDays(today, start),
    endDate: end === null ? null : addDays(today, end),
    shift,
    notes: '',
    status: 'active',
    version: 1,
    updatedAt: stamp,
  }));

  const records: AttendanceRecord[] = [];
  const add = (
    person: Person,
    day: string,
    status: AttendanceRecord['status'],
    inOffset: number | null,
    outOffset: number | null,
    note = '',
  ) => {
    const start = shiftStart[person.shift];
    records.push({
      id: crypto.randomUUID(),
      personId: person.id,
      workDate: day,
      status,
      shift: person.shift,
      checkIn: inOffset === null ? null : hotelInstant(day, start + inOffset),
      checkOut: outOffset === null ? null : hotelInstant(day, start + 480 + outOffset),
      note,
      corrected: false,
      version: 1,
    });
  };
  // Earlier days: mostly on time, a few late arrivals and one sick day, for the recap.
  for (let back = 9; back >= 1; back--) {
    const day = addDays(today, -back);
    people.forEach((person, index) => {
      if (!isScheduled(person, day)) return;
      const seed = (back * 7 + index * 3) % 11;
      if (seed === 4) add(person, day, 'sick', null, null);
      else add(person, day, 'present', seed === 2 ? 18 : -seed, seed);
    });
  }
  // Today: only arrivals that have already happened at the hotel.
  const minutesNow = (now().getTime() - Date.parse(hotelInstant(today, 0))) / 60000;
  const [, siti, , agus, , dimas] = people;
  if (minutesNow > shiftStart.morning - 8) add(siti, today, 'present', -8, null);
  if (minutesNow > shiftStart.morning + 18) add(dimas, today, 'present', 18, null);
  add(agus, today, 'leave', null, null, 'Family matter');

  const findPerson = (id: string) => {
    const person = people.find((p) => p.id === id);
    if (!person) throw error('ACCESS_DENIED');
    return person;
  };
  const recordOf = (personId: string, day: string) =>
    records.find((r) => r.personId === personId && r.workDate === day) ?? null;
  const checkVersion = (record: AttendanceRecord | null, expected: number | null) => {
    if ((record?.version ?? null) !== expected) throw error('VERSION_CONFLICT');
  };
  const clean = (input: PersonInput) => ({
    name: input.name.trim(),
    type: input.type,
    origin: input.origin.trim(),
    departmentId: input.departmentId,
    departmentName: departmentName(input.departmentId),
    startDate: input.startDate,
    endDate: input.endDate || null,
    shift: input.shift,
    notes: input.notes.trim(),
    updatedAt: new Date().toISOString(),
  });

  return {
    async listPeople(query) {
      const search = query.search.trim().toLowerCase();
      const day = hotelToday(now());
      const data = people
        .filter((p) => {
          const ended = p.endDate !== null && p.endDate < day;
          const period =
            query.period === 'all' ||
            (query.period === 'archived'
              ? p.status === 'archived'
              : p.status === 'active' && (query.period === 'ended' ? ended : !ended));
          return (
            period &&
            (!query.departmentId || p.departmentId === query.departmentId) &&
            (!query.type || p.type === query.type) &&
            (!search || (p.name + ' ' + p.origin).toLowerCase().includes(search))
          );
        })
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ ...p }));
      return { data, nextCursor: null };
    },
    async savePerson(_hotelId, input, existing) {
      if (!existing) {
        people.push({
          ...clean(input),
          id: crypto.randomUUID(),
          hotelId: demoHotelId,
          status: 'active',
          version: 1,
        });
        return;
      }
      const person = findPerson(existing.id);
      if (person.version !== existing.version) throw error('VERSION_CONFLICT');
      if (
        person.departmentId !== input.departmentId &&
        records.some((r) => r.personId === person.id)
      )
        throw error('DEPARTMENT_LOCKED');
      Object.assign(person, clean(input), { version: person.version + 1 });
    },
    async setArchived(_hotelId, target, archived) {
      const person = findPerson(target.id);
      if (person.version !== target.version) throw error('VERSION_CONFLICT');
      Object.assign(person, {
        status: archived ? 'archived' : 'active',
        version: person.version + 1,
      });
    },
    async listDay(query) {
      return people
        .filter(
          (p) =>
            (!query.departmentId || p.departmentId === query.departmentId) &&
            (isScheduled(p, query.day) || recordOf(p.id, query.day)),
        )
        .sort((a, b) => shiftStart[a.shift] - shiftStart[b.shift] || a.name.localeCompare(b.name))
        .map((p) => {
          const record = recordOf(p.id, query.day);
          return {
            person: {
              id: p.id,
              name: p.name,
              type: p.type,
              origin: p.origin,
              departmentId: p.departmentId,
              departmentName: p.departmentName,
              shift: p.shift,
            },
            record: record && { ...record },
          };
        });
    },
    async mark(_hotelId, personId, day, action, expectedVersion, note = '') {
      const person = findPerson(personId);
      const record = recordOf(personId, day);
      checkVersion(record, expectedVersion);
      const current = hotelToday(now());
      const instant = now().toISOString();
      if (action === 'check_in' || action === 'leave' || action === 'sick' || action === 'absent') {
        if (record) throw error('ALREADY_MARKED');
        if (!isScheduled(person, day)) throw error('NOT_SCHEDULED');
        if (action === 'check_in' && day !== current && day !== addDays(current, -1))
          throw error('DAY_CLOSED');
        if (action !== 'check_in' && (day < addDays(current, -7) || day > addDays(current, 30)))
          throw error('DAY_CLOSED');
        const created: AttendanceRecord = {
          id: crypto.randomUUID(),
          personId,
          workDate: day,
          status: action === 'check_in' ? 'present' : action,
          shift: person.shift,
          checkIn: action === 'check_in' ? instant : null,
          checkOut: null,
          note: action === 'check_in' ? '' : note.trim(),
          corrected: false,
          version: 1,
        };
        records.push(created);
        return { ...created };
      }
      if (!record) throw error('NOT_CHECKED_IN');
      if (action === 'check_out') {
        if (record.status !== 'present' || !record.checkIn || record.checkOut)
          throw error('NOT_CHECKED_IN');
        Object.assign(record, { checkOut: instant, version: record.version + 1 });
      } else if (action === 'reopen') {
        if (!record.checkOut) throw error('NOT_CHECKED_IN');
        Object.assign(record, { checkOut: null, version: record.version + 1 });
      } else {
        if (record.checkOut) throw error('RECORD_CLOSED');
        records.splice(records.indexOf(record), 1);
        return null;
      }
      return { ...record };
    },
    async correct(_hotelId, personId, day, input, expectedVersion) {
      const person = findPerson(personId);
      const record = recordOf(personId, day);
      checkVersion(record, expectedVersion);
      const current = hotelToday(now());
      if (day > current || day < addDays(current, -62)) throw error('DAY_CLOSED');
      if (!record && !isScheduled(person, day)) throw error('NOT_SCHEDULED');
      const times = correctionTimes(day, input);
      if (!times || !input.reason.trim()) throw error('INVALID_INPUT');
      const end = times.checkOut ? Date.parse(times.checkOut) : null;
      if (
        Date.parse(times.checkIn) > now().getTime() ||
        (end !== null && (end > now().getTime() || end - Date.parse(times.checkIn) > 16 * 3600000))
      )
        throw error('INVALID_INPUT');
      const fields = {
        status: 'present' as const,
        checkIn: times.checkIn,
        checkOut: times.checkOut,
        corrected: true,
      };
      if (record) {
        Object.assign(record, fields, { version: record.version + 1 });
        return { ...record };
      }
      const created: AttendanceRecord = {
        ...fields,
        id: crypto.randomUUID(),
        personId,
        workDate: day,
        shift: person.shift,
        note: '',
        version: 1,
      };
      records.push(created);
      return { ...created };
    },
    async recap(query) {
      if (query.from > query.to || daysBetween(query.from, query.to) > 61)
        throw error('RANGE_TOO_LONG');
      return people
        .filter(
          (p) =>
            (!query.departmentId || p.departmentId === query.departmentId) &&
            (!query.type || p.type === query.type),
        )
        .map((p) => {
          const own = records.filter(
            (r) => r.personId === p.id && r.workDate >= query.from && r.workDate <= query.to,
          );
          const present = own.filter((r) => r.status === 'present');
          return {
            personId: p.id,
            name: p.name,
            type: p.type,
            origin: p.origin,
            departmentName: p.departmentName,
            present: present.length,
            late: present.filter((r) => lateMinutes(r) > 0).length,
            leave: own.filter((r) => r.status === 'leave').length,
            sick: own.filter((r) => r.status === 'sick').length,
            absent: own.filter((r) => r.status === 'absent').length,
            minutes: present
              .filter((r) => r.checkOut)
              .reduce((sum, r) => sum + workedMinutes(r), 0),
          };
        })
        .filter((row) => row.present + row.leave + row.sick + row.absent > 0)
        .sort((a, b) => a.name.localeCompare(b.name));
    },
  };
}
