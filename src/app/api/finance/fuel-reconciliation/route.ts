import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { financialRouteError } from '@/lib/finance/financial-control-route';
import { fuelDeductionReconciliation } from '@/lib/finance/fuel-deduction-reconciliation';
import { json } from '@/lib/finance/archive-service';

const reply = (body: unknown, status = 200) => NextResponse.json(json(body), { status, headers: { 'Cache-Control': 'private, no-store' } });

export async function GET(request: Request) {
  try {
    const context = await financialControlAuthorization.requireContext('ADMIN');
    const params = new URL(request.url).searchParams;
    if (params.get('view') === 'policies') return reply(await fuelDeductionReconciliation.policies(context));
    return reply(await fuelDeductionReconciliation.preview(context, {
      page: Number(params.get('page') ?? 1), companyId: params.get('company') ?? undefined,
      pid: params.get('pid') ?? undefined, date: params.get('date') ?? undefined, truck: params.get('truck') ?? undefined,
      recipient: params.get('recipient') ?? undefined, status: params.get('status') ?? undefined,
      responsibility: params.get('responsibility') ?? undefined, policy: params.get('policy') ?? undefined,
      history: params.get('history') ?? undefined,
    }));
  } catch (error) { return financialRouteError(error); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const historicalMapping = body.action === 'RESOLVE_HISTORICAL_TRUCK_MAPPING';
    const context = await financialControlAuthorization.requireContext(historicalMapping ? 'OWNER' : 'ADMIN');
    if (historicalMapping) return reply(await fuelDeductionReconciliation.createHistoricalTruckMapping(body, context), 201);
    return reply(await fuelDeductionReconciliation.createPolicy(body, context), 201);
  } catch (error) { return financialRouteError(error); }
}

export async function PUT(request: Request) {
  try {
    const context = await financialControlAuthorization.requireContext('ADMIN');
    const body = await request.json();
    const policyId = typeof body.policyId === 'string' ? body.policyId : '';
    return reply(await fuelDeductionReconciliation.previewPolicyRevision(policyId, body, context));
  } catch (error) { return financialRouteError(error); }
}

export async function PATCH(request: Request) {
  try {
    const context = await financialControlAuthorization.requireContext('ADMIN');
    const body = await request.json();
    const policyId = typeof body.policyId === 'string' ? body.policyId : '';
    return reply(await fuelDeductionReconciliation.revisePolicy(policyId, body, context));
  } catch (error) { return financialRouteError(error); }
}
