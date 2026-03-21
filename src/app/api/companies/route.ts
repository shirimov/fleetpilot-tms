import { prisma } from '@/lib/prisma'
import { NextResponse } from 'next/server'

export async function GET() {
  const companies = await prisma.company.findMany({ orderBy: { name: 'asc' } })
  return NextResponse.json(companies)
}

export async function POST(req: Request) {
  const body = await req.json()
  const company = await prisma.company.create({
    data: { name: body.name, dotNumber: body.dotNumber || null, mcNumber: body.mcNumber || null },
  })
  return NextResponse.json(company)
}
