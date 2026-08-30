import { createHash } from 'node:crypto';
import {
  Prisma,
  type ExternalSyncDisposition,
  type ExternalSyncResourceType,
  type PrismaClient,
} from '@prisma/client';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { isValidVin, normalizeUnitNumber, normalizeVin } from '@/lib/fleet/truck-import-service';
import { prisma } from '@/lib/prisma';
import { quickManageClient, type QuickManageClient } from './quickmanage-client';
import {
  fetchQuickManageTruckSnapshot,
  QUICKMANAGE_PROVIDER,
  type QuickManageTruck,
} from './quickmanage-fleet-contract';

type Candidate = Record<string, string | number | null>;
type PreviewRow = {
  resourceType: ExternalSyncResourceType;
  externalId: string;
  disposition: ExternalSyncDisposition;
  fleetPilotEntityId: string | null;
  candidate: Candidate;
  message: string | null;
};

export class QuickManageSyncValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuickManageSyncValidationError';
  }
}

function sourceHash(candidate: Candidate) {
  return createHash('sha256').update(JSON.stringify(candidate)).digest('hex');
}

function normalizedText(value: string | null) {
  return value?.trim().toUpperCase() || null;
}

function normalizedEmail(value: string | null) {
  return value?.trim().toLowerCase() || null;
}

function same(existing: string | number | null | undefined, incoming: string | number | null) {
  return incoming === null || normalizedText(String(existing ?? '')) === normalizedText(String(incoming));
}

function truckCandidate(source: QuickManageTruck): Candidate {
  const sourceStatus = source.status?.toLowerCase() ?? null;
  return {
    unitNumber: source.unit,
    unitNumberNormalized: normalizeUnitNumber(source.unit),
    vin: source.vin,
    vinNormalized: source.vin ? normalizeVin(source.vin) : null,
    make: source.make,
    year: source.year,
    status: sourceStatus === 'sold' || sourceStatus === 'total_loss' ? 'INACTIVE' : 'ACTIVE',
    sourceStatus,
    plateNumber: source.plateNumber,
    inServiceDate: source.inServiceDate,
  };
}

function linkedEntityId(link: {
  truckId: string | null;
  trailerId: string | null;
  driverId: string | null;
  customerId: string | null;
}) {
  return link.truckId ?? link.trailerId ?? link.driverId ?? link.customerId;
}

