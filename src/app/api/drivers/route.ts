import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
  const drivers = await prisma.driver.findMany({
    include: { truck: true },
    orderBy: { lastName: 'asc' },
  })
  return NextResponse.json(drivers)
}

export async function POST(req: Request) {
  const body = await req.json()
  const driver = await prisma.driver.create({
    data: {
      firstName: body.firstName,
      lastName: body.lastName,
      phone: body.phone || null,
      email: body.email || null,
      licenseNum: body.licenseNum || null,
      payType: body.payType,
      payRate: parseFloat(body.payRate),
      truckId: body.truckId || null,
    },
  })
  return NextResponse.json(driver)
}
