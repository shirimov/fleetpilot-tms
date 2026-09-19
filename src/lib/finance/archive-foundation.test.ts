import "dotenv/config";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { FilesystemPrivateFileStorage } from "@/lib/storage/private-file-storage";
import { ArchiveService, archiveDocumentScope } from "./archive-service";
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

test("a changed inventory timestamp cannot count an older same-version capture", async () => {
  const f = statementFixture({ pid: "2026-35" });
  await service.capture(bindingId, f.bundle, ctx);
  f.payload.data.updated_date = "2026-09-18T20:00:00.000Z";
  const inv = await inventory([f], "2026-35");
  const view = await read.inventory(inv.id, ctx, 0);
  assert.equal(view.coverage.captured, BigInt("0"));
  assert.equal(view.coverage.complete, false);
  assert.equal(view.items[0].captured, false);
});
