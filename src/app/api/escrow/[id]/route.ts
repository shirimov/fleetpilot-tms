import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

// POST a transaction (deposit or deduction) to an escrow account
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const data = await req.json()
  const amount = parseFloat(data.amount)
  const delta = data.type === 'DEPOSIT' ? amount : -amount

  const escrow = await prisma.employeeEscrow.findUnique({ where: { id } })
  if (!escrow) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const [tx] = await prisma.$transaction([
    prisma.escrowTx.create({
      data: {
        escrowId: id,
        amount,
        type: data.type,
        description: data.description,
        date: data.date ? new Date(data.date) : new Date(),
      },
    }),
    prisma.employeeEscrow.update({
      where: { id },
      data: { balance: escrow.balance + delta },
    }),
  ])

  return NextResponse.json(tx)
}

export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const escrow = await prisma.employeeEscrow.findUnique({
    where: { id },
    include: { transactions: { orderBy: { createdAt: 'desc' } } },
  })
  return NextResponse.json(escrow)
}
