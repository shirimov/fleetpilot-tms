import { QuickManageError, type QuickManageClient } from './quickmanage-client';

export const QUICKMANAGE_PROVIDER = 'QUICKMANAGE';
const PAGE_SIZE = 100;
const MAX_PAGES = 100;

export type QuickManageTruck = {
  id: string;
  unit: string;
  vin: string | null;
  plateNumber: string | null;
  make: string | null;
  year: number | null;
  status: string | null;
  inServiceDate: string | null;
};

export type QuickManageTrailer = QuickManageTruck;

export type QuickManageDriver = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  number: number | null;
  role: string | null;
  status: string | null;
  hiredDate: string | null;
  terminatedDate: string | null;
};

export type QuickManageCustomer = {
  id: string;
  name: string;
  mcNumber: string | null;
  type: string | null;
  status: string | null;
};

export type QuickManageFleetSnapshot = {
  trucks: QuickManageTruck[];
  trailers: QuickManageTrailer[];
  drivers: QuickManageDriver[];
  customers: QuickManageCustomer[];
};

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;
}

function string(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integer(value: unknown) {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

function parseEnvelope(payload: unknown) {
  const root = object(payload);
  const data = object(root?.data);
  if (!data || !Array.isArray(data.items) || !Number.isInteger(data.count)
    || !Number.isInteger(data.page) || !Number.isInteger(data.page_size)) {
    throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an invalid fleet search response.');
  }
  return {
    items: data.items,
    count: data.count as number,
    page: data.page as number,
    pageSize: data.page_size as number,
  };
}

function parseTruckLike(value: unknown, label: string): QuickManageTruck {
  const row = object(value);
  const id = string(row?.id);
  const unit = string(row?.unit);
  if (!row || !id || !unit) {
    throw new QuickManageError('MALFORMED_RESPONSE', `QuickManage returned an invalid ${label} record.`);
  }
  return {
    id,
    unit,
    vin: string(row.vin),
    plateNumber: string(row.plate_number),
    make: string(row.make),
    year: integer(row.year),
    status: string(row.status),
    inServiceDate: string(row.in_service_date),
  };
}

function parseDriver(value: unknown): QuickManageDriver {
  const row = object(value);
  const id = string(row?.id);
  if (!row || !id) {
    throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an invalid driver record.');
  }
  return {
    id,
    firstName: string(row.first_name),
    lastName: string(row.last_name),
    email: string(row.email),
    phone: string(row.phone),
    number: integer(row.number),
    role: string(row.role),
    status: string(row.status),
    hiredDate: string(row.hired_date),
    terminatedDate: string(row.terminated_date),
  };
}

function parseCustomer(value: unknown): QuickManageCustomer {
  const row = object(value);
  const id = string(row?.id);
  const name = string(row?.name);
  if (!row || !id || !name) {
    throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an invalid customer record.');
  }
  return {
    id,
    name,
    mcNumber: string(row.mc_number),
    type: string(row.type),
    status: string(row.status),
  };
}

async function searchAll<T>(
  client: Pick<QuickManageClient, 'request'>,
  path: string,
  parse: (value: unknown) => T,
) {
  const output: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const payload = await client.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', filters: [], page, page_size: PAGE_SIZE }),
    });
    const envelope = parseEnvelope(payload);
    if (envelope.page !== page || envelope.pageSize <= 0 || envelope.pageSize > PAGE_SIZE) {
      throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned invalid fleet pagination.');
    }
    output.push(...envelope.items.map(parse));
    if (output.length >= envelope.count || envelope.items.length === 0) return output;
  }
  throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage fleet pagination exceeded the safe limit.');
}

export async function fetchQuickManageFleetSnapshot(
  client: Pick<QuickManageClient, 'request'>,
): Promise<QuickManageFleetSnapshot> {
  const [trucks, trailers, drivers, customers] = await Promise.all([
    searchAll(client, '/x/trucks/search', (row) => parseTruckLike(row, 'truck')),
    searchAll(client, '/x/trailers/search', (row) => parseTruckLike(row, 'trailer')),
    searchAll(client, '/x/drivers/search', parseDriver),
    searchAll(client, '/x/customers/search', parseCustomer),
  ]);
  return { trucks, trailers, drivers, customers };
}
