import { createHash } from 'node:crypto';
import { Prisma, type LoadStatus, type PrismaClient } from '@prisma/client';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { prisma } from '@/lib/prisma';
import { quickManageClient, type QuickManageClient } from './quickmanage-client';
import { QUICKMANAGE_PROVIDER } from './quickmanage-fleet-contract';
import { fetchQuickManageTrips, type QuickManageTrip, type QuickManageTripStatus } from './quickmanage-trip-contract';
import { QuickManageSyncValidationError } from './quickmanage-sync-service';

type JsonRecord = Record<string, Prisma.JsonValue>;
type TripDisposition = 'NEW' | 'MATCHED' | 'UNCHANGED' | 'CONFLICT' | 'INVALID';
type PreviewTrip = { externalId: string; disposition: TripDisposition; fleetPilotEntityId: string | null; candidate: JsonRecord; message: string | null };

const STATUS_MAP: Record<QuickManageTripStatus, LoadStatus> = {
  upcoming: 'PLANNED', dispatched: 'DISPATCHED', in_transit: 'IN_TRANSIT',
  canceled: 'CANCELLED', rejected: 'CANCELLED', delivered: 'DELIVERED',
};

function minorUnits(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) throw new QuickManageSyncValidationError(`${label} must be a non-negative finite amount.`);
  const scaled = value * 100;
  if (!Number.isSafeInteger(Math.round(scaled)) || Math.abs(scaled - Math.round(scaled)) > 1e-7) {
    throw new QuickManageSyncValidationError(`${label} has unsupported sub-cent precision.`);
  }
  return Math.round(scaled);
}

function unique(values: Array<string | null | undefined>) { return [...new Set(values.filter((value): value is string => Boolean(value)))]; }
function hash(candidate: JsonRecord) { return createHash('sha256').update(JSON.stringify(candidate)).digest('hex'); }
function isWriteConflict(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) return error.code === 'P2034';
  return Boolean(error && typeof error === 'object' && (error as { cause?: { kind?: string } }).cause?.kind === 'TransactionWriteConflict');
}
function date(value: string | null, label: string) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new QuickManageSyncValidationError(`${label} is invalid.`);
  return parsed.toISOString();
}

function candidateFrom(trip: QuickManageTrip): JsonRecord {
  const pickups = trip.stops.filter((stop) => stop.pickup);
  const deliveries = trip.stops.filter((stop) => !stop.pickup);
  if (!pickups.length || !deliveries.length) throw new QuickManageSyncValidationError('Trip must include at least one pickup and delivery stop.');
  const truckExternalIds = unique(trip.stops.map((stop) => stop.assigned_truck?.id));
  const trailerExternalIds = unique(trip.stops.map((stop) => stop.assigned_trailer?.id));
  const driverExternalIds = unique(trip.stops.flatMap((stop) => stop.assigned_drivers.map((driver) => driver.id)));
  const customerExternalIds = unique([trip.customer_id, ...trip.stops.map((stop) => stop.assigned_customer?.id)]);
  return {
    tripNumber: trip.trip_num,
    referenceNumber: trip.ref_number,
    poNumber: trip.po_number,
    otherNumber: trip.other_number,
    sourceStatus: trip.status,
    mappedStatus: STATUS_MAP[trip.status],
    haulingRateMinor: minorUnits(trip.hauling_rate, 'Trip hauling rate'),
    accessorialsMinor: minorUnits(trip.accessorials_total, 'Trip accessorial total'),
    scheduleDate: date(trip.schedule_date, 'Trip schedule date'),
    deliveryDate: date(trip.delivery_date, 'Trip delivery date'),
    sourceCreatedAt: date(trip.created_at, 'Trip creation timestamp'),
    truckExternalIds,
    trailerExternalIds,
    driverExternalIds,
    customerExternalIds,
    files: trip.files as unknown as Prisma.JsonArray,
    stops: trip.stops.map((stop, index) => ({
      sourceId: stop.id, order: index, type: stop.pickup ? 'PICKUP' : 'DELIVERY', facilityName: stop.company_name || 'QuickManage stop',
      addressLine1: stop.address.address_line_1, addressLine2: stop.address.address_line_2, city: stop.address.city,
      state: stop.address.state, postalCode: stop.address.zip_code, country: stop.address.country || 'US',
      appointment: date(stop.appointment_date, 'Trip stop appointment'), distance: stop.distance, deadhead: stop.deadhead,
      rateMinor: minorUnits(stop.rate, 'Trip stop rate'), accessorialsMinor: minorUnits(stop.accessorials_total, 'Trip stop accessorial total'),
    })) as unknown as Prisma.JsonArray,
  };
}

