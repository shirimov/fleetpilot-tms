import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const records = await prisma.dispatchReserve.findMany({ orderBy: { createdAt: 'desc' } })
  const total = records.reduce((s, r) => s + r.amount, 0)
  return NextResponse.json({ total, records })
}

export async function POST(req: NextRequest) {
  const data = await req.json()
  const record = await prisma.dispatchReserve.create({
    data: {
      amount: parseFloat(data.amount),
      description: data.description,
      period: data.period,
    },
  })
  return NextResponse.json(record)
}
