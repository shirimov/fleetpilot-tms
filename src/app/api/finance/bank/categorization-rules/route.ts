import type { BankClassificationScope, FinancialDirection } from '@prisma/client';
import { NextResponse } from 'next/server';
import { financialControlAuthorization } from '@/lib/finance/financial-control-authorization';
import { bankLedgerRouteError } from '@/lib/finance/bank-ledger-route';
import { BankLedgerValidationError } from '@/lib/finance/bank-ledger-errors';
import { bankCategorizationService } from '@/lib/finance/bank-categorization';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';

const directions = new Set<FinancialDirection>(['INFLOW', 'OUTFLOW', 'TRANSFER']);
const scopes = new Set<BankClassificationScope>(['COMPANY_LEVEL', 'ENTITY_ALLOCATED']);
const optional = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const minor = (value: unknown) => value === null || value === undefined || value === '' ? null : BigInt(String(value));

function parse(body: Record<string, unknown>) {
  const categoryId = optional(body.categoryId); const scope = body.scope as BankClassificationScope;
  if (!categoryId) throw new BankLedgerValidationError('Category is required.');
  if (!scopes.has(scope)) throw new BankLedgerValidationError('Scope is invalid.');
  const direction = optional(body.direction) as FinancialDirection | null;
  if (direction && !directions.has(direction)) throw new BankLedgerValidationError('Direction is invalid.');
  try { return { name: String(body.name ?? ''), isEnabled: body.isEnabled !== false, merchantNormalized: optional(body.merchantNormalized), descriptionContains: optional(body.descriptionContains), direction, bankAccountId: optional(body.bankAccountId), minimumAmountMinor: minor(body.minimumAmountMinor), maximumAmountMinor: minor(body.maximumAmountMinor), categoryId, scope, truckId: optional(body.truckId), trailerId: optional(body.trailerId), driverId: optional(body.driverId), partyId: optional(body.partyId) }; }
  catch { throw new BankLedgerValidationError('Rule amount must be an integer number of minor units.'); }
}

export async function GET(request: Request) { try { const context = await financialControlAuthorization.requireContext('ADMIN'); const companyId = new URL(request.url).searchParams.get('companyId') ?? context.activeCompanyId; return NextResponse.json(await bankCategorizationService.listRules(context, companyId), { headers: PRIVATE_NO_STORE_HEADERS }); } catch (error) { return bankLedgerRouteError(error); } }
export async function POST(request: Request) { try { const context = await financialControlAuthorization.requireContext('ADMIN'); const body = await request.json() as Record<string, unknown>; return NextResponse.json(await bankCategorizationService.createRule(context, optional(body.companyId) ?? context.activeCompanyId, parse(body)), { status: 201, headers: PRIVATE_NO_STORE_HEADERS }); } catch (error) { return bankLedgerRouteError(error); } }
