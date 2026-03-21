import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const driver = await prisma.driver.update({
    where: { id },
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

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.driver.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
