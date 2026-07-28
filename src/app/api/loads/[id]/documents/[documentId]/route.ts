import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { dispatchRouteErrorResponse } from '@/lib/dispatch/dispatch-route-response';
import { dispatchService } from '@/lib/dispatch/dispatch-service';
import { validateId } from '@/lib/dispatch/dispatch-validation';

type RouteContext = { params: Promise<{ id: string; documentId: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const route = await params;
    const document = await dispatchService.getLoadDocument(
      validateId(route.id, 'Load ID'),
      validateId(route.documentId, 'Document ID'),
      context,
    );
    return new NextResponse(document.bytes as BodyInit, {
      headers: {
        'Content-Type': document.mimeType,
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(document.filename)}`,
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const route = await params;
    await dispatchService.deleteLoadDocument(
      validateId(route.id, 'Load ID'),
      validateId(route.documentId, 'Document ID'),
      context,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}

