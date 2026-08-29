import type { ExternalSyncResourceType, PrismaClient } from '@prisma/client';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { prisma } from '@/lib/prisma';
import { QuickManageError, type QuickManageClient, quickManageClient } from './quickmanage-client';
import {
  auditQuickManageReportContent,
  QUICKMANAGE_FINANCIAL_REPORT_DEFINITIONS,
  type QuickManageReportType,
} from './quickmanage-financial-audit';
import { captureQuickManageReport } from './quickmanage-report-capture';

export const QUICKMANAGE_EXPLORER_RESOURCES = [
  'trucks', 'trailers', 'drivers', 'customers', 'trips', 'users', 'reports', 'report-content', 'report-catalog',
] as const;
export type QuickManageExplorerResource = typeof QUICKMANAGE_EXPLORER_RESOURCES[number];
export type QuickManageExplorerFilter = { field: string; operator: string; value: string };
export type QuickManageExplorerInput = {
  resource: QuickManageExplorerResource;
  query?: string;
  filters?: QuickManageExplorerFilter[];
  page?: number;
  pageSize?: number;
  reportType?: string;
  reportSubtype?: string;
  id?: string;
};

export const QUICKMANAGE_REPORT_TYPES = QUICKMANAGE_FINANCIAL_REPORT_DEFINITIONS.map((entry) => entry.type);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const searchPaths: Partial<Record<QuickManageExplorerResource, string>> = {
  trucks: '/x/trucks/search', trailers: '/x/trailers/search', drivers: '/x/drivers/search',
  customers: '/x/customers/search', trips: '/x/trips/search', users: '/x/users/search',
};
const filterRules: Partial<Record<QuickManageExplorerResource, Record<string, readonly string[]>>> = {
  trucks: { id: ['eq'], unit_number: ['match'], vin: ['match'], plate_number: ['match'] },
  trailers: { id: ['eq'], unit_number: ['match'], vin: ['match'], plate_number: ['match'] },
  drivers: { id: ['eq'], first_name: ['match'], last_name: ['match'], email: ['match', 'match_phrase'], status: ['match'] },
  customers: { id: ['eq'], name: ['match'], mc_number: ['match'], type: ['match'], status: ['match'] },
  users: { id: ['eq'], first_name: ['match'], last_name: ['match'], status: ['match'], role: ['match'], email: ['match', 'match_phrase'] },
  trips: {
    id: ['eq'], number: ['eq'], ref_number: ['eq'], status: ['eq', 'in'], po_number: ['eq'], other_number: ['eq'],
    schedule_date: ['date_is_on', 'date_is_after', 'date_is_before', 'date_between'],
    delivery_date: ['date_is_on', 'date_is_after', 'date_is_before', 'date_between'],
    assigned_truck_ids: ['in'], assigned_driver_ids: ['in'], assigned_trailer_ids: ['in'],
    assigned_customer_ids: ['in'], bill_to_id: ['eq'], booked_by_id: ['eq'],
  },
};
const linkType: Partial<Record<QuickManageExplorerResource, ExternalSyncResourceType>> = {
  trucks: 'TRUCK', trailers: 'TRAILER', drivers: 'DRIVER', customers: 'CUSTOMER', trips: 'TRIP',
};
const forbiddenKey = /(authorization|access[_-]?token|refresh[_-]?token|client[_-]?(id|secret)|password|api[_-]?key|webhook[_-]?secret)/i;

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | null => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;

export function sanitizeQuickManageData(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[truncated]';
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an invalid numeric value.');
    return value;
  }
  if (typeof value === 'string') return value.length > 20_000 ? `${value.slice(0, 20_000)}…` : value;
  if (Array.isArray(value)) {
    if (value.length > 500) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an unexpectedly large response collection.');
    return value.map((entry) => sanitizeQuickManageData(entry, depth + 1));
  }
  const row = object(value);
  if (!row) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an unsupported response value.');
  return Object.fromEntries(Object.entries(row).map(([key, entry]) => [key, forbiddenKey.test(key) ? '[redacted]' : sanitizeQuickManageData(entry, depth + 1)]));
}

