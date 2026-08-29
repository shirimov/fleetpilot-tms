import { QuickManageError, type QuickManageClient } from './quickmanage-client';

export const QUICKMANAGE_TRIP_STATUSES = [
  'upcoming', 'dispatched', 'in_transit', 'canceled', 'rejected', 'delivered',
] as const;
export type QuickManageTripStatus = typeof QUICKMANAGE_TRIP_STATUSES[number];

type QuickManageAssignment = { id: string; number?: string | null };
type QuickManageDriverAssignment = { id: string; first_name?: string | null; last_name?: string | null };

export type QuickManageTripStop = {
  id: string | null;
  pickup: boolean;
  rate: number;
  accessorials_total: number;
  distance: number;
  deadhead: number;
  company_name: string;
  address: {
    address_line_1: string | null;
    address_line_2: string | null;
    city: string;
    state: string | null;
    zip_code: string | null;
    country: string | null;
  };
  appointment_date: string | null;
  assigned_truck: QuickManageAssignment | null;
  assigned_trailer: QuickManageAssignment | null;
  assigned_drivers: QuickManageDriverAssignment[];
  assigned_customer: { id: string; customer_name?: string | null; mc_number?: string | null } | null;
};

export type QuickManageTrip = {
  id: string;
  trip_num: number;
  ref_number: string | null;
  po_number: string | null;
  other_number: string | null;
  customer_id: string | null;
  customer_name: string | null;
  remit_payment_to_name: string | null;
  shipment_type: string | null;
  hauling_rate: number;
  accessorials_total: number;
  status: QuickManageTripStatus;
  stops: QuickManageTripStop[];
  files: Array<{ id: string; name: string; type: 'other' | 'bol' | 'rate-confirmation' }>;
  created_at: string;
  schedule_date: string | null;
  delivery_date: string | null;
  booked_by: { id: string; first_name?: string | null; last_name?: string | null } | null;
};

const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
const object = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
const nullableString = (value: unknown) => typeof value === 'string' && value.trim() ? value.trim() : null;
const finiteNumber = (value: unknown, label: string) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new QuickManageError('MALFORMED_RESPONSE', `QuickManage returned invalid ${label}.`);
  return value;
};
const assignment = (value: unknown): QuickManageAssignment | null => {
  const row = object(value);
  const id = nullableString(row?.id);
  return id && id !== ZERO_UUID ? { id, number: nullableString(row?.number) } : null;
};

function parseStop(value: unknown): QuickManageTripStop {
  const row = object(value);
  const address = object(row?.address);
  if (!row || typeof row.pickup !== 'boolean' || !address || !nullableString(address.city)) {
    throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an invalid Trip stop.');
  }
  const assignedCustomer = object(row.assigned_customer);
  const customerId = nullableString(assignedCustomer?.id);
  const drivers = row.assigned_drivers == null ? [] : row.assigned_drivers;
  if (!Array.isArray(drivers)) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned invalid Trip driver assignments.');
  return {
    id: nullableString(row.id),
    pickup: row.pickup,
    rate: finiteNumber(row.rate ?? 0, 'Trip stop rate'),
    accessorials_total: finiteNumber(row.accessorials_total ?? 0, 'Trip stop accessorial total'),
    distance: finiteNumber(row.distance ?? 0, 'Trip stop distance'),
    deadhead: finiteNumber(row.deadhead ?? 0, 'Trip stop deadhead'),
    company_name: nullableString(row.company_name) ?? '',
    address: {
      address_line_1: nullableString(address.address_line_1),
      address_line_2: nullableString(address.address_line_2),
      city: String(address.city).trim(),
      state: nullableString(address.state),
      zip_code: nullableString(address.zip_code),
      country: nullableString(address.country),
    },
    appointment_date: nullableString(row.appointment_date),
    assigned_truck: assignment(row.assigned_truck),
    assigned_trailer: assignment(row.assigned_trailer),
    assigned_drivers: drivers.map((driver) => {
      const parsed = object(driver);
      const id = nullableString(parsed?.id);
      if (!id || id === ZERO_UUID) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an invalid Trip driver ID.');
      return { id, first_name: nullableString(parsed?.first_name), last_name: nullableString(parsed?.last_name) };
    }),
    assigned_customer: customerId && customerId !== ZERO_UUID ? {
      id: customerId,
      customer_name: nullableString(assignedCustomer?.customer_name),
      mc_number: nullableString(assignedCustomer?.mc_number),
    } : null,
  };
}

function parseTrip(value: unknown): QuickManageTrip {
  const row = object(value);
  const id = nullableString(row?.id);
  const status = nullableString(row?.status);
  if (!row || !id || typeof row.trip_num !== 'number' || !Number.isInteger(row.trip_num)
    || !status || !QUICKMANAGE_TRIP_STATUSES.includes(status as QuickManageTripStatus)
    || !Array.isArray(row.stops) || !Array.isArray(row.files) || !nullableString(row.created_at)) {
    throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an invalid Trip record.');
  }
  const booked = object(row.booked_by);
  return {
    id,
    trip_num: row.trip_num,
    ref_number: nullableString(row.ref_number),
    po_number: nullableString(row.po_number),
    other_number: nullableString(row.other_number),
    customer_id: nullableString(row.customer_id),
    customer_name: nullableString(row.customer_name),
    remit_payment_to_name: nullableString(row.remit_payment_to_name),
    shipment_type: nullableString(row.shipment_type),
    hauling_rate: finiteNumber(row.hauling_rate, 'Trip hauling rate'),
    accessorials_total: finiteNumber(row.accessorials_total ?? 0, 'Trip accessorial total'),
    status: status as QuickManageTripStatus,
    stops: row.stops.map(parseStop),
    files: row.files.map((file) => {
      const parsed = object(file);
      const fileId = nullableString(parsed?.id);
      const name = nullableString(parsed?.name);
      const type = nullableString(parsed?.type);
      if (!fileId || !name || !['other', 'bol', 'rate-confirmation'].includes(type ?? '')) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned invalid Trip file metadata.');
      return { id: fileId, name, type: type as 'other' | 'bol' | 'rate-confirmation' };
    }),
    created_at: String(row.created_at),
    schedule_date: nullableString(row.schedule_date),
    delivery_date: nullableString(row.delivery_date),
    booked_by: booked && nullableString(booked.id) ? { id: String(booked.id), first_name: nullableString(booked.first_name), last_name: nullableString(booked.last_name) } : null,
  };
}

export async function fetchQuickManageTrips(client: Pick<QuickManageClient, 'request'>): Promise<QuickManageTrip[]> {
  const trips = new Map<string, QuickManageTrip>();
  for (let page = 0; page < 100; page += 1) {
    const payload = object(await client.request('/x/trips/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '', filters: [], page, page_size: 100 }),
    }));
    const data = object(payload?.data);
    if (!data || !Array.isArray(data.items) || typeof data.count !== 'number' || data.page !== page || typeof data.page_size !== 'number') {
      throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned invalid Trip pagination.');
    }
    const before = trips.size;
    for (const item of data.items) {
      const trip = parseTrip(item);
      trips.set(trip.id, trip);
    }
    if (trips.size >= data.count || data.items.length === 0) return [...trips.values()];
    if (trips.size === before) throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage Trip pagination repeated records.');
  }
  throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage Trip pagination exceeded the safe limit.');
}
