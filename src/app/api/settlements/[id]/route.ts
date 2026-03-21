import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()

  const data: any = {}

  if (body.isPaid !== undefined) {
    data.isPaid = body.isPaid
    data.paidAt = body.isPaid ? new Date() : null
  }
  if (body.notes !== undefined) data.notes = body.notes
  if (body.fuelDeduction !== undefined) data.fuelDeduction = parseFloat(body.fuelDeduction)
  if (body.otherDeductions !== undefined) data.otherDeductions = parseFloat(body.otherDeductions)

  // Recalculate netPay if deductions changed
  if (body.fuelDeduction !== undefined || body.otherDeductions !== undefined) {
    const current = await prisma.settlement.findUnique({ where: { id } })
    if (current) {
      const fuel = data.fuelDeduction ?? current.fuelDeduction
      const other = data.otherDeductions ?? current.otherDeductions
      data.netPay = current.driverPay - fuel - other
    }
  }

  const settlement = await prisma.settlement.update({
    where: { id },
    data,
    include: { truck: true, driver: true, load: true },
  })
  return NextResponse.json(settlement)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.settlement.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