function validateInput(input: QuickManageExplorerInput) {
  if (!QUICKMANAGE_EXPLORER_RESOURCES.includes(input.resource)) throw new QuickManageError('MALFORMED_RESPONSE', 'Unsupported QuickManage explorer resource.');
  const page = input.page ?? 0;
  const pageSize = input.pageSize ?? 20;
  if (!Number.isInteger(page) || page < 0 || page > 10_000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new QuickManageError('MALFORMED_RESPONSE', 'Invalid QuickManage explorer pagination.');
  }
  if ((input.query?.length ?? 0) > 200 || (input.filters?.length ?? 0) > 8) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage explorer search is too large.');
  const rules = filterRules[input.resource] ?? {};
  for (const filter of input.filters ?? []) {
    if (!filter.value.trim() || filter.value.length > 250 || !rules[filter.field]?.includes(filter.operator)) {
      throw new QuickManageError('MALFORMED_RESPONSE', 'Unsupported QuickManage explorer filter.');
    }
  }
  if (input.id && !UUID.test(input.id)) throw new QuickManageError('MALFORMED_RESPONSE', 'Invalid QuickManage identifier.');
  return { page, pageSize };
}

function parseSearchEnvelope(payload: unknown, requestedPage: number, requestedPageSize: number) {
  const root = object(payload);
  const data = object(root?.data);
  if (!data || !Array.isArray(data.items) || !Number.isInteger(data.count) || !Number.isInteger(data.page) || !Number.isInteger(data.page_size) || data.page !== requestedPage) {
    throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned invalid explorer pagination.');
  }
  const ids = data.items.map((item) => object(item)?.id).filter((id): id is string => typeof id === 'string');
  if (new Set(ids).size !== ids.length) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned duplicate records on one page.');
  return {
    items: data.items.map((item) => sanitizeQuickManageData(item)) as JsonObject[],
    total: data.count as number,
    page: data.page as number,
    pageSize: data.page_size as number,
    warning: data.page_size !== requestedPageSize || data.items.length > requestedPageSize
      ? 'QuickManage did not honor the requested page size exactly.' : null,
  };
}

