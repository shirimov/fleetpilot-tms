import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const orientations = await prisma.driverOrientation.findMany({
      include: { driver: { select: { firstName: true, lastName: true } } },
      orderBy: { completedAt: 'desc' },
      take: 100,
    })
    return NextResponse.json(orientations)
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to fetch orientations' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { driverId, completedBy, checklist, signature, notes } = body
    if (!driverId || !completedBy || !checklist || !signature) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    const orientation = await prisma.driverOrientation.create({
      data: { driverId, completedBy, checklist, signature, notes },
      include: { driver: { select: { firstName: true, lastName: true } } },
    })
    return NextResponse.json(orientation, { status: 201 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to create orientation' }, { status: 500 })
  }
}
