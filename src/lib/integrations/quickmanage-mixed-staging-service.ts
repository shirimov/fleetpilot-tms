import { createHash } from 'node:crypto';
import { Prisma, type PrismaClient, type ExternalSyncDisposition } from '@prisma/client';
import type { CompanyAuthorization } from '@/lib/auth/authorization';
import { isValidVin, normalizeUnitNumber, normalizeVin } from '@/lib/fleet/truck-import-service';
import { prisma } from '@/lib/prisma';
import { QUICKMANAGE_PROVIDER } from './quickmanage-fleet-contract';
import { QUICKMANAGE_WEB_EQUIPMENT, validateQuickManageWebTruck, type QuickManageWebTruck } from './quickmanage-web-equipment';
import { QuickManageSyncValidationError } from './quickmanage-sync-service';

const safe = new Set<ExternalSyncDisposition>(['NEW', 'MATCHED', 'UNCHANGED']);
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
type StagedRow = { externalId:string; disposition:ExternalSyncDisposition; fleetPilotEntityId:string|null;
  candidate:Prisma.InputJsonObject; message:string; resolvedCompanyId:string|null };

export class QuickManageMixedStagingService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async stageTrucks(records: QuickManageWebTruck[], actor: CompanyAuthorization) {
    if (!['OWNER', 'ADMIN'].includes(actor.role)) throw new QuickManageSyncValidationError('Administrator access is required.');
    const unique = new Set<string>();
    const prepared = records.map(validateQuickManageWebTruck).map((source) => {
      if (unique.has(source.id)) throw new QuickManageSyncValidationError('Duplicate QuickManage truck ID in snapshot.');
      unique.add(source.id);
      const candidate = {
        unitNumber: source.unit, unitNumberNormalized: normalizeUnitNumber(source.unit),
        vin: source.vin ?? null, vinNormalized: source.vin ? normalizeVin(source.vin) : null,
        make: source.make ?? null, year: source.year ?? null,
        status: source.status.toLowerCase() === 'active' ? 'ACTIVE' : 'INACTIVE', sourceStatus: source.status,
        plateNumber: source.plateNumber ?? null, plateState: source.plateState ?? null,
        fuelType: source.fuelType ?? null, ownership: source.ownership ?? null,
        inServiceDate: source.inServiceDate ?? null,
      };
      return { source, candidate };
    });
    return this.database.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('quickmanage-web-equipment-stage'))`;
      const mappings = await tx.externalProviderAccountMapping.findMany({ where: {
        provider: QUICKMANAGE_PROVIDER, externalAccountId: { in: [...new Set(prepared.map(({ source }) => source.carrierId))] },
        identityStatus: 'VERIFIED', isEnabled: true,
      } });
      const rows: StagedRow[] = [];
      for (const item of prepared) {
        const mapping = mappings.find((entry) => entry.externalAccountId === item.source.carrierId);
        rows.push(mapping ? await this.classify(tx, item.source.id, item.candidate, mapping.companyId) : {
          externalId: item.source.id, disposition: 'UNRESOLVED_COMPANY' as const, fleetPilotEntityId: null,
          candidate: item.candidate as Prisma.InputJsonObject, message: 'No verified FleetPilot company mapping exists for this carrier.',
          resolvedCompanyId: null,
        });
      }
      const count = (d: ExternalSyncDisposition) => rows.filter((row) => row.disposition === d).length;
      return tx.externalSyncBatch.create({ data: {
        companyId: null, scope: 'ACCOUNT', sourceAdapter: QUICKMANAGE_WEB_EQUIPMENT,
        actorUserId: actor.user.id, provider: QUICKMANAGE_PROVIDER, resourceType: 'TRUCK', totalRows: rows.length,
        newRows: count('NEW'), matchedRows: count('MATCHED'), unchangedRows: count('UNCHANGED'),
        conflictRows: count('CONFLICT'), invalidRows: count('INVALID'), unresolvedCompanyRows: count('UNRESOLVED_COMPANY'),
        rows: { create: rows.map((row, index) => ({
          resourceType: 'TRUCK', externalId: row.externalId, disposition: row.disposition,
          fleetPilotEntityId: row.fleetPilotEntityId, sourceHashSha256: hash(row.candidate), candidate: row.candidate as Prisma.InputJsonValue,
          message: row.message, sourceAdapter: QUICKMANAGE_WEB_EQUIPMENT,
          externalCarrierId: prepared[index].source.carrierId, externalCarrierName: prepared[index].source.carrierName,
          resolvedCompanyId: row.resolvedCompanyId,
          mappingVerifiedAt: mappings.find((m) => m.companyId === row.resolvedCompanyId)?.verifiedAt,
        })) },
      }, include: { rows: true } });
    });
  }

  async saveMapping(input: { carrierId: string; carrierName: string; companyId: string; notes?: string }, actor: CompanyAuthorization) {
    if (!['OWNER', 'ADMIN'].includes(actor.role)) throw new QuickManageSyncValidationError('Administrator access is required.');
    const membership = await this.database.companyMembership.findUnique({ where: { userId_companyId: { userId: actor.user.id, companyId: input.companyId } } });
    if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) throw new QuickManageSyncValidationError('Destination company access is denied.');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.carrierId) || !input.carrierName.trim()) throw new QuickManageSyncValidationError('Stable carrier UUID and display name are required.');
    const existing=await this.database.externalProviderAccountMapping.findUnique({where:{provider_externalAccountId:{provider:QUICKMANAGE_PROVIDER,externalAccountId:input.carrierId}}});
    if(existing&&existing.companyId!==input.companyId){
      const existingMembership=await this.database.companyMembership.findUnique({where:{userId_companyId:{userId:actor.user.id,companyId:existing.companyId}}});
      if(!existingMembership||!['OWNER','ADMIN'].includes(existingMembership.role)) throw new QuickManageSyncValidationError('Existing carrier mapping access is denied.');
    }
    const verifiedAt = new Date();
    const mapping = await this.database.externalProviderAccountMapping.upsert({
      where: { provider_externalAccountId: { provider: QUICKMANAGE_PROVIDER, externalAccountId: input.carrierId } },
      create: { provider: QUICKMANAGE_PROVIDER, externalAccountId: input.carrierId, externalDisplayName: input.carrierName,
        companyId: input.companyId, identityStatus: 'VERIFIED', isEnabled: true, verifiedAt, verifiedByUserId: actor.user.id, notes: input.notes },
      update: { externalDisplayName: input.carrierName, companyId: input.companyId, identityStatus: 'VERIFIED', isEnabled: true,
        verifiedAt, verifiedByUserId: actor.user.id, notes: input.notes },
    });
    await this.reclassifyCarrier(input.carrierId);
    return mapping;
  }

  async discoveredCarriers(actor: CompanyAuthorization) {
    if (!['OWNER', 'ADMIN'].includes(actor.role)) throw new QuickManageSyncValidationError('Administrator access is required.');
    const rows = await this.database.externalSyncRow.findMany({ where: { sourceAdapter: QUICKMANAGE_WEB_EQUIPMENT },
      select: { externalCarrierId: true, externalCarrierName: true, resolvedCompanyId: true, disposition: true } });
    const mappings = await this.database.externalProviderAccountMapping.findMany({ where: { provider: QUICKMANAGE_PROVIDER } });
    const carriers = [...new Set(rows.map((row) => row.externalCarrierId).filter(Boolean))].map((carrierId) => {
      const carrierRows = rows.filter((row) => row.externalCarrierId === carrierId);
      const mapping = mappings.find((item) => item.externalAccountId === carrierId);
      return { carrierId, carrierName: carrierRows[0].externalCarrierName, truckCount: carrierRows.length,
        companyId: mapping?.companyId ?? null, status: mapping?.isEnabled && mapping.identityStatus === 'VERIFIED' ? 'VERIFIED' : 'UNMAPPED' };
    });
    const memberships = await this.database.companyMembership.findMany({ where: { userId:actor.user.id,role:{in:['OWNER','ADMIN']} }, include:{company:{select:{id:true,name:true}}} });
    return { carriers, companies:memberships.map(({company})=>company) };
  }

  async summary(batchId:string,actor:CompanyAuthorization){
    if(!['OWNER','ADMIN'].includes(actor.role)) throw new QuickManageSyncValidationError('Administrator access is required.');
    const batch=await this.database.externalSyncBatch.findUnique({where:{id:batchId},include:{rows:true}});
    if(!batch||batch.scope!=='ACCOUNT') throw new QuickManageSyncValidationError('Mixed-carrier preview not found.');
    const carrierIds=[...new Set(batch.rows.map(row=>row.externalCarrierId).filter((value):value is string=>!!value))];
    return {...batch,byCarrier:carrierIds.map(carrierId=>{const rows=batch.rows.filter(row=>row.externalCarrierId===carrierId);const count=(d:ExternalSyncDisposition)=>rows.filter(row=>row.disposition===d).length;return {carrierId,carrierName:rows[0].externalCarrierName,total:rows.length,mapped:rows.some(row=>!!row.resolvedCompanyId),newRows:count('NEW'),matchedRows:count('MATCHED'),unchangedRows:count('UNCHANGED'),conflictRows:count('CONFLICT'),invalidRows:count('INVALID'),unresolvedCompanyRows:count('UNRESOLVED_COMPANY')};})};
  }

  async apply(batchId: string, actor: CompanyAuthorization) {
    const batch = await this.database.externalSyncBatch.findUnique({ where: { id: batchId }, include: { rows: true } });
    if (!batch || batch.scope !== 'ACCOUNT' || batch.sourceAdapter !== QUICKMANAGE_WEB_EQUIPMENT) throw new QuickManageSyncValidationError('Mixed-carrier preview not found.');
    const companyIds = [...new Set(batch.rows.filter((r) => safe.has(r.disposition)).map((r) => r.resolvedCompanyId).filter((v): v is string => !!v))];
    for (const companyId of companyIds) {
      const membership = await this.database.companyMembership.findUnique({ where: { userId_companyId: { userId: actor.user.id, companyId } } });
      if (!membership || !['OWNER', 'ADMIN'].includes(membership.role)) throw new QuickManageSyncValidationError('Destination company access is denied.');
      await this.database.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`quickmanage-mixed-apply:${companyId}`}))`;
        const rows = await tx.externalSyncRow.findMany({ where: { batchId, resolvedCompanyId: companyId, appliedAt:null, disposition: { in: ['NEW','MATCHED','UNCHANGED'] } } });
        for (const row of rows) {
          const mapping = await tx.externalProviderAccountMapping.findUnique({ where: { provider_externalAccountId: { provider: QUICKMANAGE_PROVIDER, externalAccountId: row.externalCarrierId! } } });
          if (!mapping || !mapping.isEnabled || mapping.identityStatus !== 'VERIFIED' || mapping.companyId !== companyId
            || mapping.verifiedAt?.getTime() !== row.mappingVerifiedAt?.getTime()) throw new QuickManageSyncValidationError('Carrier mapping changed after preview. Re-preview before Apply.');
          await this.applyRow(tx, row, companyId);
        }
      });
    }
    const unsafe=batch.rows.some(row=>!safe.has(row.disposition));
    return this.database.externalSyncBatch.update({ where: { id: batchId }, data: { status: unsafe?'PARTIALLY_APPLIED':'APPLIED', appliedAt: new Date() }, include: { rows: true } });
  }

  private async reclassifyCarrier(carrierId: string) {
    const mapping = await this.database.externalProviderAccountMapping.findUnique({ where: { provider_externalAccountId: { provider: QUICKMANAGE_PROVIDER, externalAccountId: carrierId } } });
    const rows = await this.database.externalSyncRow.findMany({ where: { externalCarrierId: carrierId, sourceAdapter: QUICKMANAGE_WEB_EQUIPMENT, appliedAt: null } });
    if (!mapping || !mapping.isEnabled || mapping.identityStatus !== 'VERIFIED') return;
    await this.database.$transaction(async (tx) => {
      for (const row of rows) {
        const classified = await this.classify(tx, row.externalId, row.candidate as Prisma.InputJsonObject, mapping.companyId);
        await tx.externalSyncRow.update({ where: { id: row.id }, data: { disposition: classified.disposition,
          fleetPilotEntityId: classified.fleetPilotEntityId, resolvedCompanyId: mapping.companyId,
          mappingVerifiedAt: mapping.verifiedAt, message: classified.message } });
      }
      for (const batchId of [...new Set(rows.map((row) => row.batchId))]) await this.refreshCounts(tx, batchId);
    });
  }

  private async classify(tx: Prisma.TransactionClient, externalId: string, candidate: Prisma.InputJsonObject, companyId: string): Promise<StagedRow> {
    const vin = candidate.vinNormalized ? String(candidate.vinNormalized) : null;
    const unit = String(candidate.unitNumberNormalized);
    const link = await tx.externalSourceLink.findUnique({ where: { companyId_provider_resourceType_externalId: { companyId, provider: QUICKMANAGE_PROVIDER, resourceType: 'TRUCK', externalId } } });
    const byVin = vin ? await tx.truck.findMany({ where: { vinNormalized: vin } }) : [];
    if (byVin.some((truck) => truck.companyId !== companyId)) return { externalId, disposition: 'CONFLICT' as const, fleetPilotEntityId: null, resolvedCompanyId: companyId, candidate, message: 'VIN belongs to another FleetPilot company.' };
    const byUnit = await tx.truck.findMany({ where: { companyId, unitNumberNormalized: unit } });
    const matches = link ? await tx.truck.findMany({ where: { id: link.truckId ?? '' } }) : [...new Map([...byVin, ...byUnit].map((t) => [t.id,t])).values()];
    if (matches.length > 1) return { externalId, disposition: 'CONFLICT' as const, fleetPilotEntityId: null, resolvedCompanyId: companyId, candidate, message: 'VIN and unit identify different records.' };
    if (!matches.length) return { externalId, disposition: vin && !isValidVin(vin) ? 'INVALID' as const : 'NEW' as const, fleetPilotEntityId: null, resolvedCompanyId: companyId, candidate, message: vin && !isValidVin(vin) ? 'New equipment VIN fails FleetPilot validation.' : 'New truck.' };
    const truck = matches[0];
    const exact = normalizeUnitNumber(truck.unitNumber) === unit && (!vin || normalizeVin(truck.vin ?? '') === vin);
    return { externalId, disposition: link ? (exact ? 'UNCHANGED' as const : 'CONFLICT' as const) : (exact ? 'MATCHED' as const : 'CONFLICT' as const), fleetPilotEntityId: truck.id, resolvedCompanyId: companyId, candidate, message: exact ? 'Safe existing truck match.' : 'Existing truck differs; explicit review is required.' };
  }

  private async applyRow(tx: Prisma.TransactionClient, row: { id:string; externalId:string; externalCarrierId:string|null; externalCarrierName:string|null; disposition:ExternalSyncDisposition; fleetPilotEntityId:string|null; candidate:Prisma.JsonValue }, companyId:string) {
    const candidate = row.candidate as Record<string, unknown>;
    const current=await this.classify(tx,row.externalId,candidate as Prisma.InputJsonObject,companyId);
    if(current.disposition!==row.disposition||current.fleetPilotEntityId!==row.fleetPilotEntityId) throw new QuickManageSyncValidationError('Truck changed after preview. Re-preview before Apply.');
    let truckId = row.fleetPilotEntityId;
    if (row.disposition === 'NEW') truckId = (await tx.truck.create({ data: { companyId, unitNumber:String(candidate.unitNumber), unitNumberNormalized:String(candidate.unitNumberNormalized), vin:candidate.vin?String(candidate.vin):null, vinNormalized:candidate.vinNormalized?String(candidate.vinNormalized):null, make:candidate.make?String(candidate.make):null, year:typeof candidate.year==='number'?candidate.year:null, status:candidate.status as 'ACTIVE'|'INACTIVE' } })).id;
    if (!truckId) throw new QuickManageSyncValidationError('Safe truck match changed after preview.');
    const metadata={sourceAdapter:QUICKMANAGE_WEB_EQUIPMENT,externalCarrierId:row.externalCarrierId,externalCarrierName:row.externalCarrierName};
    const link = await tx.externalSourceLink.upsert({ where: { companyId_provider_resourceType_externalId: { companyId, provider:QUICKMANAGE_PROVIDER, resourceType:'TRUCK', externalId:row.externalId } }, create:{ companyId,provider:QUICKMANAGE_PROVIDER,resourceType:'TRUCK',externalId:row.externalId,truckId,metadata }, update:{ lastSyncedAt:new Date(),metadata } });
    await tx.externalSyncRow.update({ where:{id:row.id}, data:{ fleetPilotEntityId:truckId,externalSourceLinkId:link.id,appliedAt:new Date() } });
  }

  private async refreshCounts(tx: Prisma.TransactionClient, batchId:string) {
    const rows=await tx.externalSyncRow.findMany({where:{batchId}}); const count=(d:ExternalSyncDisposition)=>rows.filter(r=>r.disposition===d).length;
    await tx.externalSyncBatch.update({where:{id:batchId},data:{newRows:count('NEW'),matchedRows:count('MATCHED'),unchangedRows:count('UNCHANGED'),conflictRows:count('CONFLICT'),invalidRows:count('INVALID'),unresolvedCompanyRows:count('UNRESOLVED_COMPANY')}});
  }
}

export const quickManageMixedStagingService = new QuickManageMixedStagingService();
