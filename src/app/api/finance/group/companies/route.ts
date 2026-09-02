import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialRouteError } from '@/lib/finance/financial-control-route';
import { operatingGroupCompanyService } from '@/lib/finance/operating-group-company-service';

export async function GET() {
  try {
    return NextResponse.json(await operatingGroupCompanyService.list(await financialControlAuthorization.requireContext()));
  } catch (error) {
    return financialRouteError(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as { companyId?: unknown };
    return NextResponse.json(
      await operatingGroupCompanyService.add(body.companyId, await financialControlAuthorization.requireContext('OWNER')),
      { status: 201 },
    );
  } catch (error) {
    return financialRouteError(error);
  }
}
