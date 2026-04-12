import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  const employees = await prisma.employee.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      payments: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
    },
  })
  return NextResponse.json(employees)
}

export async function POST(req: NextRequest) {
  const data = await req.json()
  const employee = await prisma.employee.create({
    data: {
      firstName: data.firstName,
      lastName: data.lastName,
      role: data.role,
      roleCustom: data.roleCustom || null,
      phone: data.phone || null,
      email: data.email || null,
      country: data.country || 'Turkmenistan',
      city: data.city || null,
      region: data.region || null,
      salary: data.salary ? parseFloat(data.salary) : null,
      currency: data.currency || 'USD',
      paymentMethod: data.paymentMethod || 'Bank Transfer',
      startDate: data.startDate ? new Date(data.startDate) : null,
      notes: data.notes || null,
    },
  })
  return NextResponse.json(employee)
}
