import type {
  CleaningTask,
  HousekeepingSummary,
  InspectionResult,
  Page,
  Room,
  RoomInput,
  RoomStatus,
  TaskAction,
  TaskOutcome,
  TaskQuery,
  TaskType,
} from './types';

/** Housekeeping service contract. The server derives the actor from the session, takes all
 * task times from its own clock and checks housekeeping:read, :write and :manage per
 * hotel department. */
export interface HousekeepingApi {
  listRooms(
    hotelId: string,
    departmentId: string | null,
    includeArchived: boolean,
    signal?: AbortSignal,
  ): Promise<Room[]>;
  saveRoom(
    hotelId: string,
    departmentId: string,
    input: RoomInput,
    existing?: Pick<Room, 'id' | 'version'>,
  ): Promise<void>;
  setRoomArchived(hotelId: string, room: Room, archived: boolean): Promise<void>;
  importRooms(
    hotelId: string,
    departmentId: string,
    rows: RoomInput[],
  ): Promise<{ added: number; skipped: number }>;
  setStatus(hotelId: string, room: Room, status: RoomStatus, note: string): Promise<void>;
  startTask(
    hotelId: string,
    room: Room,
    type: TaskType,
    outcome?: 'dnd' | 'refused',
    notes?: string,
  ): Promise<void>;
  updateTask(
    hotelId: string,
    task: CleaningTask,
    action: TaskAction,
    outcome?: TaskOutcome,
    notes?: string,
  ): Promise<void>;
  inspect(hotelId: string, room: Room, result: InspectionResult, reason: string): Promise<void>;
  listTasks(query: TaskQuery, signal?: AbortSignal): Promise<Page<CleaningTask>>;
  summary(
    hotelId: string,
    departmentId: string | null,
    day: string | null,
    signal?: AbortSignal,
  ): Promise<HousekeepingSummary>;
}
