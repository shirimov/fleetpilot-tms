import { NextResponse } from 'next/server';
import { fleetAuthorizationService } from '@/lib/fleet/fleet-authorization';
import { dispatchRouteErrorResponse } from '@/lib/dispatch/dispatch-route-response';
import { dispatchService } from '@/lib/dispatch/dispatch-service';
import {
  validateId,
  validateTrailerInput,
} from '@/lib/dispatch/dispatch-validation';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const context = await fleetAuthorizationService.requireTrailer(
      validateId((await params).id, 'Trailer ID'),
      'ADMIN',
    );
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
    const trailerId = validateId((await params).id, 'Trailer ID');
    const context = await fleetAuthorizationService.requireTrailer(trailerId, 'ADMIN');
    await dispatchService.deleteTrailer(
      trailerId,
      context,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}
