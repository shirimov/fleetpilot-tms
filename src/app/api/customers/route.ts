import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { dispatchRouteErrorResponse } from '@/lib/dispatch/dispatch-route-response';
import { dispatchService } from '@/lib/dispatch/dispatch-service';
import { validateCustomerInput } from '@/lib/dispatch/dispatch-validation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const query = new URL(request.url).searchParams.get('q')?.slice(0, 100) ?? '';
    return NextResponse.json(
      await dispatchService.getCustomers(context.companyId, query),
    );
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const customer = await dispatchService.createCustomer(
      validateCustomerInput(await request.json()),
      context,
    );
    return NextResponse.json(customer, { status: 201 });
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}

