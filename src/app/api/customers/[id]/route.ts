import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { dispatchRouteErrorResponse } from '@/lib/dispatch/dispatch-route-response';
import { dispatchService } from '@/lib/dispatch/dispatch-service';
import {
  validateCustomerInput,
  validateId,
} from '@/lib/dispatch/dispatch-validation';

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: RouteContext) {
  try {
    const context = await authorizationService.requireActiveCompany();
    return NextResponse.json(
      await dispatchService.updateCustomer(
        validateId((await params).id, 'Customer ID'),
        validateCustomerInput(await request.json()),
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
    await dispatchService.deleteCustomer(
      validateId((await params).id, 'Customer ID'),
      context,
    );
    return NextResponse.json({ ok: true });
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}

