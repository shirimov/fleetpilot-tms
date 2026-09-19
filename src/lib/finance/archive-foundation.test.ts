import "dotenv/config";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { FilesystemPrivateFileStorage } from "@/lib/storage/private-file-storage";
import { ArchiveService, archiveDocumentScope } from "./archive-service";
import { ArchiveProviderError } from "./archive-provider";
import { ArchiveReadService } from "./archive-read";
import { FinancialControlService } from "./financial-control-service";
import type { FinancialAuthorization } from "./financial-control-authorization";
import { minor, normalizeStatement, parseSource } from "./archive-normalize";
import {
  FixtureArchiveProvider,
  statementFixture,
} from "../../../tests/fixtures/quickmanage";
import { postedAccountingFixture } from "../../../tests/fixtures/accounting-posted";

let service: ArchiveService,
  ctx: FinancialAuthorization,
  bindingId: string,
  root: string;
const provider = new FixtureArchiveProvider(),
  read = new ArchiveReadService();
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "qm-archive-test-"));
  service = new ArchiveService(
    prisma,
    new FilesystemPrivateFileStorage("financial-statements", root),
    new FilesystemPrivateFileStorage("quickmanage-details", root),
  );
  const company = await prisma.company.create({
      data: { name: "QM synthetic " + randomUUID() },
    }),
    user = await prisma.user.create({
      data: {
        displayName: "Synthetic archive owner",
        email: randomUUID() + "@example.test",
        activeCompanyId: company.id,
        memberships: { create: { companyId: company.id, role: "OWNER" } },
      },
    });
  const g = await new FinancialControlService().createGroup("QM synthetic", {
    companyId: company.id,
    role: "OWNER",
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      activeCompanyId: company.id,
      isActive: true,
    },
  });
  ctx = {
    userId: user.id,
    activeCompanyId: company.id,
    operatingGroupId: g.id,
    companyIds: [company.id],
    role: "OWNER",
  };
  bindingId = (
    await service.bind(company.id, provider.companyId, provider, ctx)
  ).id;
  await prisma.truck.create({
    data: {
      companyId: company.id,
      unitNumber: "8558",
      unitNumberNormalized: "8558",
      status: "INACTIVE",
    },
  });
});
// Append-only fixtures deliberately remain in the disposable database; destroy the database after the suite.
after(async () => {
  await rm(root, { recursive: true, force: true });
  await prisma.$disconnect();
});
async function inventory(
  fixtures: ReturnType<typeof statementFixture>[],
  pid = "2026-37",
) {
  provider.fixtures = fixtures;
  return service.discover(bindingId, pid, provider, ctx);
}
async function economics(c = ctx) {
  return Promise.all([
    prisma.financialTransaction.count({
      where: { operatingGroupId: c.operatingGroupId },
    }),
    prisma.financialExpectation.count({
      where: { operatingGroupId: c.operatingGroupId },
    }),
    prisma.financialExpectationBankMatch.count({
      where: { operatingGroupId: c.operatingGroupId },
    }),
  ]);
}

