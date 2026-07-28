import type { TaskActivityEvent } from './task-types';

export interface ActivityService {
  record(event: TaskActivityEvent): Promise<void>;
}

export class ConsoleActivityService implements ActivityService {
  async record(event: TaskActivityEvent): Promise<void> {
    console.info(
      '[task-activity]',
      JSON.stringify({
        ...event,
        occurredAt: event.occurredAt.toISOString(),
      }),
    );
  }
}

export const defaultActivityService = new ConsoleActivityService();
