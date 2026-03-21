import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
  const trucks = await prisma.truck.findMany({
    include: { company: true },
    orderBy: { unitNumber: 'asc' },
  })
  return NextResponse.json(trucks)
}

export async function POST(req: Request) {
  const body = await req.json()
  const truck = await prisma.truck.create({
    data: {
      unitNumber: body.unitNumber,
      vin: body.vin || null,
      year: body.year ? parseInt(body.year) : null,
      make: body.make || null,
      model: body.model || null,
      companyId: body.companyId,
      isOwnerOp: body.isOwnerOp === true,
      ownerName: body.ownerName || null,
    },
  })
  return NextResponse.json(truck)
}
