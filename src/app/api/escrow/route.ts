import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const escrows = await prisma.employeeEscrow.findMany({
    include: {
      transactions: { orderBy: { createdAt: 'desc' } },
    },
  })
  return NextResponse.json(escrows)
}

export async function POST(req: NextRequest) {
  const data = await req.json()
  // Upsert escrow account for employee
  const escrow = await prisma.employeeEscrow.upsert({
    where: { employeeId: data.employeeId },
    create: { employeeId: data.employeeId, balance: 0, target: data.target || 0 },
    update: { target: data.target || 0 },
  })
  return NextResponse.json(escrow)
}
