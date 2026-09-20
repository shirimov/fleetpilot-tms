import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { FinancialAuthorization } from "./financial-control-authorization";
import { object } from "./archive-normalize";
import { archiveScope } from "./archive-service";
import {
  FinancialNotFoundError,
  FinancialValidationError,
} from "./financial-control-errors";

type Coverage = {
  id: string;
  archiveCompanyId: string;
  pid: string;
  observedAt: Date;
  expected: bigint;
  captured: bigint;
  conflicts: bigint;
  unexpected: bigint;
  failed: bigint;
};
const coverage = (x: Coverage) => ({
  ...x,
  missing: x.expected - x.captured,
  complete:
    x.expected === x.captured &&
    x.conflicts === BigInt("0") &&
    x.unexpected === BigInt("0") &&
    x.failed === BigInt("0"),
});
export const archivePage = (input: string | null) => {
  const page = Number(input ?? 0);
  if (!Number.isSafeInteger(page) || page < 0 || page > 100000)
    throw new FinancialValidationError("Invalid page.");
  return page;
};
export class ArchiveReadService {
  constructor(private readonly db: PrismaClient = prisma) {}
  async overview(c: FinancialAuthorization) {
    const scope = archiveScope(c);
    const [bindings, statementCount, totals] = await Promise.all([
      this.db.archiveCompany.findMany({
        where: scope,
        include: { company: { select: { name: true } } },
        orderBy: { providerCompanyName: "asc" },
      }),
      this.db.archiveStatement.count({ where: { company: scope } }),
      this.db.$queryRaw<
        {
          groups: bigint;
          complete: bigint;
          missing: bigint;
          conflicts: bigint;
          failed: bigint;
          unexpected: bigint;
        }[]
      >`WITH latest AS (
        SELECT DISTINCT ON (v."archiveCompanyId",v.pid) v.* FROM "ArchiveCoverage" v JOIN "ArchiveCompany" c ON c.id=v."archiveCompanyId"
        WHERE c."operatingGroupId"=${c.operatingGroupId} AND c."companyId" IN (${Prisma.join(c.companyIds)})
        ORDER BY v."archiveCompanyId",v.pid,v."observedAt" DESC,v.id DESC)
        SELECT count(*) AS groups,count(*) FILTER (WHERE expected=captured AND conflicts=0 AND failed=0 AND unexpected=0) AS complete,
        COALESCE(sum(expected-captured),0)::bigint AS missing,COALESCE(sum(conflicts),0)::bigint AS conflicts,COALESCE(sum(failed),0)::bigint AS failed,COALESCE(sum(unexpected),0)::bigint AS unexpected FROM latest`,
    ]);
    return { bindings, statementCount, ...totals[0] };
  }
  async inventories(
    c: FinancialAuthorization,
    page: number,
    bindingId?: string,
    pid?: string,
  ) {
    archiveScope(c);
    const filter = Prisma.sql`c."operatingGroupId"=${c.operatingGroupId} AND c."companyId" IN (${Prisma.join(c.companyIds)}) ${bindingId ? Prisma.sql`AND c.id=${bindingId}` : Prisma.empty} ${pid ? Prisma.sql`AND v.pid=${pid}` : Prisma.empty}`;
    const latest = Prisma.sql`SELECT DISTINCT ON (v."archiveCompanyId",v.pid) v.*,c."providerCompanyName" AS company FROM "ArchiveCoverage" v JOIN "ArchiveCompany" c ON c.id=v."archiveCompanyId" WHERE ${filter} ORDER BY v."archiveCompanyId",v.pid,v."observedAt" DESC,v.id DESC`;
    const [items, count] = await Promise.all([
      this.db.$queryRaw<Coverage[]>(
        Prisma.sql`SELECT * FROM (${latest}) q ORDER BY pid DESC,id LIMIT 25 OFFSET ${page * 25}`,
      ),
      this.db.$queryRaw<{ total: bigint }[]>(
        Prisma.sql`SELECT count(*) AS total FROM (${latest}) q`,
      ),
    ]);
    return {
      items: items.map(coverage),
      total: count[0].total,
      page,
      pageSize: 25,
    };
  }
  async inventory(id: string, c: FinancialAuthorization, page: number) {
    const snapshot = await this.db.archiveInventory.findFirst({
      where: { id, sealed: true, company: archiveScope(c) },
      include: {
        company: true,
        captureRun: {
          select: { id: true, status: true, createdByUserId: true },
        },
      },
    });
    if (!snapshot) throw new FinancialNotFoundError();
    const [items, cov, unexpected] = await Promise.all([
      this.db.archiveInventoryItem.findMany({
        where: { inventoryId: id },
        include: { job: true },
        orderBy: { providerStatementId: "asc" },
        skip: page * 25,
        take: 25,
      }),
      this.db.$queryRaw<
        Coverage[]
      >`SELECT * FROM "ArchiveCoverage" WHERE id=${id}`,
      this.db.$queryRaw<
        { id: string; providerStatementId: string }[]
      >`SELECT s.id,s."providerStatementId" FROM "ArchiveStatement" s WHERE s."archiveCompanyId"=${snapshot.archiveCompanyId} AND EXISTS (SELECT 1 FROM "ArchiveVersion" v WHERE v."statementId"=s.id AND v.pid=${snapshot.pid}) AND NOT EXISTS (SELECT 1 FROM "ArchiveInventoryItem" e WHERE e."inventoryId"=${id} AND e."providerStatementId"=s."providerStatementId") ORDER BY s.id LIMIT 25 OFFSET ${page * 25}`,
    ]);
    const captured = await this.db.archiveStatement.findMany({
      where: {
        archiveCompanyId: snapshot.archiveCompanyId,
        providerStatementId: { in: items.map((x) => x.providerStatementId) },
      },
      include: {
        versions: {
          select: {
            id: true,
            providerVersion: true,
            pid: true,
            recipientId: true,
            sealed: true,
            recipientType: true,
          },
        },
      },
    });
    return {
      snapshot,
      coverage: coverage(cov[0]),
      items: items.map((x) => {
        const s = captured.find(
          (s) => s.providerStatementId === x.providerStatementId,
        );
        return {
          ...x,
          metadata: undefined,
          sourceUnit: object(x.metadata).truck_unit_id ?? null,
          sourceStatus: object(x.metadata).status ?? null,
          statementId: s?.id ?? null,
          archiveStatus: s?.status ?? "MISSING",
          captured: !!s?.versions.some(
            (v) =>
              v.sealed &&
              v.recipientType === x.recipientType &&
              v.providerVersion === x.providerVersion &&
              v.pid === snapshot.pid &&
              v.recipientId === x.recipientId,
          ),
        };
      }),
      unexpected,
      page,
      pageSize: 25,
    };
  }
  async statements(c: FinancialAuthorization, params: URLSearchParams) {
    const page = archivePage(params.get("page")),
      pid = params.get("pid"),
      binding = params.get("company"),
      recipient = params.get("recipient"),
      type = params.get("type"),
      lifecycle = params.get("lifecycle"),
      status = params.get("status"),
      truck = params.get("truck");
    for (const value of [binding, recipient, truck])
      if (value && value.length > 200)
        throw new FinancialValidationError("Filter too long.");
    if (
      (pid && !/^\d{4}-\d{2}$/.test(pid)) ||
      (type && !["DRIVER", "CONTRACTOR"].includes(type)) ||
      (lifecycle && !["active", "terminated"].includes(lifecycle)) ||
      (status && !["PARSED", "SOURCE_CHANGED", "NEEDS_REVIEW"].includes(status))
    )
      throw new FinancialValidationError("Invalid archive filter.");
    const version: Prisma.ArchiveVersionWhereInput = {
      sealed: true,
      ...(pid ? { pid } : {}),
      ...(recipient
        ? {
            OR: [
              { recipientName: { contains: recipient, mode: "insensitive" } },
              { recipientId: recipient },
            ],
          }
        : {}),
      ...(type ? { recipientType: type } : {}),
      ...(lifecycle ? { recipientStatus: lifecycle } : {}),
      ...(truck
        ? { trucks: { some: { OR: [{ unit: truck }, { truckId: truck }] } } }
        : {}),
    };
    const where: Prisma.ArchiveStatementWhereInput = {
      company: archiveScope(c),
      ...(binding ? { archiveCompanyId: binding } : {}),
      ...(status ? { status } : {}),
      versions: { some: version },
    };
    const [items, total] = await Promise.all([
      this.db.archiveStatement.findMany({
        where,
        include: {
          company: { select: { providerCompanyName: true, companyId: true } },
          versions: {
            where: version,
            orderBy: { providerVersion: "desc" },
            take: 1,
            include: { trucks: true },
          },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: page * 25,
        take: 25,
      }),
      this.db.archiveStatement.count({ where }),
    ]);
    return { items, total, page, pageSize: 25 };
  }
  async detail(
    id: string,
    c: FinancialAuthorization,
    versionNumber?: string,
    page = 0,
  ) {
    const s = await this.db.archiveStatement.findFirst({
      where: { id, company: archiveScope(c) },
      include: {
        company: true,
        versions: {
          select: {
            id: true,
            providerVersion: true,
            pid: true,
            capturedAt: true,
            pdfChecksum: true,
          },
          orderBy: { providerVersion: "desc" },
        },
        conflicts: {
          select: {
            id: true,
            providerVersion: true,
            pdfChecksum: true,
            detailChecksum: true,
            capturedAt: true,
          },
        },
      },
    });
    if (!s) throw new FinancialNotFoundError();
    const n =
      versionNumber === undefined
        ? s.latestProviderVersion
        : Number(versionNumber);
    if (!Number.isSafeInteger(n))
      throw new FinancialValidationError("Invalid version.");
    const v = await this.db.archiveVersion.findUnique({
      where: {
        statementId_providerVersion: { statementId: id, providerVersion: n },
      },
      include: {
        trucks: true,
        document: { select: { displayFilename: true, byteSize: true } },
        lines: {
          orderBy: [{ sourceArray: "asc" }, { sourceOrder: "asc" }],
          take: 50,
          skip: page * 50,
        },
        _count: { select: { lines: true } },
      },
    });
    if (!v) throw new FinancialNotFoundError();
    return {
      ...s,
      version: { ...v, detailStorageKey: undefined },
      linePage: page,
    };
  }
}
export const archiveRead = new ArchiveReadService();