test("lossless money supports zero/negative/large cents and preserves fractional-cent ambiguity", () => {
  assert.equal(minor("90071992547409.93"), BigInt("9007199254740993"));
  assert.equal(minor("-20.25"), BigInt(-2025));
  assert.equal(minor("0"), BigInt(0));
  assert.equal(minor("1.001"), null);
  assert.equal(minor(1.23), null);
  assert.equal(
    parseSource(Buffer.from('{"amount":1742.7079999999999,"note":"12\\\"34"}'))
      .amount,
    "1742.7079999999999",
  );
  const n = normalizeStatement(statementFixture().bundle.detail);
  assert.equal(n.header.grossMinor, BigInt(100001));
  assert.equal(n.lines[2].included, false);
});
test("same UUID/version is idempotent, including concurrent requests and unique source documents", async () => {
  const f = statementFixture(),
    before = await economics();
  const results = await Promise.all(
    Array.from({ length: 5 }, () => service.capture(bindingId, f.bundle, ctx)),
  );
  assert.equal(new Set(results.map((x) => x.versionId)).size, 1);
  assert.equal(
    await prisma.archiveVersion.count({
      where: { statementId: results[0].statementId },
    }),
    1,
  );
  assert.equal(results.filter((x) => !x.idempotent).length, 1);
  assert.equal(
    (await readdir(path.join(root, "financial-statements"))).length,
    1,
  );
  assert.equal(
    (await readdir(path.join(root, "quickmanage-details"))).length,
    1,
  );
  assert.equal(
    await prisma.archiveLine.count({
      where: { versionId: results[0].versionId },
    }),
    3,
  );
  assert.equal(
    await prisma.financialAuditEvent.count({
      where: {
        operatingGroupId: ctx.operatingGroupId,
        action: "ARCHIVE_VERSION_CAPTURED",
        metadata: { path: ["statementId"], equals: results[0].statementId },
      },
    }),
    1,
  );
  assert.deepEqual(await economics(), before);
});
test("new provider version preserves original; deterministic latest and explicit acceptance", async () => {
  const f = statementFixture(),
    a = await service.capture(bindingId, f.bundle, ctx);
  f.payload.data.version = 2;
  f.bundle.detail = Buffer.from(JSON.stringify(f.payload));
  f.bundle.pdf = Buffer.from("%PDF-1.4\nnew version " + f.id);
  const b = await service.capture(bindingId, f.bundle, ctx);
  assert.equal(b.status, "SOURCE_CHANGED");
  assert.equal(
    await prisma.archiveVersion.count({
      where: { statementId: a.statementId },
    }),
    2,
  );
  const s = await prisma.archiveStatement.findUniqueOrThrow({
    where: { id: a.statementId },
  });
  assert.equal(s.latestProviderVersion, 2);
  assert.equal(s.acceptedProviderVersion, 1);
  await service.accept(s.id, ctx);
  assert.equal(
    (await prisma.archiveStatement.findUniqueOrThrow({ where: { id: s.id } }))
      .acceptedProviderVersion,
    2,
  );
});
test("same version with changed bytes is quarantined and cannot overwrite or be accepted", async () => {
  const f = statementFixture(),
    a = await service.capture(bindingId, f.bundle, ctx),
    v = await prisma.archiveVersion.findUniqueOrThrow({
      where: { id: a.versionId! },
    });
  const changed = {
    ...f.bundle,
    pdf: Buffer.from("%PDF-1.4\nconflict " + f.id),
  };
  const b = await service.capture(bindingId, changed, ctx);
  assert.equal(b.status, "NEEDS_REVIEW");
  await service.capture(bindingId, changed, ctx);
  assert.equal(
    await prisma.archiveConflict.count({
      where: { statementId: a.statementId },
    }),
    1,
  );
  assert.equal(
    (
      await prisma.archiveVersion.findUniqueOrThrow({
        where: { id: a.versionId! },
      })
    ).pdfChecksum,
    v.pdfChecksum,
  );
  await assert.rejects(() => service.accept(a.statementId, ctx));
});
test("same Truck/PID/statement number permits separate Driver and Contractor UUIDs; terminated archives normally", async () => {
  const a = await service.capture(
      bindingId,
      statementFixture({ terminated: true }).bundle,
      ctx,
    ),
    b = await service.capture(
      bindingId,
      statementFixture({ contractor: true, terminated: true }).bundle,
      ctx,
    );
  assert.notEqual(a.statementId, b.statementId);
  const detail = await read.detail(b.statementId, ctx);
  assert.equal(detail.version.recipientStatus, "terminated");
  assert.equal(detail.version.trucks[0].mappingStatus, "COMPANY_UNIT");
  assert.equal(
    (
      await prisma.truck.findUniqueOrThrow({
        where: { id: detail.version.trucks[0].truckId! },
      })
    ).status,
    "INACTIVE",
  );
});
test("exact missing identities, unexpected identities, failures and resumed work control completeness", async () => {
  const a = statementFixture({ pid: "2026-36" }),
    b = statementFixture({ pid: "2026-36" }),
    i = await inventory([a, b], "2026-36");
  const items = await prisma.archiveInventoryItem.findMany({
    where: { inventoryId: i.id },
  });
  provider.failures.add(b.id);
  await service.run(
    i.id,
    items.map((x) => x.id),
    provider,
    ctx,
  );
  let result = await read.inventory(i.id, ctx, 0);
  assert.equal(result.coverage.missing, BigInt(1));
  assert.equal(result.coverage.failed, BigInt(1));
  assert.equal(result.coverage.complete, false);
  assert.equal(
    result.items.find((x) => !x.captured)?.providerStatementId,
    b.id,
  );
  provider.failures.clear();
  const reads = provider.reads;
  await service.run(
    i.id,
    items.map((x) => x.id),
    provider,
    ctx,
  );
  assert.equal(provider.reads, reads + 1);
  result = await read.inventory(i.id, ctx, 0);
  assert.equal(result.coverage.complete, true);
  await service.capture(
    bindingId,
    statementFixture({ pid: "2026-36" }).bundle,
    ctx,
  );
  result = await read.inventory(i.id, ctx, 0);
  assert.equal(result.coverage.unexpected, BigInt(1));
  assert.equal(result.coverage.complete, false);
  assert.equal(result.unexpected.length, 1);
});
test("expired leases resume safely; concurrent workers do not duplicate capture", async () => {
  const f = statementFixture({ pid: "2026-35" }),
    i = await inventory([f], "2026-35"),
    item = await prisma.archiveInventoryItem.findFirstOrThrow({
      where: { inventoryId: i.id },
    });
  await prisma.archiveCaptureJob.update({
    where: { itemId: item.id },
    data: {
      status: "CAPTURING",
      leaseToken: "expired",
      leaseExpiresAt: new Date(0),
    },
  });
  const expiredJob = await prisma.archiveCaptureJob.findUniqueOrThrow({
    where: { itemId: item.id },
  });
  await assert.rejects(
    () =>
      service.capture(bindingId, f.bundle, ctx, undefined, {
        id: expiredJob.id,
        token: "expired",
      }),
    /CAPTURE_LEASE_LOST/,
  );
  await Promise.all([
    service.run(i.id, [item.id], provider, ctx),
    service.run(i.id, [item.id], provider, ctx),
  ]);
  assert.equal((await read.inventory(i.id, ctx, 0)).coverage.complete, true);
  assert.equal(
    await prisma.archiveVersion.count({
      where: { statement: { providerStatementId: f.id } },
    }),
    1,
  );
});
test("cross-group, unauthorized company, MEMBER and generic document paths fail closed", async () => {
  const f = statementFixture(),
    s = await service.capture(bindingId, f.bundle, ctx),
    v = await prisma.archiveVersion.findUniqueOrThrow({
      where: { id: s.versionId! },
    });
  for (const c of [
    { ...ctx, operatingGroupId: "foreign" },
    { ...ctx, companyIds: [], role: "OWNER" as const },
    { ...ctx, role: "MEMBER" as const },
  ]) {
    await assert.rejects(() => read.detail(s.statementId, c));
    await assert.rejects(() => service.original(v.id, c));
    await assert.rejects(() => service.capture(bindingId, f.bundle, c));
  }
  const otherCompany = await prisma.company.create({
    data: { name: "Other synthetic" },
  });
  const other = {
    ...ctx,
    activeCompanyId: otherCompany.id,
    companyIds: [otherCompany.id],
  };
  assert.equal(
    await prisma.financialStatement.count({
      where: { id: v.documentId, ...archiveDocumentScope(other) },
    }),
    0,
  );
});
test("database prevents changing or extending sealed originals, versions, inventory and source lines", async () => {
  const f = statementFixture({ pid: "2026-34" }),
    i = await inventory([f], "2026-34"),
    s = await service.capture(bindingId, f.bundle, ctx),
    v = await prisma.archiveVersion.findUniqueOrThrow({
      where: { id: s.versionId! },
      include: { lines: true },
    });
  await assert.rejects(() =>
    prisma.archiveVersion.update({
      where: { id: v.id },
      data: { pdfChecksum: "changed" },
    }),
  );
  await assert.rejects(() =>
    prisma.financialStatement.update({
      where: { id: v.documentId },
      data: { checksumSha256: "changed" },
    }),
  );
  await assert.rejects(() =>
    prisma.archiveLine.update({
      where: { id: v.lines[0].id },
      data: { amountMinor: BigInt(1) },
    }),
  );
  await assert.rejects(() =>
    prisma.archiveLine.create({
      data: {
        versionId: v.id,
        kind: "OTHER",
        sourceArray: "new",
        sourceOrder: 0,
        metadata: {},
      },
    }),
  );
  await assert.rejects(() =>
    prisma.archiveInventory.update({
      where: { id: i.id },
      data: { expectedCount: 0 },
    }),
  );
  const doc = await prisma.financialStatement.findUniqueOrThrow({
    where: { id: v.documentId },
  });
  await writeFile(
    path.join(root, "financial-statements", doc.storageKey),
    "corrupt",
  );
  await assert.rejects(
    () => service.original(v.id, ctx),
    /ARCHIVE_CHECKSUM_MISMATCH/,
  );
});
test("server pagination retains authoritative Company/PID totals and exact identity coverage", async () => {
  const fixtures = Array.from({ length: 31 }, () =>
      statementFixture({ pid: "2026-33" }),
    ),
    i = await inventory(fixtures, "2026-33");
  const [a, b] = await Promise.all([
    read.inventory(i.id, ctx, 0),
    read.inventory(i.id, ctx, 1),
  ]);
  assert.equal(a.items.length, 25);
  assert.equal(b.items.length, 6);
  assert.equal(a.coverage.expected, BigInt(31));
  assert.equal(b.coverage.expected, BigInt(31));
  assert.equal(
    new Set([...a.items, ...b.items].map((x) => x.providerStatementId)).size,
    31,
  );
});
test("protected posted Pilot fixture survives capture with exact economics, documents and inactive Truck unchanged", async () => {
  const f = await postedAccountingFixture();
  const isolatedProvider = new FixtureArchiveProvider();
  const binding = await service.bind(
    f.company.id,
    isolatedProvider.companyId,
    isolatedProvider,
    f.context,
  );
  const snapshot = async () => ({
    economics: await economics(f.context),
    allocations: await prisma.financialAllocation.count({
      where: { transaction: { operatingGroupId: f.context.operatingGroupId } },
    }),
    evidence: await prisma.financialTransactionEvidence.count({
      where: { transaction: { operatingGroupId: f.context.operatingGroupId } },
    }),
    events: await prisma.pilotFuelingEvent.count({
      where: { invoice: { operatingGroupId: f.context.operatingGroupId } },
    }),
    documents: await prisma.financialStatement.findMany({
      where: {
        pilotDocuments: { some: {} },
        operatingGroupId: f.context.operatingGroupId,
      },
      select: { id: true, checksumSha256: true },
      orderBy: { id: "asc" },
    }),
    net: (await new FinancialControlService().overview(f.context)).business
      .netExpensesMinor,
    matched: await prisma.financialExpectation.count({
      where: {
        operatingGroupId: f.context.operatingGroupId,
        status: "MATCHED",
      },
    }),
    truck: await prisma.truck.findFirst({
      where: { companyId: f.company.id, unitNumber: "8558" },
      select: { status: true },
    }),
  });
  const a = await snapshot();
  assert.deepEqual(a.economics, [699, 5, 5]);
  assert.equal(a.allocations, 1083);
  assert.equal(a.evidence, 1083);
  assert.equal(a.events, 698);
  assert.equal(a.matched, 5);
  assert.equal(a.documents.length, 5);
  assert.equal(a.net, "40955325");
  assert.equal(a.truck?.status, "INACTIVE");
  await service.capture(
    binding.id,
    statementFixture({ terminated: true }).bundle,
    f.context,
  );
  assert.deepEqual(await snapshot(), a);
});

