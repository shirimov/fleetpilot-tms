import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const orientation = await prisma.driverOrientation.findUnique({
      where: { id },
      include: { driver: { select: { firstName: true, lastName: true, phone: true } } },
    })
    if (!orientation) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(orientation)
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to fetch orientation' }, { status: 500 })
  }
}
