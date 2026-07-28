import type { Prisma } from '@prisma/client';
import type { TaskActivityEvent } from './task-types';

const MAX_ACTIVITY_METADATA_BYTES = 16_384;

export interface ActivityService {
  record(
    transaction: Prisma.TransactionClient,
    event: TaskActivityEvent,
  ): Promise<void>;
}

export class ConsoleActivityService implements ActivityService {
  async record(
    _transaction: Prisma.TransactionClient,
    event: TaskActivityEvent,
  ): Promise<void> {
    console.info(
      '[task-activity]',
      JSON.stringify({
        ...event,
        occurredAt: event.occurredAt?.toISOString(),
      }),
    );
  }
}

export class PrismaActivityService implements ActivityService {
  async record(
    transaction: Prisma.TransactionClient,
    event: TaskActivityEvent,
  ): Promise<void> {
    if (event.metadata) {
      const metadataBytes = Buffer.byteLength(JSON.stringify(event.metadata), 'utf8');
      if (metadataBytes > MAX_ACTIVITY_METADATA_BYTES) {
        throw new Error('Task activity metadata exceeds the 16 KB limit.');
      }
    }

    await transaction.taskActivity.create({
      data: {
        projectId: event.projectId,
        cardId: event.cardId,
        entityType: event.entityType,
        entityId: event.entityId,
        entityTitle: event.entityTitle,
        action: event.action,
        actorType: event.actorType,
        actorId: event.actorId,
        sourceType: event.sourceType,
        sourceId: event.sourceId,
        metadata: event.metadata,
        occurredAt: event.occurredAt,
      },
    });
  }
}

export const defaultActivityService = new PrismaActivityService();
