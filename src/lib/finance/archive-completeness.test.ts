import { inventoryFingerprint, hash } from "./archive-normalize";
import "dotenv/config";
import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { FilesystemPrivateFileStorage } from "@/lib/storage/private-file-storage";
import { ArchiveService, json } from "./archive-service";
import { ArchiveReadService } from "./archive-read";
import { FinancialControlService } from "./financial-control-service";
import type { FinancialAuthorization } from "./financial-control-authorization";
import {
  FixtureArchiveProvider,
  statementFixture,
} from "../../../tests/fixtures/quickmanage";
import { acceptedStatementFixtures } from "../../../tests/fixtures/quickmanage-accepted";

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

test("five accepted UUID/version shapes: 5 sealed versions, 5 PDFs/JSON, 71 unchanged lines and complete scoped snapshots", async () => {
  const fixtures = acceptedStatementFixtures();
  const economicsBefore = await economics();
  const snapshots: { id: string }[] = [];
  const bindings = [bindingId];
  // Two separately scoped Companies, matching the acceptance sample layout.
  const company = await prisma.company.create({
    data: { name: "Second synthetic carrier" },
  });
  await prisma.operatingGroupCompany.create({
    data: { companyId: company.id, operatingGroupId: ctx.operatingGroupId },
  });
  ctx.companyIds.push(company.id);
  await prisma.companyMembership.create({
    data: { companyId: company.id, userId: ctx.userId, role: "OWNER" },
  });
  const second = new FixtureArchiveProvider();
  bindings.push(
    (await service.bind(company.id, second.companyId, second, ctx)).id,
  );
  for (const [index, pid] of ["2026-37", "2026-36"].entries()) {
    const p = index === 0 ? provider : second;
    p.fixtures = fixtures.filter((f) => f.pid === pid);
    const snapshot = await service.discover(bindings[index], pid, p, ctx);
    const items = await prisma.archiveInventoryItem.findMany({
      where: { inventoryId: snapshot.id },
    });
    await service.run(
      snapshot.id,
      items.map((i) => i.id),
      p,
      ctx,
    );
    snapshots.push(snapshot);
  }
  const evidence = () =>
    prisma.archiveVersion.findMany({
      where: { statement: { archiveCompanyId: { in: bindings } } },
      include: {
        lines: { orderBy: [{ sourceArray: "asc" }, { sourceOrder: "asc" }] },
        document: true,
      },
      orderBy: { id: "asc" },
    });
  const before = await evidence();
  // Run the old and new view against the SAME sealed rows in a disposable
  // transaction. The migration must repair reads, never rewrite evidence.
  await prisma.$transaction(async (tx) => {
    const oldSql = (
      await readFile(
        "prisma/migrations/20260919070000_archive_integrity_guards/migration.sql",
        "utf8",
      )
    ).split("-- An unseen")[0];
    const newSql = await readFile(
      "prisma/migrations/20260920120000_archive_coverage_provider_identity/migration.sql",
      "utf8",
    );
    await tx.$executeRawUnsafe(oldSql);
    const oldCoverage = await tx.$queryRaw<
      { captured: bigint }[]
    >`SELECT captured FROM "ArchiveCoverage" WHERE id IN (${snapshots[0].id},${snapshots[1].id})`;
    assert.equal(
      oldCoverage.reduce((n, x) => n + Number(x.captured), 0),
      0,
    );
    await tx.$executeRawUnsafe(newSql);
    const fixed = await tx.$queryRaw<
      { captured: bigint }[]
    >`SELECT captured FROM "ArchiveCoverage" WHERE id IN (${snapshots[0].id},${snapshots[1].id})`;
    assert.equal(
      fixed.reduce((n, x) => n + Number(x.captured), 0),
      5,
    );
  });

  assert.equal(before.length, 5);
  assert.equal(
    before.reduce((sum, v) => sum + v.lines.length, 0),
    71,
  );
  assert.ok(before.every((v) => v.sealed));
  assert.equal(
    (await readdir(path.join(root, "financial-statements"))).length,
    5,
  );
  assert.equal(
    (await readdir(path.join(root, "quickmanage-details"))).length,
    5,
  );
  const cov = await Promise.all(
    snapshots.map((s) => read.inventory(s.id, ctx, 0)),
  );
  console.log(
    "Five-shape reproduction",
    JSON.stringify(
      cov.map((c) => c.coverage),
      (_, v) => (typeof v === "bigint" ? String(v) : v),
    ),
  );
  assert.equal(
    cov.reduce((sum, c) => sum + Number(c.coverage.captured), 0),
    5,
  );
  for (const c of cov) {
    assert.equal(c.coverage.complete, true);
    for (const k of ["missing", "conflicts", "failed", "unexpected"] as const)
      assert.equal(c.coverage[k], BigInt(0));
    assert.ok(c.items.every((i) => i.captured));
  }
  assert.equal((await read.overview(ctx)).complete, BigInt(2));
  assert.ok((await read.inventories(ctx, 0)).items.every((i) => i.complete));
  assert.deepEqual(await evidence(), before);
  assert.deepEqual(await economics(), economicsBefore);
  const fractional = before.find((v) => v.providerVersion === 17)!;
  assert.deepEqual(
    fractional.lines.slice(0, 3).map((l) => l.rawAmount),
    ["4643.6192", "442.99199999999996", "1928.3968"],
  );
  assert.ok(fractional.lines.slice(0, 3).every((l) => l.amountMinor === null));
});

