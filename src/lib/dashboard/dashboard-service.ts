import type { PrismaClient } from '@prisma/client';
import { prisma } from '@/lib/prisma';

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
    };
  }
}

export const dashboardService = new DashboardService();
