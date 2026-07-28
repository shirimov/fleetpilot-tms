import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { DispatchValidationError } from '@/lib/dispatch/dispatch-errors';
import { dispatchRouteErrorResponse } from '@/lib/dispatch/dispatch-route-response';
import { dispatchService } from '@/lib/dispatch/dispatch-service';
import {
  dispatchDocumentTypes,
  validateId,
} from '@/lib/dispatch/dispatch-validation';
import { validateDispatchDocument } from '@/lib/dispatch/dispatch-storage';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const form = await request.formData();
    const file = form.get('file');
    const type = form.get('type');
    if (!(file instanceof File) || typeof type !== 'string' ||
      !dispatchDocumentTypes.has(type as never)) {
      throw new DispatchValidationError('A valid document and type are required.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    const expiresAtValue = form.get('expiresAt');
    const expiresAt = typeof expiresAtValue === 'string' && expiresAtValue
      ? new Date(expiresAtValue)
      : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      throw new DispatchValidationError('Document expiration is invalid.');
    }
    return NextResponse.json(
      await dispatchService.addTrailerDocument(
        validateId((await params).id, 'Trailer ID'),
        validateDispatchDocument(file, type as never, bytes),
        bytes,
        context,
        expiresAt,
      ),
      { status: 201 },
    );
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}

