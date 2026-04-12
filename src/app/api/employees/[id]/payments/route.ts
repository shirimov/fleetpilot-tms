import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const payments = await prisma.employeePayment.findMany({
    where: { employeeId: id },
    orderBy: { createdAt: 'desc' },
  })
  return NextResponse.json(payments)
}

export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const data = await req.json()
  const payment = await prisma.employeePayment.create({
    data: {
      employeeId: id,
      amount: parseFloat(data.amount),
      currency: data.currency || 'USD',
      period: data.period,
      method: data.method || 'Bank Transfer',
      status: data.status || 'PENDING',
      paidAt: data.paidAt ? new Date(data.paidAt) : null,
      notes: data.notes || null,
    },
  })
  return NextResponse.json(payment)
}
