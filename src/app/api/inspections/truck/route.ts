import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const inspections = await prisma.truckInspection.findMany({
      include: { truck: { select: { unitNumber: true, make: true, model: true } } },
      orderBy: { inspectedAt: 'desc' },
      take: 100,
    })
    return NextResponse.json(inspections)
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to fetch inspections' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const { truckId, inspectedBy, phase1, phase2, phase3, notes, passed } = body
    if (!truckId || !inspectedBy || !phase1 || !phase2 || !phase3) {
      return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
    }
    const inspection = await prisma.truckInspection.create({
      data: { truckId, inspectedBy, phase1, phase2, phase3, notes, passed: passed ?? true },
      include: { truck: { select: { unitNumber: true } } },
    })
    return NextResponse.json(inspection, { status: 201 })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to create inspection' }, { status: 500 })
  }
}
