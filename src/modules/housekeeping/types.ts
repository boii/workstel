export const roomStatuses = [
  'vacant-dirty',
  'vacant-clean',
  'vacant-ready',
  'occupied',
  'out-of-order',
] as const;
export type RoomStatus = (typeof roomStatuses)[number];
export const taskTypes = ['departure', 'make-up', 'turndown', 'pre-arrival', 'deep-clean'] as const;
export type TaskType = (typeof taskTypes)[number];
export const taskStatuses = ['active', 'paused', 'done', 'dnd', 'refused', 'cancelled'] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export type TaskAction = 'pause' | 'resume' | 'finish' | 'cancel';
export type TaskOutcome = 'done' | 'dnd' | 'refused';
export type InspectionResult = 'pass' | 'redo';

/** A timed cleaning task. Times come from the server clock. */
export interface CleaningTask {
  id: string;
  roomId: string;
  roomNumber: string;
  type: TaskType;
  status: TaskStatus;
  attendantEmail: string;
  mine: boolean;
  startedAt: string;
  pausedAt: string | null;
  pausedSeconds: number;
  finishedAt: string | null;
  durationSeconds: number | null;
  notes: string;
}
export interface Room {
  id: string;
  hotelId: string;
  departmentId: string;
  departmentName: string;
  number: string;
  floor: string;
  roomType: string;
  status: RoomStatus;
  statusNote: string;
  statusChangedAt: string;
  archived: boolean;
  version: number;
  openTask: CleaningTask | null;
  lastCleanedAt: string | null;
}
export interface RoomInput {
  roomNumber: string;
  floor: string;
  roomType: string;
}
export interface TypeTotals {
  done: number;
  avgSeconds: number;
  declined: number;
}
export interface AttendantTotals {
  email: string;
  done: number;
  avgSeconds: number;
  totalSeconds: number;
}
export interface HousekeepingSummary {
  statuses: Record<RoomStatus | 'in-progress', number>;
  taskTypes: Partial<Record<TaskType, TypeTotals>>;
  attendants: AttendantTotals[];
  inspections: { pass: number; redo: number };
  day: string;
  serverNow: string;
}
export interface Page<T> {
  data: T[];
  nextCursor: string | null;
}
export interface TaskQuery {
  hotelId: string;
  departmentId: string | null;
  day: string | null;
  roomId: string | null;
  after: string | null;
  limit?: number;
}

/** One action from the room dialog; the page runs it and refreshes the board. */
export type RoomAction =
  | { kind: 'start'; type: TaskType }
  | { kind: 'decline'; outcome: 'dnd' | 'refused' }
  | { kind: 'task'; task: CleaningTask; action: TaskAction; outcome?: TaskOutcome; notes?: string }
  | { kind: 'status'; status: RoomStatus; note: string }
  | { kind: 'inspect'; result: InspectionResult; reason: string }
  | { kind: 'archive'; archived: boolean };
