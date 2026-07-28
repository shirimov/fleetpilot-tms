import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { dispatchRouteErrorResponse } from '@/lib/dispatch/dispatch-route-response';
import { dispatchService } from '@/lib/dispatch/dispatch-service';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const searchParams = new URL(request.url).searchParams;
    const query = searchParams.get('q')?.slice(0, 100) ?? '';
    const exception = searchParams.get('exception')?.slice(0, 32) ?? '';
    return NextResponse.json(
      await dispatchService.getDispatchBoard(context.companyId, query, exception),
    );
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}
