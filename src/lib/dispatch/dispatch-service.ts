import type {
  LoadActivityAction,
  LoadStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  DispatchConflictError,
  DispatchResourceNotFoundError,
  DispatchValidationError,
} from './dispatch-errors';
import type {
  CustomerInput,
  DispatchActor,
  DispatchDocumentInput,
  DispatchLoadInput,
  TrailerInput,
} from './dispatch-types';
import {
  dispatchDocumentStorage,
  type DispatchDocumentStorage,
} from './dispatch-storage';

const boardStatuses: LoadStatus[] = [
  'DRAFT',
  'PLANNED',
  'ASSIGNED',
  'DISPATCHED',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'POD_UPLOADED',
  'INVOICED',
  'PAID',
];

const activeAssignmentStatuses: LoadStatus[] = [
  'ASSIGNED',
  'DISPATCHED',
  'PICKED_UP',
  'IN_TRANSIT',
];

const transitions: Record<LoadStatus, LoadStatus[]> = {
  DRAFT: ['PLANNED', 'CANCELLED'],
  PENDING: ['PLANNED', 'CANCELLED'],
  PLANNED: ['ASSIGNED', 'CANCELLED'],
  ASSIGNED: ['DISPATCHED', 'PLANNED', 'CANCELLED'],
  DISPATCHED: ['PICKED_UP', 'ASSIGNED', 'CANCELLED'],
  PICKED_UP: ['IN_TRANSIT'],
  IN_TRANSIT: ['DELIVERED'],
  DELIVERED: ['POD_UPLOADED'],
  POD_UPLOADED: ['INVOICED'],
  INVOICED: ['PAID'],
  PAID: [],
  CANCELLED: ['DRAFT'],
};

const loadInclude = {
  truck: true,
  driver: true,
  trailer: true,
  customer: { include: { contacts: { orderBy: { name: 'asc' as const } } } },
  stops: { orderBy: [{ order: 'asc' as const }, { id: 'asc' as const }] },
  documents: {
    orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
    select: {
      id: true,
      type: true,
      displayFilename: true,
      mimeType: true,
      byteSize: true,
      createdAt: true,
      uploaderUser: { select: { id: true, displayName: true } },
    },
  },
  settlement: true,
} satisfies Prisma.LoadInclude;

type Transaction = Prisma.TransactionClient;

function withoutClientId<T extends { id?: string }>(value: T): Omit<T, 'id'> {
  const { id, ...persisted } = value;
  void id;
  return persisted;
}