export class QuickManageTripSyncService {
  constructor(private readonly database: PrismaClient = prisma, private readonly client: Pick<QuickManageClient, 'request'> = quickManageClient) {}

  async preview(context: CompanyAuthorization) {
    const trips = await fetchQuickManageTrips(this.client);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { return await this.persistPreview(context, trips); } catch (error) {
        if (!isWriteConflict(error) || attempt === 4) throw error;
      }
    }
    throw new QuickManageSyncValidationError('QuickManage Trip preview could not acquire a safe lock.');
  }

  private async persistPreview(context: CompanyAuthorization, trips: QuickManageTrip[]) {
    return this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quickmanage-trip-sync:${context.companyId}`}))`;
      const rows: PreviewTrip[] = [];
      for (const trip of trips) rows.push(await this.classify(tx, context.companyId, trip));
      const count = (value: TripDisposition) => rows.filter((row) => row.disposition === value).length;
      return tx.externalSyncBatch.create({ data: {
        companyId: context.companyId, actorUserId: context.user.id, provider: QUICKMANAGE_PROVIDER,
        totalRows: rows.length, newRows: count('NEW'), matchedRows: count('MATCHED'), unchangedRows: count('UNCHANGED'), conflictRows: count('CONFLICT'), invalidRows: count('INVALID'),
        rows: { create: rows.map((row) => ({ resourceType: 'TRIP', externalId: row.externalId, disposition: row.disposition, fleetPilotEntityId: row.fleetPilotEntityId, sourceHashSha256: hash(row.candidate), candidate: row.candidate, message: row.message })) },
      }, include: { rows: { orderBy: { externalId: 'asc' } } } });
    }, { isolationLevel: 'ReadCommitted' });
  }

  async get(batchId: string, context: CompanyAuthorization) {
    const batch = await this.database.externalSyncBatch.findFirst({ where: { id: batchId, companyId: context.companyId, provider: QUICKMANAGE_PROVIDER, rows: { every: { resourceType: 'TRIP' } } }, include: { rows: { orderBy: { externalId: 'asc' } } } });
    if (!batch) throw new QuickManageSyncValidationError('QuickManage Trip preview not found.');
    return batch;
  }

  async apply(batchId: string, context: CompanyAuthorization) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try { return await this.applyOnce(batchId, context); } catch (error) {
        if (!isWriteConflict(error) || attempt === 4) throw error;
      }
    }
    throw new QuickManageSyncValidationError('QuickManage Trip apply could not acquire a safe lock.');
  }

  private async classify(tx: Prisma.TransactionClient, companyId: string, trip: QuickManageTrip): Promise<PreviewTrip> {
    let candidate: JsonRecord;
    try { candidate = candidateFrom(trip); } catch (error) {
      return { externalId: trip.id, disposition: 'INVALID', fleetPilotEntityId: null, candidate: { sourceStatus: trip.status }, message: error instanceof Error ? error.message : 'Invalid Trip.' };
    }
    const relationshipError = await this.relationshipError(tx, companyId, candidate);
    if (relationshipError) return { externalId: trip.id, disposition: 'INVALID', fleetPilotEntityId: null, candidate, message: relationshipError };
    const link = await tx.externalSourceLink.findUnique({ where: { companyId_provider_resourceType_externalId: { companyId, provider: QUICKMANAGE_PROVIDER, resourceType: 'TRIP', externalId: trip.id } } });
    const referenceNumber = candidate.referenceNumber as string | null;
    const matches = link?.loadId ? await tx.load.findMany({ where: { id: link.loadId, companyId } })
      : referenceNumber ? await tx.load.findMany({ where: { companyId, referenceNum: referenceNumber } }) : [];
    if (matches.length > 1) return { externalId: trip.id, disposition: 'CONFLICT', fleetPilotEntityId: null, candidate, message: 'Trip reference number is ambiguous in FleetPilot.' };
    if (!matches.length) return { externalId: trip.id, disposition: 'NEW', fleetPilotEntityId: null, candidate, message: 'New Trip.' };
    const load = matches[0];
    const exact = await this.loadMatches(tx, load.id, candidate, companyId);
    return { externalId: trip.id, disposition: exact ? (link ? 'UNCHANGED' : 'MATCHED') : 'CONFLICT', fleetPilotEntityId: load.id, candidate, message: exact ? 'Safe existing Trip match.' : 'Existing Load differs; explicit review is required.' };
  }

  private async relationshipError(tx: Prisma.TransactionClient, companyId: string, candidate: JsonRecord) {
    const specs = [['truckExternalIds', 'TRUCK'], ['trailerExternalIds', 'TRAILER'], ['driverExternalIds', 'DRIVER'], ['customerExternalIds', 'CUSTOMER']] as const;
    for (const [field, resourceType] of specs) {
      const ids = candidate[field] as string[];
      if (ids.length > 1) return `Trip has multiple ${resourceType.toLowerCase()} assignments that FleetPilot cannot represent safely.`;
      if (!ids.length) continue;
      const count = await tx.externalSourceLink.count({ where: { companyId, provider: QUICKMANAGE_PROVIDER, resourceType, externalId: { in: ids } } });
      if (count !== ids.length) return `Trip references an unsynchronized QuickManage ${resourceType.toLowerCase()}.`;
    }
    return null;
  }

  private async resolvedIds(tx: Prisma.TransactionClient, companyId: string, candidate: JsonRecord) {
    const links = await tx.externalSourceLink.findMany({ where: { companyId, provider: QUICKMANAGE_PROVIDER, OR: [
      { resourceType: 'TRUCK', externalId: { in: candidate.truckExternalIds as string[] } },
      { resourceType: 'TRAILER', externalId: { in: candidate.trailerExternalIds as string[] } },
      { resourceType: 'DRIVER', externalId: { in: candidate.driverExternalIds as string[] } },
      { resourceType: 'CUSTOMER', externalId: { in: candidate.customerExternalIds as string[] } },
    ] } });
    return { truckId: links.find((x) => x.resourceType === 'TRUCK')?.truckId ?? null, trailerId: links.find((x) => x.resourceType === 'TRAILER')?.trailerId ?? null, driverId: links.find((x) => x.resourceType === 'DRIVER')?.driverId ?? null, customerId: links.find((x) => x.resourceType === 'CUSTOMER')?.customerId ?? null };
  }

  private async loadMatches(tx: Prisma.TransactionClient, loadId: string, candidate: JsonRecord, companyId: string) {
    const load = await tx.load.findFirst({ where: { id: loadId, companyId }, include: { stops: { orderBy: { order: 'asc' } } } });
    if (!load) return false;
    const ids = await this.resolvedIds(tx, companyId, candidate);
    const stops = candidate.stops as Array<Record<string, Prisma.JsonValue>>;
    return load.referenceNum === candidate.referenceNumber && load.status === candidate.mappedStatus
      && Math.round(load.rate * 100) === candidate.haulingRateMinor && load.truckId === ids.truckId && load.trailerId === ids.trailerId && load.driverId === ids.driverId && load.customerId === ids.customerId
      && load.stops.length === stops.length && load.stops.every((stop, index) => stop.type === stops[index].type && stop.city === stops[index].city && stop.appointmentStart?.toISOString() === (stops[index].appointment ?? null));
  }

  private async applyOnce(batchId: string, context: CompanyAuthorization) {
    return this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quickmanage-trip-sync:${context.companyId}`}))`;
      const batch = await tx.externalSyncBatch.findFirst({ where: { id: batchId, companyId: context.companyId, provider: QUICKMANAGE_PROVIDER, rows: { every: { resourceType: 'TRIP' } } }, include: { rows: true } });
      if (!batch) throw new QuickManageSyncValidationError('QuickManage Trip preview not found.');
      if (batch.status === 'APPLIED') return batch;
      for (const row of batch.rows.filter((x) => ['NEW', 'MATCHED', 'UNCHANGED'].includes(x.disposition))) {
        const candidate = row.candidate as JsonRecord;
        if (await this.relationshipError(tx, context.companyId, candidate)) throw new QuickManageSyncValidationError('Trip relationships changed after preview. Create a new preview.');
        let loadId = row.fleetPilotEntityId;
        if (row.disposition === 'NEW') loadId = await this.createLoad(tx, context, row.externalId, candidate);
        if (!loadId || (row.disposition !== 'NEW' && !(await this.loadMatches(tx, loadId, candidate, context.companyId)))) throw new QuickManageSyncValidationError('Trip changed after preview. Create a new preview.');
        const link = await tx.externalSourceLink.upsert({ where: { companyId_provider_resourceType_externalId: { companyId: context.companyId, provider: QUICKMANAGE_PROVIDER, resourceType: 'TRIP', externalId: row.externalId } }, create: { companyId: context.companyId, provider: QUICKMANAGE_PROVIDER, resourceType: 'TRIP', externalId: row.externalId, loadId, sourceCreatedAt: new Date(String(candidate.sourceCreatedAt)), metadata: { sourceStatus: candidate.sourceStatus, accessorialsMinor: candidate.accessorialsMinor, files: candidate.files } }, update: { lastSyncedAt: new Date(), metadata: { sourceStatus: candidate.sourceStatus, accessorialsMinor: candidate.accessorialsMinor, files: candidate.files } } });
        await tx.externalSyncRow.update({ where: { id: row.id }, data: { fleetPilotEntityId: loadId, externalSourceLinkId: link.id, appliedAt: new Date() } });
      }
      return tx.externalSyncBatch.update({ where: { id: batch.id }, data: { status: 'APPLIED', appliedAt: new Date() }, include: { rows: { orderBy: { externalId: 'asc' } } } });
    }, { isolationLevel: 'ReadCommitted' });
  }

  private async createLoad(tx: Prisma.TransactionClient, context: CompanyAuthorization, externalId: string, candidate: JsonRecord) {
    const ids = await this.resolvedIds(tx, context.companyId, candidate);
    const baseNumber = candidate.referenceNumber ? String(candidate.referenceNumber) : `QM-${String(candidate.tripNumber)}`;
    if (await tx.load.findUnique({ where: { loadNumber: baseNumber } })) throw new QuickManageSyncValidationError('Trip load number conflicts with an existing FleetPilot Load.');
    const stops = candidate.stops as Array<Record<string, Prisma.JsonValue>>;
    const created = await tx.load.create({ data: {
      companyId: context.companyId, loadNumber: baseNumber, referenceNum: candidate.referenceNumber as string | null,
      status: candidate.mappedStatus as LoadStatus, origin: String(stops[0].city), destination: String(stops[stops.length - 1].city),
      pickupDate: candidate.scheduleDate ? new Date(String(candidate.scheduleDate)) : null, deliveryDate: candidate.deliveryDate ? new Date(String(candidate.deliveryDate)) : null,
      miles: stops.reduce((sum, stop) => sum + Number(stop.distance ?? 0), 0), rate: Number(candidate.haulingRateMinor) / 100,
      truckId: ids.truckId, trailerId: ids.trailerId, driverId: ids.driverId, customerId: ids.customerId,
      notes: `Imported from QuickManage Trip ${String(candidate.tripNumber)}. Source status: ${String(candidate.sourceStatus)}.`,
      stops: { create: stops.map((stop) => ({ type: stop.type as 'PICKUP' | 'DELIVERY', order: Number(stop.order), facilityName: String(stop.facilityName), addressLine1: stop.addressLine1 as string | null, addressLine2: stop.addressLine2 as string | null, city: String(stop.city), state: stop.state as string | null, postalCode: stop.postalCode as string | null, country: String(stop.country), appointmentStart: stop.appointment ? new Date(String(stop.appointment)) : null })) },
      activities: { create: { companyId: context.companyId, loadNumber: baseNumber, action: 'LOAD_CREATED', actorUserId: context.user.id, metadata: { source: QUICKMANAGE_PROVIDER, externalId } } },
    } });
    return created.id;
  }
}

export const quickManageTripSyncService = new QuickManageTripSyncService();
export { STATUS_MAP as QUICKMANAGE_TRIP_STATUS_MAP, minorUnits as quickManageMoneyToMinorUnits };
