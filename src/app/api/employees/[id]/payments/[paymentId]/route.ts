import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string; paymentId: string }> }) {
  const { paymentId } = await props.params
  const data = await req.json()
  const payment = await prisma.employeePayment.update({
    where: { id: paymentId },
    data: {
      status: data.status,
      paidAt: data.paidAt ? new Date(data.paidAt) : null,
    },
  })
  return NextResponse.json(payment)
}
