import { readFile } from 'fs/promises';
import path from 'path';
import { NextResponse } from 'next/server';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';

const mimeTypes: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  heic: 'image/heic',
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ path: string[] }> },
) {
  try {
    const { path: segments } = await params;
    if (
      segments.length !== 3 ||
      segments[0] !== 'inspections' ||
      segments.some(
        (segment) =>
          !segment ||
          segment === '.' ||
          segment === '..' ||
          segment.includes('/') ||
          segment.includes('\\'),
      )
    ) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const [, inspectionId, filename] = segments;
    await fleetAuthorizationService.requireTruckInspection(inspectionId);

    const uploadRoot = path.resolve(
      process.cwd(),
      'public',
      'uploads',
      'inspections',
      inspectionId,
    );
    const filePath = path.resolve(uploadRoot, filename);
    if (!filePath.startsWith(`${uploadRoot}${path.sep}`)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const buffer = await readFile(filePath);
    const extension = filename.split('.').pop()?.toLowerCase() ?? '';
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeTypes[extension] ?? 'application/octet-stream',
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return (
      authorizationErrorResponse(error) ??
      NextResponse.json({ error: 'Not found' }, { status: 404 })
    );
  }
}
