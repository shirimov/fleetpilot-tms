import { NextResponse } from 'next/server';
import { financialRouteError } from '@/lib/finance/financial-control-route';
import { payrollVerificationService } from '@/lib/payroll/payroll-verification-service';
export async function POST(request: Request) { try { return NextResponse.json(await payrollVerificationService.createRecurringRule(await request.json()), { status: 201 }); } catch (error) { return financialRouteError(error); } }
