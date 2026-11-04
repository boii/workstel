import type {
  CleaningTask,
  TurnaroundSummary,
  Page,
  Room,
  RoomInput,
  RoomList,
  TaskAction,
  TaskQuery,
  TaskType,
} from './types';

/** Room Turnaround service contract. The server derives the actor from the session, takes all
 * times from its own clock and checks room-turnaround:read, :write and :manage per hotel
 * department. */
export interface RoomTurnaroundApi {
  listRooms(
    hotelId: string,
    departmentId: string | null,
    includeArchived: boolean,
    signal?: AbortSignal,
  ): Promise<RoomList>;
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
  startTask(hotelId: string, room: Room, type: TaskType): Promise<void>;
  updateTask(hotelId: string, task: CleaningTask, action: TaskAction): Promise<void>;
  listTasks(query: TaskQuery, signal?: AbortSignal): Promise<Page<CleaningTask>>;
  summary(
    hotelId: string,
    departmentId: string | null,
    day: string | null,
    signal?: AbortSignal,
  ): Promise<TurnaroundSummary>;
}
