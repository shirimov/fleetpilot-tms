import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { dispatchRouteErrorResponse } from '@/lib/dispatch/dispatch-route-response';
import { dispatchService } from '@/lib/dispatch/dispatch-service';
import { validateId, validateTrailerVinInput } from '@/lib/dispatch/dispatch-validation';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    return NextResponse.json(
      await dispatchService.updateTrailerVin(
        validateId((await params).id, 'Trailer ID'),
        validateTrailerVinInput(await request.json()),
        context,
      ),
    );
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}
