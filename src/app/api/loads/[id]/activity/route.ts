import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { dispatchRouteErrorResponse } from '@/lib/dispatch/dispatch-route-response';
import { dispatchService } from '@/lib/dispatch/dispatch-service';
import { validateId } from '@/lib/dispatch/dispatch-validation';

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  try {
    const context = await authorizationService.requireActiveCompany();
    return NextResponse.json(
      await dispatchService.getLoadActivity(
        validateId((await params).id, 'Load ID'),
        context,
      ),
    );
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}

