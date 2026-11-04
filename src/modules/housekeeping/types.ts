export const taskTypes = ['departure', 'make-up', 'other'] as const;
export type TaskType = (typeof taskTypes)[number];
export const taskStatuses = ['active', 'paused', 'done', 'cancelled'] as const;
export type TaskStatus = (typeof taskStatuses)[number];
export type TaskAction = 'pause' | 'resume' | 'finish' | 'cancel';

/** One timed cleaning of a room. Times come from the server clock. */
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
}
export interface LastCleaning {
  type: TaskType;
  finishedAt: string;
  durationSeconds: number;
}
export interface Room {
  id: string;
  hotelId: string;
  departmentId: string;
  departmentName: string;
  number: string;
  floor: string;
  roomType: string;
  archived: boolean;
  version: number;
  openTask: CleaningTask | null;
  lastDone: LastCleaning | null;
}
export interface RoomInput {
  roomNumber: string;
  floor: string;
  roomType: string;
}
export interface RoomList {
  rooms: Room[];
  serverNow: string;
}
export interface TypeTotals {
  done: number;
  avgSeconds: number;
  maxSeconds: number;
}
export interface AttendantTotals {
  email: string;
  done: number;
  avgSeconds: number;
  totalSeconds: number;
}
export interface HousekeepingSummary {
  totals: { done: number; rooms: number; avgSeconds: number };
  taskTypes: Partial<Record<TaskType, TypeTotals>>;
  attendants: AttendantTotals[];
  day: string;
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
