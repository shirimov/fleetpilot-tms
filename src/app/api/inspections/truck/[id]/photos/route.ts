import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { fleetRouteErrorResponse } from '@/lib/fleet/fleet-route-response';

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const context = await fleetAuthorizationService.requireTruckInspection(id);
    const inspection = await prisma.truckInspection.findFirst({
      where: { id, truck: { companyId: context.companyId } },
    });
    if (!inspection) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    const formData = await request.formData();

    const uploadDir = path.join(process.cwd(), 'public', 'uploads', 'inspections', id);
    await mkdir(uploadDir, { recursive: true });

    const photos: Record<string, string> = {};
    const sides = ['front', 'driver', 'passenger', 'rear'];

    for (const side of sides) {
      const file = formData.get(side) as File | null;
      if (file && file.size > 0) {
        const bytes = await file.arrayBuffer();
        const buffer = Buffer.from(bytes);
        const ext = file.name.split('.').pop() || 'jpg';
        const filename = `${side}.${ext}`;
        await writeFile(path.join(uploadDir, filename), buffer);
        photos[side] = `/api/uploads/inspections/${id}/${filename}`;
      }
    }

    const existing = (inspection.photos as Record<string, string> | null) ?? {};
    const merged = { ...existing, ...photos };

    await prisma.truckInspection.update({
      where: { id, truck: { companyId: context.companyId } },
      data: { photos: merged },
    });

    return NextResponse.json({ ok: true, photos: merged });
  } catch (error) {
    return fleetRouteErrorResponse(error, 'Failed to upload photos');
  }
}
