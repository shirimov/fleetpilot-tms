import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '@prisma/client';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { QuickManageError } from './quickmanage-client';
import { QuickManageExplorerService, sanitizeQuickManageData } from './quickmanage-explorer';

const context = { user: { id: 'owner', email: 'owner@example.test', displayName: 'Owner', isActive: true, activeCompanyId: 'company-a' }, companyId: 'company-a', role: 'OWNER' } as CompanyAuthorization;

function database(observed: { companyId?: string } = {}) {
  return { externalSourceLink: { findMany: async ({ where }: { where: { companyId: string } }) => { observed.companyId = where.companyId; return []; } } } as unknown as PrismaClient;
}

test('live explorer sends only documented filters and scopes link lookup to the active company', async () => {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const observed: { companyId?: string } = {};
  const service = new QuickManageExplorerService(database(observed), { request: async (path, init) => {
    calls.push({ path, init });
    return { data: { count: 1, page: 0, page_size: 20, items: [{ id: 'truck-1', unit: '001', status: 'active' }] } };
  } });
  const result = await service.explore(context, { resource: 'trucks', filters: [{ field: 'unit_number', operator: 'match', value: '001' }] });
  assert.equal(calls[0].path, '/x/trucks/search');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { query: '', filters: [{ field: 'unit_number', operator: 'match', value: '001' }], page: 0, page_size: 20 });
  assert.equal(observed.companyId, 'company-a');
  assert.equal((result as { total: number }).total, 1);
});

test('explorer fails closed on unsupported filters, duplicate pages, and invalid money numbers', async () => {
  const invalidFilter = new QuickManageExplorerService(database(), { request: async () => ({}) });
  await assert.rejects(invalidFilter.explore(context, { resource: 'trucks', filters: [{ field: 'company_id', operator: 'eq', value: 'other' }] }), QuickManageError);
  const duplicate = new QuickManageExplorerService(database(), { request: async () => ({ data: { count: 2, page: 0, page_size: 20, items: [{ id: 'same' }, { id: 'same' }] } }) });
  await assert.rejects(duplicate.explore(context, { resource: 'trucks' }), /duplicate records/);
  assert.throws(() => sanitizeQuickManageData({ amount: Number.POSITIVE_INFINITY }), /invalid numeric/);
});

test('sanitizer preserves unknown business fields while recursively redacting credential-like fields', () => {
  const sanitized = sanitizeQuickManageData({ unknown_vendor_field: 'kept', nested: { access_token: 'secret-token', amount: 12.34 }, Authorization: 'Bearer secret' });
  assert.deepEqual(sanitized, { unknown_vendor_field: 'kept', nested: { access_token: '[redacted]', amount: 12.34 }, Authorization: '[redacted]' });
  assert.doesNotMatch(JSON.stringify(sanitized), /secret-token|Bearer secret/);
});

test('report list and content use only documented read endpoints and validate content shape', async () => {
  const paths: string[] = [];
  const service = new QuickManageExplorerService(database(), { request: async (path) => {
    paths.push(path);
    if (path.startsWith('/x/reports?')) return { data: { has_more: false, items: [{ id: '11111111-1111-4111-8111-111111111111', type: 'trip' }] } };
    return { data: { header: [], content: { columns: [{ cid: 0, key: 'amount' }], rows: [{ 0: 125.5 }] } } };
  } });
  const list = await service.explore(context, { resource: 'reports', reportType: 'trip' });
  const content = await service.explore(context, { resource: 'report-content', id: '11111111-1111-4111-8111-111111111111' });
  assert.deepEqual(paths, ['/x/reports?type=trip&subtype=ignore&page=0', '/x/reports/11111111-1111-4111-8111-111111111111/content']);
  assert.equal((list as { hasMore: boolean }).hasMore, false);
  assert.deepEqual(((content as { item: { content: { rows: unknown[] } } }).item).content.rows, [{ 0: 125.5 }]);
});

test('provider page-size anomaly is disclosed instead of silently treated as exact', async () => {
  const service = new QuickManageExplorerService(database(), { request: async () => ({ data: { count: 2, page: 0, page_size: 2, items: [{ id: 'a' }, { id: 'b' }] } }) });
  const result = await service.explore(context, { resource: 'trips', pageSize: 1 });
  assert.match((result as { warning: string }).warning, /did not honor/);
});
