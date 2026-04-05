import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(_: Request, { params }: { params: Promise<{ truckId: string }> }) {
  const { truckId } = await params
  try {
    const inspection = await prisma.truckInspection.findFirst({
      where: { truckId },
      orderBy: { inspectedAt: 'desc' },
    })
    if (!inspection) return NextResponse.json(null)
    return NextResponse.json(inspection)
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Failed to fetch' }, { status: 500 })
  }
}
