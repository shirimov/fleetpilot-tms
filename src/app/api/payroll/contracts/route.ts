import { NextResponse } from 'next/server';
import { payrollPreviewService } from '@/lib/payroll/payroll-preview-service';
import { financialRouteError } from '@/lib/finance/financial-control-route';

export async function POST(request: Request) {
  try { return NextResponse.json(await payrollPreviewService.createContract(await request.json()), { status: 201 }); }
  catch (error) { return financialRouteError(error); }
}