test("timestamp metadata cannot hide a captured UUID/version; changed content still conflicts", async () => {
  const f = statementFixture({ pid: "2026-24" });
  await service.capture(bindingId, f.bundle, ctx);
  f.payload.data.updated_date = "2026-09-18T20:00:00.000Z";
  const inv = await inventory([f], "2026-24");
  const view = await read.inventory(inv.id, ctx, 0);
  assert.equal(view.coverage.captured, BigInt("1"));
  assert.equal(view.coverage.complete, true);
  assert.equal(view.items[0].captured, true);
  f.bundle.detail = Buffer.from(JSON.stringify(f.payload));
  assert.equal(
    (await service.capture(bindingId, f.bundle, ctx)).status,
    "NEEDS_REVIEW",
  );
  assert.equal((await read.inventory(inv.id, ctx, 0)).coverage.complete, false);
});

test("conflicting exact VIN/unit mappings remain unresolved without blocking capture", async () => {
  const vin = randomUUID().replace(/-/g, "").slice(0, 17).toUpperCase();
  const a = await prisma.truck.create({
    data: {
      companyId: ctx.activeCompanyId,
      unitNumber: "REVIEW-A",
      unitNumberNormalized: "REVIEW-A",
      vin,
      vinNormalized: vin,
    },
  });
  const f = statementFixture();
  Object.assign(f.payload.data.header.driver.truck_info, {
    vin: a.vin,
    unit: "8558",
  });
  f.bundle.detail = Buffer.from(JSON.stringify(f.payload));
  const captured = await service.capture(bindingId, f.bundle, ctx);
  const detail = await read.detail(captured.statementId, ctx);
  assert.equal(detail.version.trucks[0].truckId, null);
  assert.equal(detail.version.trucks[0].mappingStatus, "NEEDS_REVIEW");
  assert.equal(
    await prisma.truck.count({ where: { companyId: ctx.activeCompanyId } }),
    2,
  );
});

