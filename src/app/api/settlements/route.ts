import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
  const settlements = await prisma.settlement.findMany({
    include: {
      truck: true,
      driver: true,
      load: true,
    },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(settlements)
}

export async function POST(req: Request) {
  const body = await req.json()

  // Auto-calculate driver pay if loadId provided
  let driverPay = parseFloat(body.driverPay) || 0
  let grossRevenue = parseFloat(body.grossRevenue) || 0

  if (body.loadId) {
    const load = await prisma.load.findUnique({
      where: { id: body.loadId },
      include: { driver: true },
    })
    if (load) {
      grossRevenue = load.rate + (load.fuelSurcharge || 0)
      if (load.driver) {
        if (load.driver.payType === 'PERCENTAGE') {
          driverPay = grossRevenue * (load.driver.payRate / 100)
        } else if (load.driver.payType === 'PER_MILE') {
          driverPay = (load.miles || 0) * load.driver.payRate
        } else {
          driverPay = load.driver.payRate
        }
      }
    }
  }

  const fuelDeduction = parseFloat(body.fuelDeduction) || 0
  const otherDeductions = parseFloat(body.otherDeductions) || 0
  const netPay = driverPay - fuelDeduction - otherDeductions

  const settlement = await prisma.settlement.create({
    data: {
      weekEnding: new Date(body.weekEnding),
      truckId: body.truckId,
      driverId: body.driverId || null,
      loadId: body.loadId || null,
      grossRevenue,
      driverPay,
      fuelDeduction,
      otherDeductions,
      netPay,
      notes: body.notes || null,
    },
    include: { truck: true, driver: true, load: true },
  })

  return NextResponse.json(settlement)
}
