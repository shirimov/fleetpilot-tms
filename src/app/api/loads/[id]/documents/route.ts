import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { dispatchRouteErrorResponse } from '@/lib/dispatch/dispatch-route-response';
import { dispatchService } from '@/lib/dispatch/dispatch-service';
import {
  dispatchDocumentTypes,
  validateId,
} from '@/lib/dispatch/dispatch-validation';
import { validateDispatchDocument } from '@/lib/dispatch/dispatch-storage';
import { DispatchValidationError } from '@/lib/dispatch/dispatch-errors';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const form = await request.formData();
    const file = form.get('file');
    const type = form.get('type');
    if (!(file instanceof File) || typeof type !== 'string' ||
      !dispatchDocumentTypes.has(type as never)) {
      throw new DispatchValidationError('A valid document and type are required.');
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    return NextResponse.json(
      await dispatchService.addLoadDocument(
        validateId((await params).id, 'Load ID'),
        validateDispatchDocument(file, type as never, bytes),
        bytes,
        context,
      ),
      { status: 201 },
    );
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}

