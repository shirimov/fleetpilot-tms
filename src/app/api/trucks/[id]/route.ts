import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const truck = await prisma.truck.update({
    where: { id },
    data: {
      unitNumber: body.unitNumber,
      vin: body.vin || null,
      year: body.year ? parseInt(body.year) : null,
      make: body.make || null,
      model: body.model || null,
      status: body.status || 'ACTIVE',
      companyId: body.companyId,
      isOwnerOp: body.isOwnerOp === true,
      ownerName: body.ownerName || null,
    },
  })
  return NextResponse.json(truck)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.truck.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
