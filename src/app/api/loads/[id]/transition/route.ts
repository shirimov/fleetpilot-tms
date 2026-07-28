import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { dispatchRouteErrorResponse } from '@/lib/dispatch/dispatch-route-response';
import { dispatchService } from '@/lib/dispatch/dispatch-service';
import {
  validateId,
  validateTransitionInput,
} from '@/lib/dispatch/dispatch-validation';

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const input = validateTransitionInput(await request.json());
    return NextResponse.json(
      await dispatchService.transitionLoad(
        validateId((await params).id, 'Load ID'),
        input.status,
        context,
        input.expectedUpdatedAt,
      ),
    );
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}