test("freshness compares exact raw instants; identity/version/checksum protections remain separate", async () => {
  const f = statementFixture({ pid: "2026-34" });
  f.payload.data.updated_date = "2026-09-18T12:00:00.725261Z";
  f.bundle.detail = Buffer.from(JSON.stringify(f.payload));
  const expected = {
    statementId: f.id,
    pid: f.pid,
    recipientId: f.recipientId,
    providerVersion: 1,
    updatedAt: "2026-09-18T08:00:00.725261000-04:00",
    deductions: "200.25",
  };
  const first = await service.capture(bindingId, f.bundle, ctx, expected);
  assert.equal(
    (await service.capture(bindingId, f.bundle, ctx, expected)).idempotent,
    true,
  );
  await assert.rejects(
    () =>
      service.capture(bindingId, f.bundle, ctx, {
        ...expected,
        updatedAt: "2026-09-18T12:00:00.725262Z",
      }),
    /INVENTORY_STALE/,
  );
  await assert.rejects(
    () =>
      service.capture(bindingId, f.bundle, ctx, {
        ...expected,
        providerVersion: 2,
      }),
    /INVENTORY_STALE/,
  );
  await assert.rejects(
    () =>
      service.capture(bindingId, f.bundle, ctx, {
        ...expected,
        updatedAt: "",
      }),
    /Invalid source timestamp/,
  );
  // Absent optional inventory timestamp does not invent a freshness condition.
  assert.equal(
    (
      await service.capture(bindingId, f.bundle, ctx, {
        ...expected,
        updatedAt: null,
      })
    ).idempotent,
    true,
  );
  const changed = {
    ...f.bundle,
    pdf: Buffer.from("%PDF-1.4\nchanged content\n%%EOF"),
  };
  assert.equal(
    (await service.capture(bindingId, changed, ctx, expected)).status,
    "NEEDS_REVIEW",
  );
  assert.equal(
    await prisma.archiveVersion.count({
      where: { statementId: first.statementId },
    }),
    1,
  );

  const newer = statementFixture({ pid: "2026-33" });
  await service.capture(bindingId, newer.bundle, ctx);
  newer.payload.data.version = 2; // Same timestamp, different provider version.
  newer.bundle.detail = Buffer.from(JSON.stringify(newer.payload));
  const result = await service.capture(bindingId, newer.bundle, ctx);
  assert.equal(result.status, "SOURCE_CHANGED");
  assert.equal(
    await prisma.archiveVersion.count({
      where: { statementId: result.statementId },
    }),
    2,
  );
});

test("coverage keeps UUID/version and recipient guards", async () => {
  const f = statementFixture({ pid: "2026-32" });
  await service.capture(bindingId, f.bundle, ctx);
  provider.fixtures = [f];
  const base = await provider.inventory(provider.companyId, f.pid);
  for (const patch of [
    { version: "2" },
    { driver_id: randomUUID() },
    { contractor: true },
    { statement_id: randomUUID() },
  ]) {
    const inv = await service.saveInventory(
      bindingId,
      f.pid,
      {
        ...base,
        items: base.items.map((x) => ({ ...x, ...patch })),
        fingerprint: inventoryFingerprint(
          base.items.map((x) => ({ ...x, ...patch })),
        ),
      },
      ctx,
    );
    const check = await read.inventory(inv.id, ctx, 0);
    assert.equal(check.coverage.captured, BigInt(0));
    assert.equal(check.coverage.complete, false);
    assert.equal(check.items[0].captured, false);
  }
});

test("pre-fix immutable inventory fingerprints remain idempotent after canonicalization", async () => {
  const f = statementFixture({ pid: "2026-23" });
  f.payload.data.updated_date = "2026-09-18T08:00:00.725261000-04:00";
  provider.fixtures = [f];
  const manifest = await provider.inventory(provider.companyId, f.pid);
  const rawFingerprint = hash(
    manifest.items
      .map((x) => JSON.stringify(x))
      .sort()
      .join("\n"),
  );
  const old = await prisma.$transaction(async (tx) => {
    const inventory = await tx.archiveInventory.create({
      data: {
        archiveCompanyId: bindingId,
        pid: f.pid,
        expectedCount: 1,
        fingerprint: rawFingerprint,
        capturedByUserId: ctx.userId,
        metadata: { verifiedTwice: true },
        items: {
          create: {
            providerStatementId: f.id,
            providerVersion: 1,
            recipientId: f.recipientId,
            recipientType: "DRIVER",
            providerUpdatedAt: f.payload.data.updated_date,
            metadata: json(manifest.items[0]),
            job: { create: {} },
          },
        },
      },
    });
    return tx.archiveInventory.update({
      where: { id: inventory.id },
      data: { sealed: true },
    });
  });
  const retry = await service.saveInventory(bindingId, f.pid, manifest, ctx);
  assert.equal(retry.id, old.id);
  assert.equal(retry.fingerprint, rawFingerprint);
  assert.equal(
    await prisma.archiveInventory.count({
      where: { archiveCompanyId: bindingId, pid: f.pid },
    }),
    1,
  );
});
