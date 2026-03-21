import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const load = await prisma.load.update({
    where: { id },
    data: {
      loadNumber: body.loadNumber,
      referenceNum: body.referenceNum || null,
      status: body.status || 'PENDING',
      origin: body.origin,
      destination: body.destination,
      pickupDate: body.pickupDate ? new Date(body.pickupDate) : null,
      deliveryDate: body.deliveryDate ? new Date(body.deliveryDate) : null,
      miles: body.miles ? parseFloat(body.miles) : null,
      rate: parseFloat(body.rate),
      fuelSurcharge: body.fuelSurcharge ? parseFloat(body.fuelSurcharge) : 0,
      truckId: body.truckId,
      driverId: body.driverId || null,
      companyId: body.companyId,
    },
  })
  return NextResponse.json(load)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.load.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
