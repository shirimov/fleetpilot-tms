import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialRouteError } from '@/lib/finance/financial-control-route';
import { pilotProductMappingService } from '@/lib/finance/pilot-product-mapping-service';

export async function GET() {
  try {
    return NextResponse.json(await pilotProductMappingService.list(await financialControlAuthorization.requireContext()));
  } catch (error) {
    return financialRouteError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json();
    return NextResponse.json(await pilotProductMappingService.save(body.productCode, body.categoryId, await financialControlAuthorization.requireContext()));
  } catch (error) {
    return financialRouteError(error);
  }
}
