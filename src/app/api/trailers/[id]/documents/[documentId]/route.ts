import { NextResponse } from 'next/server';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { dispatchRouteErrorResponse } from '@/lib/dispatch/dispatch-route-response';
import { dispatchService } from '@/lib/dispatch/dispatch-service';
import { validateId } from '@/lib/dispatch/dispatch-validation';
import { privateDownloadHeaders } from '@/lib/storage/private-file-storage';

type RouteContext = { params: Promise<{ id: string; documentId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const route = await params;
    const trailerId = validateId(route.id, 'Trailer ID');
    const context = await fleetAuthorizationService.requireTrailer(trailerId);
    const document = await dispatchService.getTrailerDocument(
      trailerId,
      validateId(route.documentId, 'Document ID'),
      context,
    );
    return new NextResponse(document.bytes as BodyInit, {
      headers: {
        ...privateDownloadHeaders(document.filename, document.mimeType),
        'Content-Length': String(document.bytes.byteLength),
      },
    });
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const route = await params;
    const trailerId = validateId(route.id, 'Trailer ID');
    const context = await fleetAuthorizationService.requireTrailer(trailerId, 'ADMIN');
    await dispatchService.deleteTrailerDocument(
      trailerId,
      validateId(route.documentId, 'Document ID'),
      context,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}
