import { NextResponse } from 'next/server';
import { payrollPreviewService } from '@/lib/payroll/payroll-preview-service';
import { financialRouteError } from '@/lib/finance/financial-control-route';

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try { return NextResponse.json(await payrollPreviewService.periodPreview((await context.params).id)); }
  catch (error) { return financialRouteError(error); }
}
