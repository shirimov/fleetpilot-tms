import type {
  DispatchDocumentType,
  LoadStatus,
  LoadStopType,
  TrailerEquipmentType,
  TrailerStatus,
} from '@prisma/client';
import { DispatchValidationError } from './dispatch-errors';
import type {
  CustomerContactInput,
  CustomerInput,
  DispatchLoadInput,
  LoadStopInput,
  TrailerInput,
} from './dispatch-types';

const loadStatuses = new Set<LoadStatus>([
  'DRAFT', 'PLANNED', 'ASSIGNED', 'DISPATCHED', 'PICKED_UP', 'PENDING',
  'IN_TRANSIT', 'DELIVERED', 'POD_UPLOADED', 'INVOICED', 'PAID', 'CANCELLED',
]);
const trailerTypes = new Set<TrailerEquipmentType>([
  'DRY_VAN', 'REEFER', 'FLATBED', 'STEP_DECK', 'POWER_ONLY', 'OTHER',
]);
const trailerStatuses = new Set<TrailerStatus>([
  'AVAILABLE', 'ASSIGNED', 'IN_TRANSIT', 'MAINTENANCE', 'OUT_OF_SERVICE', 'INACTIVE',
]);
const stopTypes = new Set<LoadStopType>(['PICKUP', 'DELIVERY']);
export const dispatchDocumentTypes = new Set<DispatchDocumentType>([
  'RATE_CONFIRMATION', 'BOL', 'POD', 'RECEIPT', 'TRAILER_REGISTRATION',
  'TRAILER_INSURANCE', 'TRAILER_INSPECTION', 'OTHER',
]);

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DispatchValidationError('A JSON object is required.');
  }
  return value as Record<string, unknown>;
}

function string(
  value: unknown,
  name: string,
  { required = false, max = 255 }: { required?: boolean; max?: number } = {},
): string | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new DispatchValidationError(`${name} is required.`);
    return null;
  }
  if (typeof value !== 'string') {
    throw new DispatchValidationError(`${name} must be text.`);
  }
  const normalized = value.trim();
  if (!normalized && required) {
    throw new DispatchValidationError(`${name} is required.`);
  }
  if (normalized.length > max) {
    throw new DispatchValidationError(`${name} must be at most ${max} characters.`);
  }
  return normalized || null;
}

function number(value: unknown, name: string, required = false): number | null {
  if (value === undefined || value === null || value === '') {
    if (required) throw new DispatchValidationError(`${name} is required.`);
    return null;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new DispatchValidationError(`${name} must be a non-negative number.`);
  }
  return parsed;
}

function date(value: unknown, name: string): Date | null {
  if (value === undefined || value === null || value === '') return null;
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) {
    throw new DispatchValidationError(`${name} must be a valid date.`);
  }
  return parsed;
}

function enumeration<T extends string>(
  value: unknown,
  values: Set<T>,
  name: string,
  fallback?: T,
): T | undefined {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !values.has(value as T)) {
    throw new DispatchValidationError(`${name} is invalid.`);
  }
  return value as T;
}

function validateContact(value: unknown): CustomerContactInput {
  const input = object(value);
  return {
    id: string(input.id, 'Contact ID') ?? undefined,
    name: string(input.name, 'Contact name', { required: true })!,
    title: string(input.title, 'Contact title'),
    email: string(input.email, 'Contact email'),
    phone: string(input.phone, 'Contact phone'),
    notes: string(input.notes, 'Contact notes', { max: 4_000 }),
  };
}

export function validateCustomerInput(value: unknown): CustomerInput {
  const input = object(value);
  return {
    name: string(input.name, 'Customer name', { required: true })!,
    status: enumeration(input.status, new Set(['ACTIVE', 'INACTIVE']), 'Customer status', 'ACTIVE'),
    mcNumber: string(input.mcNumber, 'MC number'),
    dotNumber: string(input.dotNumber, 'DOT number'),
    email: string(input.email, 'Email'),
    phone: string(input.phone, 'Phone'),
    notes: string(input.notes, 'Notes', { max: 16_000 }),
    contacts: input.contacts === undefined
      ? undefined
      : Array.isArray(input.contacts)
        ? input.contacts.map(validateContact)
        : (() => { throw new DispatchValidationError('Contacts must be a list.'); })(),
  };
}

