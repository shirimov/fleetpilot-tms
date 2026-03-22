import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const inspection = await prisma.truckInspection.findUnique({
      where: { id },
      include: { truck: { select: { unitNumber: true, make: true, model: true, year: true } } },
    })
    if (!inspection) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(inspection)
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to fetch inspection' }, { status: 500 })
  }
}
