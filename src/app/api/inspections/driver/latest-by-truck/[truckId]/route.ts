import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Returns the most recent driver orientation for the driver currently assigned to this truck
export async function GET(_: Request, { params }: { params: Promise<{ truckId: string }> }) {
  const { truckId } = await params
  try {
    // Find driver assigned to this truck
    const driver = await prisma.driver.findFirst({ where: { truckId } })
    if (!driver) return NextResponse.json(null)

    const orientation = await prisma.driverOrientation.findFirst({
      where: { driverId: driver.id },
      orderBy: { completedAt: 'desc' },
      include: { driver: { select: { firstName: true, lastName: true } } },
    })
    if (!orientation) return NextResponse.json(null)
    return NextResponse.json(orientation)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}
