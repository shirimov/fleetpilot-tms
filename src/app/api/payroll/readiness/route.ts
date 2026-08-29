import { NextResponse } from 'next/server';
import { financialRouteError } from '@/lib/finance/financial-control-route';
import { payrollVerificationService } from '@/lib/payroll/payroll-verification-service';
export async function GET() { try { return NextResponse.json(await payrollVerificationService.readiness()); } catch (error) { return financialRouteError(error); } }
