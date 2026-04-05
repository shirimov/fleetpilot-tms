import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { writeFile, mkdir } from 'fs/promises'
import path from 'path'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const formData = await request.formData()

    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'inspections', id)
    await mkdir(uploadDir, { recursive: true })

    const photos: Record<string, string> = {}
    const sides = ['front', 'driver', 'passenger', 'rear']

    for (const side of sides) {
      const file = formData.get(side) as File | null
      if (file && file.size > 0) {
        const bytes = await file.arrayBuffer()
        const buffer = Buffer.from(bytes)
        const ext = file.name.split('.').pop() || 'jpg'
        const filename = `${side}.${ext}`
        await writeFile(path.join(uploadDir, filename), buffer)
        photos[side] = `/api/uploads/inspections/${id}/${filename}`
      }
    }

    // Merge photos into the inspection record (store in notes or a dedicated field via JSON patch)
    const inspection = await prisma.truckInspection.findUnique({ where: { id } })
    if (!inspection) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const existing = (inspection.photos as Record<string, string> | null) ?? {}
    const merged = { ...existing, ...photos }

    await prisma.truckInspection.update({
      where: { id },
      data: { photos: merged },
    })

    return NextResponse.json({ ok: true, photos: merged })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: 'Failed to upload photos' }, { status: 500 })
  }
}
