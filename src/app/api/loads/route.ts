import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
  const loads = await prisma.load.findMany({
    include: { truck: true, driver: true, company: true },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(loads)
}

export async function POST(req: Request) {
  const body = await req.json()
  const load = await prisma.load.create({
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