test("42-item interruption and repeated resume retain exactly one version, PDF, line set and success audit per identity", async () => {
  const p = new FixtureArchiveProvider();
  const b = await service.bind(ctx.activeCompanyId, p.companyId, p, ctx);
  p.fixtures = Array.from({ length: 42 }, (_, i) =>
    statementFixture({ terminated: i < 38, contractor: i % 2 === 0 }),
  );
  // Same recipient, PID, Truck, and number are deliberately shared by distinct UUIDs.
  for (const f of p.fixtures) {
    f.recipientId = p.fixtures[0].recipientId;
    f.payload.data.driver_id = f.recipientId;
    f.bundle.detail = Buffer.from(JSON.stringify(f.payload));
  }
  const inv = await service.discover(b.id, "2026-37", p, ctx);
  const items = await prisma.archiveInventoryItem.findMany({
    where: { inventoryId: inv.id },
    orderBy: { id: "asc" },
  });
  const run = async (from: number, to: number) => {
    for (let i = from; i < to; i += 5)
      await service.run(
        inv.id,
        items.slice(i, Math.min(i + 5, to)).map((x) => x.id),
        p,
        ctx,
      );
  };
  await run(0, 20);
  assert.equal(
    (await read.inventory(inv.id, ctx, 0)).coverage.captured,
    BigInt(20),
  );
  await run(0, 42);
  await run(0, 42);
  const result = await read.inventory(inv.id, ctx, 0);
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.captured, BigInt(42));
  assert.equal(p.reads, 42);
  const versions = await prisma.archiveVersion.findMany({
    where: { statement: { archiveCompanyId: b.id } },
    include: { _count: { select: { lines: true } } },
  });
  assert.equal(versions.length, 42);
  assert.equal(new Set(versions.map((v) => v.documentId)).size, 42);
  assert.equal(new Set(versions.map((v) => v.detailStorageKey)).size, 42);
  assert.ok(versions.every((v) => v._count.lines === 3));
  const ids = new Set(versions.map((v) => v.statementId));
  const audit = await prisma.financialAuditEvent.findMany({
    where: {
      operatingGroupId: ctx.operatingGroupId,
      action: "ARCHIVE_VERSION_CAPTURED",
    },
  });
  assert.equal(
    audit.filter((a) =>
      ids.has(String((a.metadata as { statementId?: string }).statementId)),
    ).length,
    42,
  );
  const old = await read.inventory(inv.id, ctx, 0);
  p.fixtures = p.fixtures.slice(0, 41);
  const refreshed = await service.discover(b.id, "2026-37", p, ctx);
  assert.equal(
    (await read.inventory(inv.id, ctx, 0)).snapshot.fingerprint,
    old.snapshot.fingerprint,
  );
  assert.equal(
    (await read.inventory(refreshed.id, ctx, 0)).coverage.unexpected,
    BigInt(1),
  );
  assert.equal(
    (await read.inventories(ctx, 0, b.id)).items[0].id,
    refreshed.id,
  );
  // Equal totals cannot hide an unexpected old UUID replacing a new expected UUID.
  const replacement = statementFixture();
  p.fixtures.push(replacement);
  const equalCount = await service.discover(b.id, "2026-37", p, ctx);
  const mismatch = await read.inventory(equalCount.id, ctx, 0);
  assert.equal(mismatch.coverage.expected, BigInt(42));
  assert.equal(mismatch.coverage.captured, BigInt(41));
  assert.equal(mismatch.coverage.missing, BigInt(1));
  assert.equal(mismatch.coverage.unexpected, BigInt(1));
  assert.equal(mismatch.coverage.complete, false);
  await service.capture(b.id, replacement.bundle, ctx);
  const excess = await read.inventory(equalCount.id, ctx, 0);
  assert.equal(excess.coverage.captured, BigInt(42));
  assert.equal(excess.coverage.unexpected, BigInt(1));
  assert.equal(excess.coverage.complete, false);
});