export class QuickManageSyncService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly client: Pick<QuickManageClient, 'request'> & Partial<Pick<QuickManageClient, 'isConfigured'>> = quickManageClient,
  ) {}

  async preview(resourceType: unknown, context: CompanyAuthorization) {
    if (resourceType !== 'TRUCK') {
      throw new QuickManageSyncValidationError('Only the QuickManage TRUCK resource is supported in this phase.');
    }
    const snapshot = await fetchQuickManageTruckSnapshot(this.client);
    return this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quickmanage-sync:${context.companyId}`}))`;
      const rows = await this.classify(tx, context.companyId, snapshot);
      const fleetPilotRecordCount = await tx.truck.count({ where: { companyId: context.companyId } });
      const count = (disposition: ExternalSyncDisposition) => rows.filter((row) => row.disposition === disposition).length;
      return tx.externalSyncBatch.create({
        data: {
          companyId: context.companyId,
          actorUserId: context.user.id,
          provider: QUICKMANAGE_PROVIDER,
          resourceType: 'TRUCK',
          fleetPilotRecordCount,
          totalRows: rows.length,
          newRows: count('NEW'),
          matchedRows: count('MATCHED'),
          unchangedRows: count('UNCHANGED'),
          conflictRows: count('CONFLICT'),
          invalidRows: count('INVALID'),
          rows: {
            create: rows.map((row) => ({
              resourceType: row.resourceType,
              externalId: row.externalId,
              disposition: row.disposition,
              fleetPilotEntityId: row.fleetPilotEntityId,
              sourceHashSha256: sourceHash(row.candidate),
              candidate: row.candidate as Prisma.InputJsonValue,
              message: row.message,
            })),
          },
        },
        include: { rows: { orderBy: [{ resourceType: 'asc' }, { externalId: 'asc' }] } },
      });
    }, { isolationLevel: 'Serializable' });
  }

  async get(batchId: string, context: CompanyAuthorization) {
    const batch = await this.database.externalSyncBatch.findFirst({
      where: { id: batchId, companyId: context.companyId, provider: QUICKMANAGE_PROVIDER },
      include: { rows: { orderBy: [{ resourceType: 'asc' }, { externalId: 'asc' }] } },
    });
    if (!batch) throw new QuickManageSyncValidationError('QuickManage sync preview not found.');
    return batch;
  }

  async apply(batchId: string, resourceType: unknown, context: CompanyAuthorization) {
    if (resourceType !== 'TRUCK') {
      throw new QuickManageSyncValidationError('Only the QuickManage TRUCK resource is supported in this phase.');
    }
    if (this.client.isConfigured && !this.client.isConfigured()) {
      throw new QuickManageSyncValidationError('QuickManage is not enabled for this environment. Apply is blocked.');
    }
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.applyOnce(batchId, resourceType, context);
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2034' || attempt === 2) throw error;
      }
    }
    throw new QuickManageSyncValidationError('QuickManage sync could not acquire a safe apply lock.');
  }

  private async applyOnce(batchId: string, resourceType: 'TRUCK', context: CompanyAuthorization) {
    return this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quickmanage-sync:${context.companyId}`}))`;
      const batch = await tx.externalSyncBatch.findFirst({
        where: { id: batchId, companyId: context.companyId, provider: QUICKMANAGE_PROVIDER },
        include: { rows: { orderBy: [{ resourceType: 'asc' }, { externalId: 'asc' }] } },
      });
      if (!batch) throw new QuickManageSyncValidationError('QuickManage sync preview not found.');
      if (batch.status === 'APPLIED') return batch;
      if (batch.resourceType !== resourceType || batch.rows.some((row) => row.resourceType !== resourceType)) {
        throw new QuickManageSyncValidationError('The preview resource does not match this trucks-only apply request. Create a new preview.');
      }
      const mapping = await tx.externalProviderAccountMapping.findUnique({
        where: { companyId_provider: { companyId: context.companyId, provider: QUICKMANAGE_PROVIDER } },
      });
      if (!mapping || !mapping.isEnabled || mapping.identityStatus !== 'VERIFIED'
        || !mapping.externalAccountId || !mapping.externalDisplayName || !mapping.verifiedAt || !mapping.verifiedByUserId) {
        throw new QuickManageSyncValidationError('QuickManage account identity is not verified for this FleetPilot company. Apply is blocked.');
      }

      for (const row of batch.rows.filter((item) => ['NEW', 'MATCHED', 'UNCHANGED'].includes(item.disposition))) {
        const candidate = row.candidate as Candidate;
        let entityId = row.fleetPilotEntityId;
        if (row.disposition === 'NEW') entityId = await this.createEntity(tx, row.resourceType, candidate, context.companyId);
        if (!entityId) throw new QuickManageSyncValidationError('A safe QuickManage match changed after preview. Create a new preview.');
        if (row.disposition !== 'NEW') {
          await this.verifyEntityStillMatches(tx, row.resourceType, entityId, candidate, context.companyId);
        }
        const link = await this.createOrRefreshLink(tx, row.resourceType, row.externalId, entityId, candidate, context.companyId);
        await tx.externalSyncRow.update({
          where: { id: row.id },
          data: { fleetPilotEntityId: entityId, externalSourceLinkId: link.id, appliedAt: new Date() },
        });
      }
      return tx.externalSyncBatch.update({
        where: { id: batch.id },
        data: { status: 'APPLIED', appliedAt: new Date() },
        include: { rows: { orderBy: [{ resourceType: 'asc' }, { externalId: 'asc' }] } },
      });
    }, { isolationLevel: 'Serializable' });
  }

  private async classify(
    tx: Prisma.TransactionClient,
    companyId: string,
    snapshot: Awaited<ReturnType<typeof fetchQuickManageTruckSnapshot>>,
  ): Promise<PreviewRow[]> {
    const [links, trucks] = await Promise.all([
      tx.externalSourceLink.findMany({ where: { companyId, provider: QUICKMANAGE_PROVIDER } }),
      tx.truck.findMany({ select: { id: true, companyId: true, unitNumber: true, unitNumberNormalized: true, vin: true, vinNormalized: true, make: true, year: true, status: true } }),
    ]);
    const rows: PreviewRow[] = [];

    for (const source of snapshot.trucks) {
      const candidate = truckCandidate(source);
      const link = links.find((item) => item.resourceType === 'TRUCK' && item.externalId === source.id);
      const byVin = candidate.vinNormalized ? trucks.filter((item) => (item.vinNormalized ?? (item.vin ? normalizeVin(item.vin) : null)) === candidate.vinNormalized) : [];
      const byUnit = trucks.filter((item) => item.companyId === companyId && (item.unitNumberNormalized ?? normalizeUnitNumber(item.unitNumber)) === candidate.unitNumberNormalized);
      const matches = link ? trucks.filter((item) => item.id === link.truckId) : [...new Map([...byVin, ...byUnit].map((item) => [item.id, item])).values()];
      const crossCompanyVin = byVin.some((item) => item.companyId !== companyId);
      rows.push(this.classifyTruckLike('TRUCK', source.id, candidate, matches, link ? linkedEntityId(link) : null, crossCompanyVin));
    }

    return rows;
  }

  private classifyTruckLike(
    resourceType: 'TRUCK' | 'TRAILER',
    externalId: string,
    candidate: Candidate,
    matches: Array<{ id: string; unitNumber: string; vin: string | null; make?: string | null; year?: number | null; status: string }>,
    linkedId: string | null,
    crossCompanyVin: boolean,
  ): PreviewRow {
    if (crossCompanyVin) return { resourceType, externalId, disposition: 'CONFLICT', fleetPilotEntityId: null, candidate, message: 'VIN belongs to another FleetPilot company.' };
    if (matches.length > 1) return { resourceType, externalId, disposition: 'CONFLICT', fleetPilotEntityId: null, candidate, message: 'VIN and unit identify different records.' };
    if (matches.length === 0) {
      if (candidate.vinNormalized && !isValidVin(String(candidate.vinNormalized))) {
        return { resourceType, externalId, disposition: 'INVALID', fleetPilotEntityId: null, candidate, message: 'New equipment VIN fails FleetPilot validation.' };
      }
      return { resourceType, externalId, disposition: 'NEW', fleetPilotEntityId: null, candidate, message: `New ${resourceType.toLowerCase()}.` };
    }
    const match = matches[0];
    const exact = normalizeUnitNumber(match.unitNumber) === candidate.unitNumberNormalized
      && same(match.vin ? normalizeVin(match.vin) : null, candidate.vinNormalized)
      && same(match.status, candidate.status)
      && (resourceType === 'TRAILER'
        || (same(match.make, candidate.make) && same(match.year ?? null, candidate.year)));
    return {
      resourceType,
      externalId,
      disposition: linkedId ? (exact ? 'UNCHANGED' : 'CONFLICT') : (exact ? 'MATCHED' : 'CONFLICT'),
      fleetPilotEntityId: match.id,
      candidate,
      message: exact ? `Safe existing ${resourceType.toLowerCase()} match.` : `Existing ${resourceType.toLowerCase()} differs; explicit review is required.`,
    };
  }

  private async createEntity(tx: Prisma.TransactionClient, resourceType: ExternalSyncResourceType, candidate: Candidate, companyId: string) {
    if (resourceType === 'TRUCK') {
      const collision = await tx.truck.findFirst({ where: { OR: [
        { companyId, unitNumberNormalized: String(candidate.unitNumberNormalized) },
        ...(candidate.vinNormalized ? [{ vinNormalized: String(candidate.vinNormalized) }] : []),
      ] } });
      if (collision) throw new QuickManageSyncValidationError('Truck changed after preview. Create a new preview.');
      return (await tx.truck.create({ data: {
        companyId,
        unitNumber: String(candidate.unitNumber),
        unitNumberNormalized: String(candidate.unitNumberNormalized),
        vin: candidate.vin ? String(candidate.vin) : null,
        vinNormalized: candidate.vinNormalized ? String(candidate.vinNormalized) : null,
        make: candidate.make ? String(candidate.make) : null,
        year: typeof candidate.year === 'number' ? candidate.year : null,
        status: candidate.status as 'ACTIVE' | 'INACTIVE',
      } })).id;
    }
    if (resourceType === 'TRAILER') {
      const collision = await tx.trailer.findFirst({ where: { companyId, unitNumber: String(candidate.unitNumber) } });
      if (collision) throw new QuickManageSyncValidationError('Trailer changed after preview. Create a new preview.');
      return (await tx.trailer.create({ data: {
        companyId,
        unitNumber: String(candidate.unitNumber),
        vin: candidate.vin ? String(candidate.vin) : null,
        plate: candidate.plateNumber ? String(candidate.plateNumber) : null,
        equipmentType: 'OTHER',
        status: candidate.status as 'AVAILABLE' | 'INACTIVE',
        notes: candidate.make ? `QuickManage make: ${String(candidate.make)}` : null,
      } })).id;
    }
    if (resourceType === 'CUSTOMER') {
      return (await tx.customer.create({ data: {
        companyId,
        name: String(candidate.name),
        mcNumber: candidate.mcNumber ? String(candidate.mcNumber) : null,
        status: 'ACTIVE',
      } })).id;
    }
    throw new QuickManageSyncValidationError('QuickManage Driver creation requires an explicit FleetPilot pay configuration.');
  }

  private async createOrRefreshLink(
    tx: Prisma.TransactionClient,
    resourceType: ExternalSyncResourceType,
    externalId: string,
    entityId: string,
    candidate: Candidate,
    companyId: string,
  ) {
    const target = resourceType === 'TRUCK' ? { truckId: entityId }
      : resourceType === 'TRAILER' ? { trailerId: entityId }
        : resourceType === 'DRIVER' ? { driverId: entityId }
          : { customerId: entityId };
    return tx.externalSourceLink.upsert({
      where: { companyId_provider_resourceType_externalId: { companyId, provider: QUICKMANAGE_PROVIDER, resourceType, externalId } },
      create: {
        companyId,
        provider: QUICKMANAGE_PROVIDER,
        resourceType,
        externalId,
        ...target,
        lastSyncedAt: new Date(),
        metadata: { sourceStatus: candidate.sourceStatus },
      },
      update: { lastSyncedAt: new Date(), metadata: { sourceStatus: candidate.sourceStatus } },
    });
  }

  private async verifyEntityStillMatches(
    tx: Prisma.TransactionClient,
    resourceType: ExternalSyncResourceType,
    entityId: string,
    candidate: Candidate,
    companyId: string,
  ) {
    if (resourceType === 'TRUCK') {
      const entity = await tx.truck.findFirst({ where: { id: entityId, companyId } });
      if (!entity || normalizeUnitNumber(entity.unitNumber) !== candidate.unitNumberNormalized
        || !same(entity.vin ? normalizeVin(entity.vin) : null, candidate.vinNormalized)
        || !same(entity.make, candidate.make) || !same(entity.year, candidate.year)
        || !same(entity.status, candidate.status)) {
        throw new QuickManageSyncValidationError('Truck changed after preview. Create a new preview.');
      }
      return;
    }
    if (resourceType === 'TRAILER') {
      const entity = await tx.trailer.findFirst({ where: { id: entityId, companyId } });
      if (!entity || normalizeUnitNumber(entity.unitNumber) !== candidate.unitNumberNormalized
        || !same(entity.vin ? normalizeVin(entity.vin) : null, candidate.vinNormalized)
        || !same(entity.status, candidate.status)) {
        throw new QuickManageSyncValidationError('Trailer changed after preview. Create a new preview.');
      }
      return;
    }
    if (resourceType === 'DRIVER') {
      const entity = await tx.driver.findFirst({ where: { id: entityId, companyId } });
      if (!entity || !same(entity.firstName, candidate.firstName) || !same(entity.lastName, candidate.lastName)
        || !same(normalizedEmail(entity.email), candidate.email) || !same(entity.phone, candidate.phone)) {
        throw new QuickManageSyncValidationError('Driver changed after preview. Create a new preview.');
      }
      return;
    }
    const entity = await tx.customer.findFirst({ where: { id: entityId, companyId } });
    if (!entity || !same(entity.name, candidate.name) || !same(entity.mcNumber, candidate.mcNumber)
      || !same(entity.status, candidate.status)) {
      throw new QuickManageSyncValidationError('Customer changed after preview. Create a new preview.');
    }
  }
}

export const quickManageSyncService = new QuickManageSyncService();