export function validateTrailerInput(value: unknown): TrailerInput {
  const input = object(value);
  return {
    unitNumber: string(input.unitNumber, 'Trailer unit number', { required: true })!,
    equipmentType: enumeration(input.equipmentType, trailerTypes, 'Equipment type', 'DRY_VAN'),
    status: enumeration(input.status, trailerStatuses, 'Trailer status', 'AVAILABLE'),
    vin: string(input.vin, 'VIN', { max: 17 }),
    plate: string(input.plate, 'Plate'),
    state: string(input.state, 'Plate state', { max: 32 }),
    notes: string(input.notes, 'Notes', { max: 16_000 }),
  };
}

function validateStop(value: unknown, fallbackOrder: number): LoadStopInput {
  const input = object(value);
  const appointmentStart = date(input.appointmentStart, 'Appointment start');
  const appointmentEnd = date(input.appointmentEnd, 'Appointment end');
  if (appointmentStart && appointmentEnd && appointmentEnd < appointmentStart) {
    throw new DispatchValidationError('Appointment end must not be before its start.');
  }
  return {
    id: string(input.id, 'Stop ID') ?? undefined,
    type: enumeration(input.type, stopTypes, 'Stop type') ??
      (() => { throw new DispatchValidationError('Stop type is required.'); })(),
    order: input.order === undefined
      ? fallbackOrder
      : number(input.order, 'Stop order', true)!,
    facilityName: string(input.facilityName, 'Facility name', { required: true })!,
    addressLine1: string(input.addressLine1, 'Address'),
    addressLine2: string(input.addressLine2, 'Address line 2'),
    city: string(input.city, 'City', { required: true })!,
    state: string(input.state, 'State', { max: 64 }),
    postalCode: string(input.postalCode, 'Postal code', { max: 32 }),
    country: string(input.country, 'Country', { max: 64 }) ?? 'US',
    contactId: string(input.contactId, 'Contact ID'),
    contactName: string(input.contactName, 'Contact name'),
    contactPhone: string(input.contactPhone, 'Contact phone'),
    appointmentStart,
    appointmentEnd,
    arrivedAt: date(input.arrivedAt, 'Arrival time'),
    departedAt: date(input.departedAt, 'Departure time'),
    notes: string(input.notes, 'Stop notes', { max: 16_000 }),
  };
}

export function validateLoadInput(value: unknown): DispatchLoadInput {
  const input = object(value);
  const stops = input.stops === undefined
    ? undefined
    : Array.isArray(input.stops)
      ? input.stops.map(validateStop)
      : (() => { throw new DispatchValidationError('Stops must be a list.'); })();
  if (stops) {
    const orders = stops.map(({ order }) => order);
    if (new Set(orders).size !== orders.length) {
      throw new DispatchValidationError('Stop order values must be unique.');
    }
  }
  return {
    loadNumber: string(input.loadNumber, 'Load number', { required: true })!,
    referenceNum: string(input.referenceNum, 'Reference number'),
    status: enumeration(input.status, loadStatuses, 'Load status', 'DRAFT')!,
    origin: string(input.origin, 'Origin') ?? '',
    destination: string(input.destination, 'Destination') ?? '',
    pickupDate: date(input.pickupDate, 'Pickup date'),
    deliveryDate: date(input.deliveryDate, 'Delivery date'),
    miles: number(input.miles, 'Miles'),
    rate: number(input.rate, 'Rate', true)!,
    fuelSurcharge: number(input.fuelSurcharge, 'Fuel surcharge') ?? 0,
    truckId: string(input.truckId, 'Truck ID'),
    driverId: string(input.driverId, 'Driver ID'),
    trailerId: string(input.trailerId, 'Trailer ID'),
    customerId: string(input.customerId, 'Customer ID'),
    notes: string(input.notes, 'Notes', { max: 32_000 }),
    invoiceNumber: string(input.invoiceNumber, 'Invoice number'),
    stops,
  };
}

export function validateTransitionInput(value: unknown): {
  status: LoadStatus;
  expectedUpdatedAt?: Date;
} {
  const input = object(value);
  const status = enumeration(input.status, loadStatuses, 'Load status');
  if (!status) throw new DispatchValidationError('Load status is required.');
  return {
    status,
    expectedUpdatedAt: date(input.expectedUpdatedAt, 'Expected update time') ?? undefined,
  };
}

export function validateOptionalLoadStatus(value: unknown): LoadStatus | undefined {
  return enumeration(value, loadStatuses, 'Load status');
}

export function validateId(value: unknown, name = 'ID'): string {
  return string(value, name, { required: true })!;
}
