import { NextResponse } from 'next/server';
import { payrollPreviewService } from '@/lib/payroll/payroll-preview-service';
import { financialRouteError } from '@/lib/finance/financial-control-route';

export async function GET() {
  try { return NextResponse.json(await payrollPreviewService.participants()); }
  catch (error) { return financialRouteError(error); }
}
