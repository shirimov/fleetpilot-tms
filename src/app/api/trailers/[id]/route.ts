import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { dispatchRouteErrorResponse } from '@/lib/dispatch/dispatch-route-response';
import { dispatchService } from '@/lib/dispatch/dispatch-service';
import {
  validateId,
  validateTrailerInput,
} from '@/lib/dispatch/dispatch-validation';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    return NextResponse.json(
      await dispatchService.updateTrailer(
        validateId((await params).id, 'Trailer ID'),
        validateTrailerInput(await request.json()),
        context,
      ),
    );
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}

export async function DELETE(_request: Request, { params }: RouteContext) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    await dispatchService.deleteTrailer(
      validateId((await params).id, 'Trailer ID'),
      context,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}

