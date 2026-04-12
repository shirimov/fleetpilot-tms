import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// Get or create the single TM Fund
async function getFund() {
  let fund = await prisma.tmFund.findFirst()
  if (!fund) {
    fund = await prisma.tmFund.create({
      data: { name: 'Turkmenistan Fund', balance: 0, currency: 'USD' },
    })
  }
  return fund
}

export async function GET() {
  const fund = await getFund()
  const transactions = await prisma.tmFundTx.findMany({
    where: { fundId: fund.id },
    orderBy: { date: 'desc' },
  })
  return NextResponse.json({ ...fund, transactions })
}

export async function POST(req: NextRequest) {
  const data = await req.json()
  const fund = await getFund()

  const amount = parseFloat(data.amount)
  // DEPOSIT adds, everything else subtracts
  const delta = data.type === 'DEPOSIT' ? amount : -amount
  const newBalance = fund.balance + delta

  const [tx] = await prisma.$transaction([
    prisma.tmFundTx.create({
      data: {
        fundId: fund.id,
        type: data.type,
        amount,
        description: data.description,
        employeeId: data.employeeId || null,
        paymentRef: data.paymentRef || null,
        region: data.region || null,
        date: data.date ? new Date(data.date) : new Date(),
        notes: data.notes || null,
      },
    }),
    prisma.tmFund.update({
      where: { id: fund.id },
      data: { balance: newBalance },
    }),
  ])

  return NextResponse.json(tx)
}
