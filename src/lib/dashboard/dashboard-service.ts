import type { LoadStatus, PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';

const activeLoadStatuses: LoadStatus[] = [
  'PLANNED',
  'ASSIGNED',
  'DISPATCHED',
  'PICKED_UP',
  'PENDING',
  'IN_TRANSIT',
];

export class DashboardService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async getSnapshot(companyId: string, now = new Date()) {
    const startOfWeek = new Date(now);
    startOfWeek.setHours(0, 0, 0, 0);
    startOfWeek.setDate(now.getDate() - now.getDay());

    const [
      activeTrucks,
      totalTrucks,
      loadsThisWeek,
      revenueThisWeek,
      pendingSettlements,
      recentLoads,
      activeLoads,
      unassignedLoads,
      availableTrucks,
      availableTrailers,
      activeDrivers,
      loadsAtRisk,
      overdueTasks,
      taskActivity,
      loadActivity,
    ] = await Promise.all([
      this.database.truck.count({
        where: { companyId, status: 'ACTIVE' },
      }),
      this.database.truck.count({ where: { companyId } }),
      this.database.load.count({
        where: { companyId, createdAt: { gte: startOfWeek } },
      }),
      this.database.load.aggregate({
        where: { companyId, createdAt: { gte: startOfWeek } },
        _sum: { rate: true, fuelSurcharge: true },
      }),
      this.database.settlement.count({
        where: { truck: { companyId }, isPaid: false },
      }),
      this.database.load.findMany({
        where: { companyId },
        take: 10,
        orderBy: { createdAt: 'desc' },
        include: { truck: true, driver: true, company: true },
      }),
      this.database.load.count({
        where: { companyId, status: { in: activeLoadStatuses } },
      }),
      this.database.load.count({
        where: {
          companyId,
          status: { in: activeLoadStatuses },
          OR: [{ truckId: null }, { driverId: null }, { trailerId: null }],
        },
      }),
      this.database.truck.count({
        where: {
          companyId,
          status: 'ACTIVE',
          loads: { none: { status: { in: activeLoadStatuses } } },
        },
      }),
      this.database.trailer.count({
        where: { companyId, status: 'AVAILABLE' },
      }),
      this.database.driver.count({ where: { companyId } }),
      this.database.load.count({
        where: {
          companyId,
          status: { in: activeLoadStatuses },
          OR: [
            { truckId: null },
            { driverId: null },
            { trailerId: null },
            { deliveryDate: { lt: now } },
          ],
        },
      }),
      this.database.taskCard.count({
        where: {
          project: { companyId },
          dueDate: { lt: now },
          status: { notIn: ['DONE', 'CANCELLED'] },
        },
      }),
      this.database.taskActivity.findMany({
        where: { project: { companyId } },
        take: 6,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          action: true,
          entityTitle: true,
          occurredAt: true,
          actorUser: { select: { displayName: true } },
        },
      }),
      this.database.loadActivity.findMany({
        where: { companyId },
        take: 6,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          action: true,
          loadNumber: true,
          occurredAt: true,
          actorUser: { select: { displayName: true } },
        },
      }),
    ]);

    return {
      activeTrucks,
      totalTrucks,
      loadsThisWeek,
      revenueThisWeek:
        (revenueThisWeek._sum.rate ?? 0) +
        (revenueThisWeek._sum.fuelSurcharge ?? 0),
      pendingSettlements,
      recentLoads,
      activeLoads,
      unassignedLoads,
      availableTrucks,
      availableTrailers,
      activeDrivers,
      loadsAtRisk,
      overdueTasks,
      recentActivity: [
        ...taskActivity.map((activity) => ({
          id: `task:${activity.id}`,
          type: 'task' as const,
          action: activity.action,
          title: activity.entityTitle ?? 'Task',
          actor: activity.actorUser?.displayName ?? 'System',
          occurredAt: activity.occurredAt,
        })),
        ...loadActivity.map((activity) => ({
          id: `load:${activity.id}`,
          type: 'load' as const,
          action: activity.action,
          title: `Load ${activity.loadNumber}`,
          actor: activity.actorUser?.displayName ?? 'System',
          occurredAt: activity.occurredAt,
        })),
      ]
        .sort(
          (first, second) =>
            second.occurredAt.getTime() - first.occurredAt.getTime() ||
            second.id.localeCompare(first.id),
        )
        .slice(0, 6),
    };
  }
}

export const dashboardService = new DashboardService();
