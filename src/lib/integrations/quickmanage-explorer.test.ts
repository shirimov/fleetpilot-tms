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
  const content = await service.explore(context, { resource: 'report-content', reportType: 'trip', id: '11111111-1111-4111-8111-111111111111' });
  assert.deepEqual(paths, ['/x/reports?type=trip&subtype=ignore&page=0', '/x/reports/11111111-1111-4111-8111-111111111111/content']);
  assert.equal((list as { hasMore: boolean }).hasMore, false);
  assert.deepEqual(((content as { item: { content: { rows: unknown[] } } }).item).content.rows, [{ 0: 125.5 }]);
  assert.equal((content as { audit: { interpretation: string } }).audit.interpretation, 'PARTIALLY_VERIFIED');
  assert.equal((content as { capture: { importReadiness: string } }).capture.importReadiness, 'BLOCKED');
});

test('report content requires its documented type before any provider read', async () => {
  let contacted = false;
  const service = new QuickManageExplorerService(database(), { request: async () => { contacted = true; return {}; } });
  await assert.rejects(service.explore(context, { resource: 'report-content', id: '11111111-1111-4111-8111-111111111111' }), /report type is required/);
  assert.equal(contacted, false);
});

test('report relationship lookup is company scoped and never name matched', async () => {
  let where: unknown;
  const db = { externalSourceLink: { findMany: async (input: { where: unknown }) => { where = input.where; return [{ resourceType: 'TRIP', externalId: 'trip-external', loadId: 'load-local', truckId: null, trailerId: null, driverId: null, customerId: null }]; } } } as unknown as PrismaClient;
  const service = new QuickManageExplorerService(db, { request: async () => ({ data: { content: { columns: [{ cid: 0, key: { name: 'Trip ID', data_type: 'any' }, metadata: {} }, { cid: 1, key: { name: 'Driver Name', data_type: 'any' }, metadata: {} }], rows: [{ 0: 'trip-external', 1: 'Ambiguous Name' }] } } }) });
  const result = await service.explore(context, { resource: 'report-content', reportType: 'trip', id: '11111111-1111-4111-8111-111111111111' });
  assert.deepEqual(where, { companyId: 'company-a', provider: 'QUICKMANAGE', OR: [{ resourceType: 'TRIP', externalId: 'trip-external' }] });
  assert.deepEqual((result as { links: unknown }).links, { 'TRIP:trip-external': { linked: true, entityId: 'load-local' } });
});

test('provider page-size anomaly is disclosed instead of silently treated as exact', async () => {
  const service = new QuickManageExplorerService(database(), { request: async () => ({ data: { count: 2, page: 0, page_size: 2, items: [{ id: 'a' }, { id: 'b' }] } }) });
  const result = await service.explore(context, { resource: 'trips', pageSize: 1 });
  assert.match((result as { warning: string }).warning, /did not honor/);
});

test('report catalog checks every official type with bounded first-page reads', async () => {
  const paths: string[] = [];
  const service = new QuickManageExplorerService(database(), { request: async (path) => {
    paths.push(path);
    return path.includes('type=trip&')
      ? { data: { has_more: false, items: [{ id: '11111111-1111-4111-8111-111111111111', type: 'trip', created_at: '2026-08-29T12:00:00Z' }] } }
      : { data: { has_more: false, items: [] } };
  } });
  const result = await service.explore(context, { resource: 'report-catalog' }) as { items: Array<Record<string, unknown>> };
  assert.equal(paths.length, 17);
  assert.equal(paths.every((path) => path.endsWith('&subtype=ignore&page=0')), true);
  assert.equal(result.items.length, 17);
  assert.equal(result.items.find((item) => item.type === 'trip')?.sampleStatus, 'SAMPLE_AVAILABLE');
  assert.equal(result.items.find((item) => item.type === 'fuel')?.importReadiness, 'NOT_AVAILABLE');
});

test('report catalog rejects duplicate report IDs across provider types', async () => {
  const service = new QuickManageExplorerService(database(), { request: async () => ({ data: { has_more: false, items: [{ id: '11111111-1111-4111-8111-111111111111' }] } }) });
  await assert.rejects(service.explore(context, { resource: 'report-catalog' }), /duplicate report identifier/);
});