export class DispatchService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly storage: DispatchDocumentStorage = dispatchDocumentStorage,
  ) {}

  async getCustomers(companyId: string, query = '') {
    return this.database.customer.findMany({
      where: {
        companyId,
        ...(query
          ? {
              OR: [
                { name: { contains: query, mode: 'insensitive' } },
                { mcNumber: { contains: query, mode: 'insensitive' } },
                { dotNumber: { contains: query, mode: 'insensitive' } },
                { contacts: { some: { name: { contains: query, mode: 'insensitive' } } } },
              ],
            }
          : {}),
      },
      include: { contacts: { orderBy: [{ name: 'asc' }, { id: 'asc' }] } },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: 100,
    });
  }

  async createCustomer(input: CustomerInput, actor: DispatchActor) {
    return this.database.customer.create({
      data: {
        companyId: actor.companyId,
        name: input.name,
        status: input.status,
        mcNumber: input.mcNumber,
        dotNumber: input.dotNumber,
        email: input.email,
        phone: input.phone,
        notes: input.notes,
        contacts: input.contacts?.length
          ? { create: input.contacts.map(withoutClientId) }
          : undefined,
      },
      include: { contacts: { orderBy: [{ name: 'asc' }, { id: 'asc' }] } },
    });
  }

  async updateCustomer(customerId: string, input: CustomerInput, actor: DispatchActor) {
    return this.database.$transaction(async (transaction) => {
      await this.requireCustomer(transaction, customerId, actor.companyId);
      if (input.contacts !== undefined) {
        await transaction.customerContact.deleteMany({ where: { customerId } });
      }
      return transaction.customer.update({
        where: { id: customerId, companyId: actor.companyId },
        data: {
          name: input.name,
          status: input.status,
          mcNumber: input.mcNumber,
          dotNumber: input.dotNumber,
          email: input.email,
          phone: input.phone,
          notes: input.notes,
          contacts: input.contacts
            ? { create: input.contacts.map(withoutClientId) }
            : undefined,
        },
        include: { contacts: { orderBy: [{ name: 'asc' }, { id: 'asc' }] } },
      });
    });
  }

  async deleteCustomer(customerId: string, actor: DispatchActor) {
    await this.requireCustomer(this.database, customerId, actor.companyId);
    await this.database.customer.delete({
      where: { id: customerId, companyId: actor.companyId },
    });
  }

  async getTrailers(companyId: string, query = '') {
    const trailers = await this.database.trailer.findMany({
      where: {
        companyId,
        ...(query
          ? {
              OR: [
                { unitNumber: { contains: query, mode: 'insensitive' } },
                { vin: { contains: query, mode: 'insensitive' } },
                { plate: { contains: query, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        documents: {
          select: {
            id: true,
            type: true,
            displayFilename: true,
            mimeType: true,
            byteSize: true,
            expiresAt: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        },
        loads: {
          where: { status: { in: activeAssignmentStatuses } },
          select: { id: true, loadNumber: true, status: true },
          take: 1,
        },
      },
      orderBy: [{ unitNumber: 'asc' }, { id: 'asc' }],
      take: 100,
    });
    return trailers.map((trailer) => ({
      ...trailer,
      assignment: trailer.loads[0] ?? null,
      loads: undefined,
    }));
  }

  async createTrailer(input: TrailerInput, actor: DispatchActor) {
    return this.database.trailer.create({
      data: { ...input, companyId: actor.companyId },
    });
  }

  async updateTrailer(trailerId: string, input: TrailerInput, actor: DispatchActor) {
    await this.requireTrailer(this.database, trailerId, actor.companyId);
    if (
      ['MAINTENANCE', 'OUT_OF_SERVICE', 'INACTIVE'].includes(input.status ?? '') &&
      await this.database.load.count({
        where: { trailerId, status: { in: activeAssignmentStatuses } },
      })
    ) {
      throw new DispatchConflictError(
        'An assigned trailer cannot be made unavailable.',
      );
    }
    return this.database.trailer.update({
      where: { id: trailerId, companyId: actor.companyId },
      data: input,
    });
  }

  async deleteTrailer(trailerId: string, actor: DispatchActor) {
    await this.requireTrailer(this.database, trailerId, actor.companyId);
    if (await this.database.load.count({ where: { trailerId } })) {
      throw new DispatchConflictError(
        'A trailer with load history cannot be deleted; mark it inactive.',
      );
    }
    await this.database.trailer.delete({
      where: { id: trailerId, companyId: actor.companyId },
    });
  }

  async getLoads(
    companyId: string,
    filters: { query?: string; status?: LoadStatus; exception?: string } = {},
  ) {
    const loads = await this.database.load.findMany({
      where: {
        companyId,
        ...(filters.status ? { status: filters.status } : {}),
        ...(filters.query
          ? {
              OR: [
                { loadNumber: { contains: filters.query, mode: 'insensitive' } },
                { referenceNum: { contains: filters.query, mode: 'insensitive' } },
                { origin: { contains: filters.query, mode: 'insensitive' } },
                { destination: { contains: filters.query, mode: 'insensitive' } },
                { customer: { name: { contains: filters.query, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: loadInclude,
      orderBy: [{ pickupDate: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
      take: 250,
    });
    return filters.exception
      ? loads.filter((load) => this.exceptionsFor(load).includes(filters.exception!))
      : loads;
  }

  async getDispatchBoard(companyId: string, query = '', exception = '') {
    const loads = await this.getLoads(companyId, {
      query,
      exception: exception || undefined,
    });
    return {
      columns: boardStatuses.map((status) => ({
        status,
        loads: loads
          .filter((load) => load.status === status || (status === 'DRAFT' && load.status === 'PENDING'))
          .map((load) => ({ ...load, exceptions: this.exceptionsFor(load) })),
      })),
    };
  }

  async createLoad(input: DispatchLoadInput, actor: DispatchActor) {
    return this.database.$transaction(
      async (transaction) => {
        const normalized = await this.normalizeAndValidateLoad(
          transaction,
          input,
          actor.companyId,
        );
        if (normalized.status !== 'DRAFT' && normalized.status !== 'PENDING') {
          this.assertTransition('DRAFT', normalized.status);
        }
        await this.validateAssignmentConflict(transaction, normalized, actor.companyId);
        const load = await transaction.load.create({
          data: {
            ...this.loadData(normalized),
            companyId: actor.companyId,
            stops: normalized.stops?.length
              ? { create: normalized.stops.map(withoutClientId) }
              : undefined,
          },
          include: loadInclude,
        });
        await this.recordActivity(transaction, load, actor, 'LOAD_CREATED', {
          status: load.status,
        });
        if (load.stops.length) {
          await this.recordActivity(transaction, load, actor, 'STOP_CREATED', {
            count: load.stops.length,
          });
        }
        return load;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async updateLoad(loadId: string, input: DispatchLoadInput, actor: DispatchActor) {
    return this.database.$transaction(
      async (transaction) => {
        const existing = await this.requireLoad(transaction, loadId, actor.companyId);
        const normalized = await this.normalizeAndValidateLoad(
          transaction,
          input,
          actor.companyId,
        );
        if (normalized.status !== existing.status) {
          this.assertTransition(existing.status, normalized.status);
          await this.assertStatusRequirements(transaction, existing.id, normalized);
        }
        await this.validateAssignmentConflict(
          transaction,
          normalized,
          actor.companyId,
          loadId,
        );
        if (normalized.stops !== undefined) {
          await transaction.loadStop.deleteMany({ where: { loadId } });
        }
        const load = await transaction.load.update({
          where: { id: loadId, companyId: actor.companyId },
          data: {
            ...this.loadData(normalized),
            stops: normalized.stops
              ? { create: normalized.stops.map(withoutClientId) }
              : undefined,
          },
          include: loadInclude,
        });
        if (
          existing.truckId !== load.truckId ||
          existing.driverId !== load.driverId ||
          existing.trailerId !== load.trailerId
        ) {
          await this.recordActivity(transaction, load, actor, 'ASSIGNMENT_CHANGED', {
            truckId: load.truckId,
            driverId: load.driverId,
            trailerId: load.trailerId,
          });
        }
        if (existing.status !== load.status) {
          await this.recordActivity(transaction, load, actor, 'STATUS_CHANGED', {
            from: existing.status,
            to: load.status,
          });
        } else {
          await this.recordActivity(transaction, load, actor, 'LOAD_UPDATED');
        }
        if (normalized.stops !== undefined) {
          await this.recordActivity(transaction, load, actor, 'STOP_UPDATED', {
            count: load.stops.length,
          });
        }
        return load;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async transitionLoad(
    loadId: string,
    nextStatus: LoadStatus,
    actor: DispatchActor,
    expectedUpdatedAt?: Date,
  ) {
    return this.database.$transaction(
      async (transaction) => {
        const existing = await this.requireLoad(transaction, loadId, actor.companyId);
        if (
          expectedUpdatedAt &&
          expectedUpdatedAt.getTime() !== existing.updatedAt.getTime()
        ) {
          throw new DispatchConflictError('The load changed after the board was loaded.');
        }
        if (existing.status === nextStatus) {
          return transaction.load.findUniqueOrThrow({
            where: { id: loadId },
            include: loadInclude,
          });
        }
        this.assertTransition(existing.status, nextStatus);
        await this.assertStatusRequirements(transaction, loadId, {
          ...existing,
          status: nextStatus,
        });
        await this.validateAssignmentConflict(
          transaction,
          { ...existing, status: nextStatus },
          actor.companyId,
          loadId,
        );
        const load = await transaction.load.update({
          where: { id: loadId, companyId: actor.companyId },
          data: { status: nextStatus },
          include: loadInclude,
        });
        await this.recordActivity(transaction, load, actor, 'STATUS_CHANGED', {
          from: existing.status,
          to: nextStatus,
        });
        return load;
      },
      { isolationLevel: 'Serializable' },
    );
  }

  async deleteLoad(loadId: string, actor: DispatchActor) {
    await this.requireLoad(this.database, loadId, actor.companyId);
    if (await this.database.settlement.count({ where: { loadId } })) {
      throw new DispatchConflictError(
        'A load with a settlement cannot be deleted.',
      );
    }
    await this.database.load.delete({
      where: { id: loadId, companyId: actor.companyId },
    });
  }

  async getLoadActivity(loadId: string, actor: DispatchActor) {
    await this.requireLoad(this.database, loadId, actor.companyId);
    return this.database.loadActivity.findMany({
      where: { loadId, companyId: actor.companyId },
      include: { actorUser: { select: { id: true, displayName: true, image: true } } },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
  }

  async addLoadDocument(
    loadId: string,
    input: DispatchDocumentInput,
    bytes: Uint8Array,
    actor: DispatchActor,
  ) {
    await this.requireLoad(this.database, loadId, actor.companyId);
    const storageKey = await this.storage.put(bytes);
    try {
      return await this.database.$transaction(async (transaction) => {
        const load = await this.requireLoad(transaction, loadId, actor.companyId);
        const document = await transaction.loadDocument.create({
          data: {
            ...input,
            loadId,
            storageKey,
            uploaderUserId: actor.user.id,
          },
          select: {
            id: true,
            type: true,
            displayFilename: true,
            mimeType: true,
            byteSize: true,
            createdAt: true,
          },
        });
        await this.recordActivity(transaction, load, actor, 'DOCUMENT_ADDED', {
          documentId: document.id,
          type: document.type,
          displayFilename: document.displayFilename,
        });
        return document;
      });
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }
  }

  async getLoadDocument(
    loadId: string,
    documentId: string,
    actor: DispatchActor,
  ) {
    await this.requireLoad(this.database, loadId, actor.companyId);
    const document = await this.database.loadDocument.findFirst({
      where: { id: documentId, loadId, load: { companyId: actor.companyId } },
    });
    if (!document) throw new DispatchResourceNotFoundError();
    return {
      bytes: await this.storage.get(document.storageKey),
      filename: document.displayFilename,
      mimeType: document.mimeType,
    };
  }

  async deleteLoadDocument(
    loadId: string,
    documentId: string,
    actor: DispatchActor,
  ) {
    const document = await this.database.$transaction(async (transaction) => {
      const load = await this.requireLoad(transaction, loadId, actor.companyId);
      const existing = await transaction.loadDocument.findFirst({
        where: { id: documentId, loadId },
      });
      if (!existing) throw new DispatchResourceNotFoundError();
      await transaction.loadDocument.delete({ where: { id: existing.id } });
      await this.recordActivity(transaction, load, actor, 'DOCUMENT_REMOVED', {
        documentId,
        type: existing.type,
        displayFilename: existing.displayFilename,
      });
      return existing;
    });
    await this.storage.delete(document.storageKey);
  }

  async addTrailerDocument(
    trailerId: string,
    input: DispatchDocumentInput,
    bytes: Uint8Array,
    actor: DispatchActor,
    expiresAt?: Date | null,
  ) {
    await this.requireTrailer(this.database, trailerId, actor.companyId);
    const storageKey = await this.storage.put(bytes);
    try {
      return await this.database.trailerDocument.create({
        data: {
          ...input,
          trailerId,
          storageKey,
          expiresAt,
          uploaderUserId: actor.user.id,
        },
        select: {
          id: true,
          type: true,
          displayFilename: true,
          mimeType: true,
          byteSize: true,
          expiresAt: true,
          createdAt: true,
        },
      });
    } catch (error) {
      await this.storage.delete(storageKey);
      throw error;
    }
  }

  async getTrailerDocument(
    trailerId: string,
    documentId: string,
    actor: DispatchActor,
  ) {
    await this.requireTrailer(this.database, trailerId, actor.companyId);
    const document = await this.database.trailerDocument.findFirst({
      where: {
        id: documentId,
        trailerId,
        trailer: { companyId: actor.companyId },
      },
    });
    if (!document) throw new DispatchResourceNotFoundError();
    return {
      bytes: await this.storage.get(document.storageKey),
      filename: document.displayFilename,
      mimeType: document.mimeType,
    };
  }

  async deleteTrailerDocument(
    trailerId: string,
    documentId: string,
    actor: DispatchActor,
  ) {
    await this.requireTrailer(this.database, trailerId, actor.companyId);
    const document = await this.database.trailerDocument.findFirst({
      where: {
        id: documentId,
        trailerId,
        trailer: { companyId: actor.companyId },
      },
    });
    if (!document) throw new DispatchResourceNotFoundError();
    await this.database.trailerDocument.delete({ where: { id: document.id } });
    await this.storage.delete(document.storageKey);
  }

  private assertTransition(current: LoadStatus, next: LoadStatus) {
    if (!transitions[current].includes(next)) {
      throw new DispatchValidationError(
        `Load cannot move from ${current} to ${next}.`,
      );
    }
  }

  private async assertStatusRequirements(
    transaction: Transaction,
    loadId: string,
    input: Pick<
      DispatchLoadInput,
      'status' | 'truckId' | 'driverId' | 'trailerId' | 'pickupDate' | 'deliveryDate' | 'invoiceNumber'
    >,
  ) {
    if (
      input.status &&
      ['ASSIGNED', 'DISPATCHED', 'PICKED_UP', 'IN_TRANSIT'].includes(input.status)
    ) {
      if (!input.truckId || !input.driverId || !input.trailerId) {
        throw new DispatchValidationError(
          'Assigned loads require a truck, trailer, and driver.',
        );
      }
      if (!input.pickupDate || !input.deliveryDate) {
        throw new DispatchValidationError(
          'Assigned loads require a pickup and delivery window.',
        );
      }
    }
    if (
      input.status === 'POD_UPLOADED' &&
      !(await transaction.loadDocument.count({ where: { loadId, type: 'POD' } }))
    ) {
      throw new DispatchValidationError(
        'A POD document is required before marking POD uploaded.',
      );
    }
    if (input.status === 'INVOICED' && !input.invoiceNumber) {
      throw new DispatchValidationError(
        'An invoice number is required before invoicing a load.',
      );
    }
    if (
      input.status === 'PAID' &&
      !(await transaction.settlement.count({ where: { loadId, isPaid: true } }))
    ) {
      throw new DispatchValidationError(
        'A paid settlement is required before marking a load paid.',
      );
    }
  }

  private async normalizeAndValidateLoad(
    transaction: Transaction,
    input: DispatchLoadInput,
    companyId: string,
  ): Promise<DispatchLoadInput> {
    const stops = input.stops
      ? [...input.stops]
          .sort((a, b) => a.order - b.order)
          .map((stop, order) => ({ ...stop, order }))
      : undefined;
    const pickups = stops?.filter(({ type }) => type === 'PICKUP') ?? [];
    const deliveries = stops?.filter(({ type }) => type === 'DELIVERY') ?? [];
    if (stops && (!pickups.length || !deliveries.length)) {
      throw new DispatchValidationError(
        'A load requires at least one pickup and one delivery stop.',
      );
    }
    for (const stop of stops ?? []) {
      if (stop.contactId) {
        const contact = await transaction.customerContact.findFirst({
          where: {
            id: stop.contactId,
            customerId: input.customerId ?? undefined,
            customer: { companyId },
          },
          select: { id: true },
        });
        if (!contact) throw new DispatchResourceNotFoundError();
      }
    }
    if (input.customerId) {
      await this.requireCustomer(transaction, input.customerId, companyId);
    }
    if (input.truckId) await this.requireTruck(transaction, input.truckId, companyId);
    if (input.driverId) await this.requireDriver(transaction, input.driverId, companyId);
    if (input.trailerId) {
      const trailer = await this.requireTrailer(
        transaction,
        input.trailerId,
        companyId,
      );
      if (['MAINTENANCE', 'OUT_OF_SERVICE', 'INACTIVE'].includes(trailer.status)) {
        throw new DispatchValidationError(
          'The selected trailer is not available for assignment.',
        );
      }
    }

    const pickupDate =
      pickups.map(({ appointmentStart }) => appointmentStart).find(Boolean) ??
      input.pickupDate ??
      null;
    const deliveryDate =
      [...deliveries].reverse().map(({ appointmentEnd, appointmentStart }) =>
        appointmentEnd ?? appointmentStart).find(Boolean) ??
      input.deliveryDate ??
      null;
    if (pickupDate && deliveryDate && deliveryDate < pickupDate) {
      throw new DispatchValidationError(
        'Delivery must not be before pickup.',
      );
    }
    const normalized = {
      ...input,
      origin: pickups[0]
        ? `${pickups[0].city}${pickups[0].state ? `, ${pickups[0].state}` : ''}`
        : input.origin ?? '',
      destination: deliveries.at(-1)
        ? `${deliveries.at(-1)!.city}${deliveries.at(-1)!.state ? `, ${deliveries.at(-1)!.state}` : ''}`
        : input.destination ?? '',
      pickupDate,
      deliveryDate,
      stops,
    };
    return normalized;
  }

  private loadData(
    input: DispatchLoadInput,
  ): Omit<Prisma.LoadUncheckedCreateInput, 'companyId'> {
    return {
      loadNumber: input.loadNumber,
      referenceNum: input.referenceNum,
      status: input.status,
      origin: input.origin ?? '',
      destination: input.destination ?? '',
      pickupDate: input.pickupDate,
      deliveryDate: input.deliveryDate,
      miles: input.miles,
      rate: input.rate,
      fuelSurcharge: input.fuelSurcharge,
      truckId: input.truckId,
      driverId: input.driverId,
      trailerId: input.trailerId,
      customerId: input.customerId,
      notes: input.notes,
      invoiceNumber: input.invoiceNumber,
    };
  }

  private async validateAssignmentConflict(
    transaction: Transaction,
    input: Pick<
      DispatchLoadInput,
      'status' | 'truckId' | 'driverId' | 'trailerId' | 'pickupDate' | 'deliveryDate'
    >,
    companyId: string,
    excludeLoadId?: string,
  ) {
    if (
      !input.status ||
      !activeAssignmentStatuses.includes(input.status) ||
      !input.pickupDate ||
      !input.deliveryDate
    ) return;
    const resources = [
      ['truckId', input.truckId, 'truck'],
      ['driverId', input.driverId, 'driver'],
      ['trailerId', input.trailerId, 'trailer'],
    ] as const;
    for (const [field, id, label] of resources) {
      if (!id) continue;
      const conflict = await transaction.load.findFirst({
        where: {
          companyId,
          id: excludeLoadId ? { not: excludeLoadId } : undefined,
          status: { in: activeAssignmentStatuses },
          [field]: id,
          pickupDate: { lte: input.deliveryDate },
          deliveryDate: { gte: input.pickupDate },
        },
        select: { loadNumber: true },
      });
      if (conflict) {
        throw new DispatchConflictError(
          `The ${label} is already assigned to load ${conflict.loadNumber} during this window.`,
        );
      }
    }
  }

  private exceptionsFor(load: {
    status: LoadStatus;
    truckId: string | null;
    driverId: string | null;
    trailerId: string | null;
    pickupDate: Date | null;
    deliveryDate: Date | null;
    documents: Array<{ type: string }>;
  }): string[] {
    const exceptions: string[] = [];
    if (
      ['PLANNED', 'ASSIGNED', 'DISPATCHED'].includes(load.status) &&
      (!load.truckId || !load.driverId || !load.trailerId)
    ) exceptions.push('UNASSIGNED');
    if (
      load.pickupDate &&
      load.pickupDate < new Date() &&
      ['DRAFT', 'PENDING', 'PLANNED', 'ASSIGNED', 'DISPATCHED'].includes(load.status)
    ) exceptions.push('LATE_PICKUP');
    if (
      load.deliveryDate &&
      load.deliveryDate < new Date() &&
      ['PICKED_UP', 'IN_TRANSIT'].includes(load.status)
    ) exceptions.push('LATE_DELIVERY');
    if (
      load.status === 'DELIVERED' &&
      !load.documents.some(({ type }) => type === 'POD')
    ) exceptions.push('MISSING_POD');
    return exceptions;
  }

  private async recordActivity(
    transaction: Transaction,
    load: { id: string; companyId: string; loadNumber: string },
    actor: DispatchActor,
    action: LoadActivityAction,
    metadata?: Prisma.InputJsonValue,
  ) {
    await transaction.loadActivity.create({
      data: {
        companyId: load.companyId,
        loadId: load.id,
        loadNumber: load.loadNumber,
        actorUserId: actor.user.id,
        action,
        metadata,
      },
    });
  }

  private async requireLoad(
    database: Transaction | PrismaClient,
    loadId: string,
    companyId: string,
  ) {
    const load = await database.load.findFirst({
      where: { id: loadId, companyId },
    });
    if (!load) throw new DispatchResourceNotFoundError();
    return load;
  }

  private async requireCustomer(
    database: Transaction | PrismaClient,
    customerId: string,
    companyId: string,
  ) {
    const customer = await database.customer.findFirst({
      where: { id: customerId, companyId },
      select: { id: true, status: true },
    });
    if (!customer) throw new DispatchResourceNotFoundError();
    return customer;
  }

  private async requireTruck(
    database: Transaction | PrismaClient,
    truckId: string,
    companyId: string,
  ) {
    const truck = await database.truck.findFirst({
      where: { id: truckId, companyId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!truck) throw new DispatchResourceNotFoundError();
    return truck;
  }

  private async requireDriver(
    database: Transaction | PrismaClient,
    driverId: string,
    companyId: string,
  ) {
    const driver = await database.driver.findFirst({
      where: { id: driverId, companyId },
      select: { id: true },
    });
    if (!driver) throw new DispatchResourceNotFoundError();
    return driver;
  }

  private async requireTrailer(
    database: Transaction | PrismaClient,
    trailerId: string,
    companyId: string,
  ) {
    const trailer = await database.trailer.findFirst({
      where: {
        id: trailerId,
        companyId,
      },
      select: { id: true, status: true },
    });
    if (!trailer) throw new DispatchResourceNotFoundError();
    return trailer;
  }
}

export const dispatchService = new DispatchService();