test("invalid list filters are rejected before querying archive rows", async () => {
  for (const query of [
    "page=-1",
    "pid=bad",
    "type=OWNER",
    "status=COMPLETE",
    "lifecycle=unknown",
    "recipient=" + "x".repeat(201),
  ])
    await assert.rejects(() =>
      read.statements(ctx, new URLSearchParams(query)),
    );
});

test("coverage uses UTC instants even in a non-UTC database session", async () => {
  const f = statementFixture({ pid: "2026-30" });
  const inv = await inventory([f], "2026-30");
  await service.capture(bindingId, f.bundle, ctx);
  const rows = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL TIME ZONE 'America/Los_Angeles'`;
    return tx.$queryRaw<
      { captured: bigint }[]
    >`SELECT captured FROM "ArchiveCoverage" WHERE id=${inv.id}`;
  });
  assert.equal(rows[0].captured, BigInt(1));
});

test("uncommitted sealed parent cannot admit a late child after its sealing transaction commits", async () => {
  const id = randomUUID();
  let ready!: () => void, release!: () => void;
  const created = new Promise<void>((r) => {
    ready = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const parent = prisma.$transaction(
    async (tx) => {
      await tx.archiveInventory.create({
        data: {
          id,
          archiveCompanyId: bindingId,
          pid: "2026-29",
          expectedCount: 0,
          fingerprint: "synthetic",
          capturedByUserId: ctx.userId,
          metadata: {},
        },
      });
      await tx.archiveInventory.update({
        where: { id },
        data: { sealed: true },
      });
      ready();
      await gate;
    },
    { timeout: 5000 },
  );
  await created;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const child = prisma.archiveInventoryItem.create({
      data: {
        inventoryId: id,
        providerStatementId: randomUUID(),
        providerVersion: 1,
        recipientId: randomUUID(),
        recipientType: "DRIVER",
        metadata: {},
      },
    });
    await assert.rejects(
      () =>
        Promise.race([
          child,
          new Promise((_, reject) => {
            timer = setTimeout(
              () => reject(Error("Child waited for invisible parent")),
              1500,
            );
          }),
        ]),
      /sealed or unavailable archive evidence/,
    );
  } finally {
    if (timer) clearTimeout(timer);
    release();
    await parent;
  }
  assert.equal(
    await prisma.archiveInventoryItem.count({ where: { inventoryId: id } }),
    0,
  );
});

test("UUID casing cannot create a second inventory identity or prevent completeness", async () => {
  const f = statementFixture({ pid: "2026-28" });
  f.id = f.id.toUpperCase();
  f.recipientId = f.recipientId.toUpperCase() as typeof f.recipientId;
  f.payload.data.statement_id = f.id;
  f.payload.data.driver_id = f.recipientId;
  f.bundle.detail = Buffer.from(JSON.stringify(f.payload));
  const inv = await inventory([f], "2026-28");
  await service.capture(bindingId, f.bundle, ctx);
  assert.equal((await read.inventory(inv.id, ctx, 0)).coverage.complete, true);
  const copy = { ...f, id: f.id.toLowerCase() };
  await assert.rejects(() => inventory([f, copy], "2026-28"), /unique/);
});

test("individual PDF, JSON, parse, timeout and auth failures preserve successful captures and retry without duplicates", async () => {
  const p = new FixtureArchiveProvider();
  const b = await service.bind(ctx.activeCompanyId, p.companyId, p, ctx);
  p.fixtures = Array.from({ length: 6 }, () =>
    statementFixture({ pid: "2026-27" }),
  );
  const inv = await service.discover(b.id, "2026-27", p, ctx);
  const items = await prisma.archiveInventoryItem.findMany({
    where: { inventoryId: inv.id },
    orderBy: { id: "asc" },
  });
  const original = p.bundle.bind(p);
  let mode = "good";
  p.bundle = async (company, id) => {
    if (mode === "timeout")
      throw new ArchiveProviderError("PROVIDER_UNAVAILABLE");
    if (mode === "auth")
      throw new ArchiveProviderError("AUTHENTICATION_REQUIRED");
    if (mode === "json") throw new ArchiveProviderError("SOURCE_NOT_FOUND");
    const bundle = await original(company, id);
    if (mode === "pdf") return { ...bundle, pdf: Buffer.from("not a PDF") };
    if (mode === "parse")
      return { ...bundle, detail: Buffer.from("invalid JSON") };
    return bundle;
  };
  await service.run(inv.id, [items[0].id], p, ctx);
  for (const [index, failure] of [
    "pdf",
    "json",
    "parse",
    "timeout",
    "auth",
  ].entries()) {
    mode = failure;
    await service.run(inv.id, [items[index + 1].id], p, ctx);
    const view = await read.inventory(inv.id, ctx, 0);
    assert.equal(view.coverage.complete, false);
    assert.equal(view.coverage.captured, BigInt(1));
  }
  mode = "good";
  for (const item of items) await service.run(inv.id, [item.id], p, ctx);
  assert.equal((await read.inventory(inv.id, ctx, 0)).coverage.complete, true);
  assert.equal(
    await prisma.archiveVersion.count({
      where: { statement: { archiveCompanyId: b.id } },
    }),
    6,
  );
});
