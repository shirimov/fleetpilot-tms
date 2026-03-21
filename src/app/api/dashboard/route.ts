import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
  const now = new Date()
  // Start of the current week (Sunday)
  const startOfWeek = new Date(now)
  startOfWeek.setHours(0, 0, 0, 0)
  startOfWeek.setDate(now.getDate() - now.getDay())

  const [
    activeTrucks,
    totalTrucks,
    loadsThisWeek,
    revenueThisWeek,
    pendingSettlements,
    recentLoads,
  ] = await Promise.all([
    prisma.truck.count({ where: { status: 'ACTIVE' } }),
    prisma.truck.count(),
    prisma.load.count({
      where: { createdAt: { gte: startOfWeek } },
    }),
    prisma.load.aggregate({
      where: { createdAt: { gte: startOfWeek } },
      _sum: { rate: true, fuelSurcharge: true },
    }),
    prisma.settlement.count({ where: { isPaid: false } }),
    prisma.load.findMany({
      take: 10,
      orderBy: { createdAt: 'desc' },
      include: { truck: true, driver: true, company: true },
    }),
  ])

  const revenue = (revenueThisWeek._sum.rate || 0) + (revenueThisWeek._sum.fuelSurcharge || 0)

  return NextResponse.json({
    activeTrucks,
    totalTrucks,
    loadsThisWeek,
    revenueThisWeek: revenue,
    pendingSettlements,
    recentLoads,
  })
}
