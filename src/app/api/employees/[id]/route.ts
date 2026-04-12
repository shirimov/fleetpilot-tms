import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const employee = await prisma.employee.findUnique({
    where: { id },
    include: { payments: { orderBy: { createdAt: 'desc' } } },
  })
  if (!employee) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(employee)
}

export async function PUT(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const data = await req.json()
  const employee = await prisma.employee.update({
    where: { id },
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
      isActive: data.isActive,
      notes: data.notes || null,
    },
  })
  return NextResponse.json(employee)
}

export async function DELETE(_: NextRequest, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  await prisma.employee.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
