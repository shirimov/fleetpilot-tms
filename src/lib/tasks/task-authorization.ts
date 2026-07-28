import type { PrismaClient } from '@prisma/client';
import {
  authorizationService,
  type CompanyAuthorization,
} from '@/lib/auth/authorization';
import { prisma } from '@/lib/prisma';
import { TaskNotFoundError, TaskProjectNotFoundError } from './task-errors';

export class TaskAuthorizationService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly authorize = authorizationService,
  ) {}

  async requireProject(projectId: string): Promise<CompanyAuthorization> {
    const context = await this.authorize.requireActiveCompany();
    const project = await this.database.taskProject.findFirst({
      where: { id: projectId, companyId: context.companyId },
      select: { id: true },
    });
    if (!project) throw new TaskProjectNotFoundError();
    return context;
  }

  async requireCard(cardId: string): Promise<CompanyAuthorization> {
    const context = await this.authorize.requireActiveCompany();
    const card = await this.database.taskCard.findFirst({
      where: {
        id: cardId,
        project: { companyId: context.companyId },
      },
      select: { id: true },
    });
    if (!card) throw new TaskNotFoundError();
    return context;
  }

  async requireCardActivity(cardId: string): Promise<CompanyAuthorization> {
    const context = await this.authorize.requireActiveCompany();
    const activity = await this.database.taskActivity.findFirst({
      where: {
        entityType: 'TASK_CARD',
        entityId: cardId,
        project: { companyId: context.companyId },
      },
      select: { id: true },
    });
    if (!activity) {
      await this.requireCard(cardId);
    }
    return context;
  }
}

export const taskAuthorizationService = new TaskAuthorizationService();