export class QuickManageExplorerService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly client: Pick<QuickManageClient, 'request'> = quickManageClient,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async explore(context: CompanyAuthorization, input: QuickManageExplorerInput) {
    const { page, pageSize } = validateInput(input);
    if (input.resource === 'report-catalog') return this.reportCatalog(context);
    if (input.resource === 'reports') return this.reports(context, input, page);
    if (input.resource === 'report-content') return this.reportContent(context, input);
    const path = searchPaths[input.resource];
    if (!path) throw new QuickManageError('MALFORMED_RESPONSE', 'Unsupported QuickManage explorer resource.');
    const payload = await this.client.request(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: input.query?.trim() ?? '', filters: input.filters ?? [], page, page_size: pageSize }),
    });
    const result = parseSearchEnvelope(payload, page, pageSize);
    const links = await this.links(context.companyId, input.resource, result.items);
    return { resource: input.resource, fetchedAt: this.now().toISOString(), ...result, links };
  }

  private async reports(context: CompanyAuthorization, input: QuickManageExplorerInput, page: number) {
    void context;
    if (!input.reportType || !QUICKMANAGE_REPORT_TYPES.includes(input.reportType as QuickManageReportType)) {
      throw new QuickManageError('MALFORMED_RESPONSE', 'Select a documented QuickManage report type.');
    }
    const subtype = input.reportSubtype?.trim() || 'ignore';
    if (subtype.length > 100) throw new QuickManageError('MALFORMED_RESPONSE', 'Invalid report subtype.');
    const payload = object(await this.client.request(`/x/reports?type=${encodeURIComponent(input.reportType)}&subtype=${encodeURIComponent(subtype)}&page=${page}`));
    const data = object(payload?.data);
    if (!data || !Array.isArray(data.items) || (data.has_more != null && typeof data.has_more !== 'boolean')) {
      throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an invalid report list.');
    }
    return { resource: input.resource, fetchedAt: this.now().toISOString(), items: sanitizeQuickManageData(data.items), page, pageSize: 50, total: null, hasMore: data.has_more === true, warning: null, links: {} };
  }

  private async reportContent(context: CompanyAuthorization, input: QuickManageExplorerInput) {
    void context;
    if (!input.id) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage report ID is required.');
    if (!input.reportType || !QUICKMANAGE_REPORT_TYPES.includes(input.reportType as QuickManageReportType)) {
      throw new QuickManageError('MALFORMED_RESPONSE', 'A documented QuickManage report type is required for financial audit.');
    }
    const payload = object(await this.client.request(`/x/reports/${encodeURIComponent(input.id)}/content`));
    const data = object(payload?.data);
    const content = object(data?.content);
    if (!data || !content || !Array.isArray(content.columns) || !Array.isArray(content.rows)) {
      throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned invalid report content.');
    }
    const audit = auditQuickManageReportContent(input.reportType as QuickManageReportType, data);
    const capture = captureQuickManageReport(input.reportType as QuickManageReportType, input.reportSubtype?.trim() || null, data, audit);
    const links = await this.reportRelationshipLinks(context.companyId, audit.relationshipReferences);
    return { resource: input.resource, fetchedAt: this.now().toISOString(), item: sanitizeQuickManageData(data), audit, capture, links };
  }

  private async reportCatalog(context: CompanyAuthorization) {
    void context;
    const fetchedAt = this.now().toISOString();
    const seenIds = new Set<string>();
    const items = [];
    for (const definition of QUICKMANAGE_FINANCIAL_REPORT_DEFINITIONS) {
      const payload = object(await this.client.request(`/x/reports?type=${encodeURIComponent(definition.type)}&subtype=ignore&page=0`));
      const data = object(payload?.data);
      if (!data || !Array.isArray(data.items) || (data.has_more != null && typeof data.has_more !== 'boolean')) {
        throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an invalid report catalog page.');
      }
      const reports = data.items.map((entry) => object(entry));
      if (reports.some((entry) => !entry || typeof entry.id !== 'string')) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an invalid report catalog item.');
      for (const report of reports as JsonObject[]) {
        const id = report.id as string;
        if (seenIds.has(id)) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned a duplicate report identifier.');
        seenIds.add(id);
      }
      const sorted = [...reports as JsonObject[]].sort((left, right) => String(right.created_at ?? right.updated_at ?? '').localeCompare(String(left.created_at ?? left.updated_at ?? '')));
      items.push({
        type: definition.type,
        label: definition.label,
        semantics: definition.semantics,
        sampleStatus: sorted.length ? 'SAMPLE_AVAILABLE' : 'NO_SAMPLE',
        reportCount: sorted.length,
        countIsLowerBound: data.has_more === true,
        latestReport: sorted.length ? sanitizeQuickManageData(sorted[0]) : null,
        contentAvailability: sorted.length ? 'NOT_FETCHED' : 'NOT_AVAILABLE',
        firstFetchedAt: fetchedAt,
        lastFetchedAt: fetchedAt,
        structureFingerprint: null,
        importReadiness: sorted.length ? 'DISCOVERED' : 'NOT_AVAILABLE',
        blockingReason: sorted.length ? 'Fetch and review a representative report structure.' : 'Generate a representative report manually in QuickManage.',
      });
    }
    return { resource: 'report-catalog', fetchedAt, items, page: 0, pageSize: items.length, total: items.length, hasMore: false, warning: null, links: {} };
  }

  private async reportRelationshipLinks(
    companyId: string,
    references: Array<{ resource: string; externalId: string }>,
  ) {
    const supported = references.filter((reference): reference is { resource: ExternalSyncResourceType; externalId: string } =>
      ['TRUCK', 'TRAILER', 'DRIVER', 'CUSTOMER', 'TRIP'].includes(reference.resource));
    if (!supported.length) return {};
    const links = await this.database.externalSourceLink.findMany({
      where: {
        companyId,
        provider: 'QUICKMANAGE',
        OR: supported.map((reference) => ({ resourceType: reference.resource, externalId: reference.externalId })),
      },
      select: { resourceType: true, externalId: true, truckId: true, trailerId: true, driverId: true, customerId: true, loadId: true },
    });
    return Object.fromEntries(links.map((link) => [`${link.resourceType}:${link.externalId}`, {
      linked: true,
      entityId: link.truckId ?? link.trailerId ?? link.driverId ?? link.customerId ?? link.loadId,
    }]));
  }

  private async links(companyId: string, resource: QuickManageExplorerResource, items: JsonObject[]) {
    const resourceType = linkType[resource];
    if (!resourceType) return {};
    const externalIds = items.map((item) => item.id).filter((id): id is string => typeof id === 'string');
    if (!externalIds.length) return {};
    const links = await this.database.externalSourceLink.findMany({
      where: { companyId, provider: 'QUICKMANAGE', resourceType, externalId: { in: externalIds } },
      select: { externalId: true, truckId: true, trailerId: true, driverId: true, customerId: true, loadId: true },
    });
    return Object.fromEntries(links.map((link) => [link.externalId, {
      linked: true,
      entityId: link.truckId ?? link.trailerId ?? link.driverId ?? link.customerId ?? link.loadId,
    }]));
  }
}

export const quickManageExplorerService = new QuickManageExplorerService();
