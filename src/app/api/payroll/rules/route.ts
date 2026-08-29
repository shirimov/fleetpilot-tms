import { NextResponse } from 'next/server';
import { financialRouteError } from '@/lib/finance/financial-control-route';
import { payrollVerificationService } from '@/lib/payroll/payroll-verification-service';
export async function GET() { try { return NextResponse.json(await payrollVerificationService.listRules()); } catch (error) { return financialRouteError(error); } }
export async function POST(request: Request) { try { return NextResponse.json(await payrollVerificationService.saveRule(await request.json())); } catch (error) { return financialRouteError(error); } }
