import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { dispatchRouteErrorResponse } from '@/lib/dispatch/dispatch-route-response';
import { dispatchService } from '@/lib/dispatch/dispatch-service';
import { validateTrailerInput } from '@/lib/dispatch/dispatch-validation';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const context = await authorizationService.requireActiveCompany();
    const query = new URL(request.url).searchParams.get('q')?.slice(0, 100) ?? '';
    return NextResponse.json(
      await dispatchService.getTrailers(context.companyId, query),
    );
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const context = await authorizationService.requireActiveCompany('ADMIN');
    const trailer = await dispatchService.createTrailer(
      validateTrailerInput(await request.json()),
      context,
    );
    return NextResponse.json(trailer, { status: 201 });
  } catch (error) {
    return dispatchRouteErrorResponse(error);
  }
}

