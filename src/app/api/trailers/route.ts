import { NextResponse } from 'next/server';
import { authorizationService } from '@/lib/auth/authorization';
import { dispatchRouteErrorResponse } from '@/lib/dispatch/dispatch-route-response';
import { dispatchService } from '@/lib/dispatch/dispatch-service';
import { validateTrailerInput } from '@/lib/dispatch/dispatch-validation';
import { equipmentScopeService } from '@/lib/fleet/equipment-scope';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const scope = await equipmentScopeService.resolve(params.get('company'));
    const query = params.get('q')?.slice(0, 100) ?? '';
    const view = params.get('view') ?? 'active';
    if (!['active', 'inactive', 'all'].includes(view)) {
      return NextResponse.json({ error: 'Trailer view is invalid.' }, { status: 400 });
    }
    const page = Math.max(1, Number.parseInt(params.get('page') ?? '1', 10) || 1);
    const pageSize = Math.min(100, Math.max(1, Number.parseInt(params.get('pageSize') ?? '100', 10) || 100));
    const result = await dispatchService.getTrailersPage(scope.companyIds, query, view, page, pageSize);
    if (params.get('format') !== 'page') return NextResponse.json(result.items);
    const manageByCompany = new Map(scope.companies.map(({ id, canManage }) => [id, canManage]));
    return NextResponse.json({
      ...result,
      items: result.items.map((trailer) => ({ ...trailer, canManage: manageByCompany.get(trailer.companyId) ?? false })),
      companies: scope.companies,
      activeCompanyId: scope.activeCompanyId,
      selectedCompany: scope.selectedCompany,
      pagination: { page, pageSize, total: result.total, totalPages: Math.max(1, Math.ceil(result.total / pageSize)) },
    });
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
