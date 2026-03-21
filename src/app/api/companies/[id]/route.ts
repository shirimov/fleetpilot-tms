import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const body = await req.json()
  const company = await prisma.company.update({
    where: { id },
    data: {
      name: body.name,
      dotNumber: body.dotNumber || null,
      mcNumber: body.mcNumber || null,
    },
  })
  return NextResponse.json(company)
}

export async function DELETE(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  await prisma.company.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
