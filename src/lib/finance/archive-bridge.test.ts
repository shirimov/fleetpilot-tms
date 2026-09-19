import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { FilesystemPrivateFileStorage } from "@/lib/storage/private-file-storage";
import {
  ArchiveBridgeService,
  expandArchiveScope,
} from "./archive-bridge-service";
import { ArchiveService } from "./archive-service";
import { ArchiveReadService } from "./archive-read";
import { FinancialControlService } from "./financial-control-service";
import type { FinancialAuthorization } from "./financial-control-authorization";
import { statementFixture } from "../../../tests/fixtures/quickmanage";
import {
  catalogEvidence,
  inventoryEvidence,
  bundleEvidence,
} from "../../../tests/fixtures/quickmanage-browser";
let c: FinancialAuthorization,
  bridge: ArchiveBridgeService,
  root: string,
  catalogId: string;
const companyId = randomUUID(),
  read = new ArchiveReadService();
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "qm-browser-"));
  const company = await prisma.company.create({
      data: { name: "Synthetic Carrier" },
    }),
    user = await prisma.user.create({
      data: {
        email: randomUUID() + "@example.test",
        displayName: "Bridge owner",
        activeCompanyId: company.id,
        memberships: { create: { companyId: company.id, role: "OWNER" } },
      },
    });
  const group = await new FinancialControlService().createGroup(
    "Browser bridge",
    {
      companyId: company.id,
      role: "OWNER",
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        activeCompanyId: company.id,
        isActive: true,
      },
    },
  );
  c = {
    userId: user.id,
    activeCompanyId: company.id,
    companyIds: [company.id],
    operatingGroupId: group.id,
    role: "OWNER",
  };
  process.env.QUICKMANAGE_ARCHIVE_ACCOUNT_KEY =
    "synthetic-browser-" + randomUUID();
  process.env.QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID = group.id;
  bridge = new ArchiveBridgeService(
    prisma,
    new ArchiveService(
      prisma,
      new FilesystemPrivateFileStorage("financial-statements", root),
      new FilesystemPrivateFileStorage("quickmanage-details", root),
    ),
  );
  catalogId = (await bridge.catalog(catalogEvidence(companyId), c)).id;
});
after(async () => {
  await rm(root, { recursive: true, force: true });
  await prisma.$disconnect();
});
const confirm = () => ({
  catalogId,
  providerCompanyId: companyId,
  companyId: c.activeCompanyId,
  confirmation: "CONFIRM_COMPANY_IDENTITY",
  reason: "Synthetic authoritative owner confirmation",
  historical: false,
});
test("unbound/unauthorized Company and non-owner bindings fail closed", async () => {
  await assert.rejects(() =>
    bridge.inventory(inventoryEvidence(companyId, [statementFixture()]), c),
  );
  await assert.rejects(() => bridge.bind(confirm(), { ...c, role: "ADMIN" }));
  await assert.rejects(() =>
    bridge.bind({ ...confirm(), providerCompanyId: randomUUID() }, c),
  );
  await assert.rejects(() =>
    bridge.bind({ ...confirm(), companyId: randomUUID() }, c),
  );
  await assert.rejects(() =>
    bridge.bind({ ...confirm(), confirmation: "" }, c),
  );
});
test("explicit verified binding creates immutable scoped grant/audit, catalog retry idempotent", async () => {
  assert.equal(
    (await bridge.catalog(catalogEvidence(companyId), c)).id,
    catalogId,
  );
  const b = await bridge.bind(confirm(), c);
  assert.equal((await bridge.bind(confirm(), c)).id, b.id);
  const audit = await prisma.financialAuditEvent.findMany({
    where: {
      operatingGroupId: c.operatingGroupId,
      action: "ARCHIVE_BROWSER_COMPANY_CONFIRMED",
    },
  });
  assert.equal(audit.length, 1);
  assert.equal((await bridge.review(c)).rows[0].status, "VERIFIED");
  await assert.rejects(() =>
    prisma.archiveCompany.update({
      where: { id: b.id },
      data: { providerCompanyName: "Overwrite" },
    }),
  );
});
test("inventory identical retry/concurrency is idempotent, changes preserve old snapshots", async () => {
  const f = statementFixture(),
    e = inventoryEvidence(companyId, [f]);
  const [a, b] = await Promise.all([
    bridge.inventory(e, c),
    bridge.inventory(e, c),
  ]);
  assert.equal(a.id, b.id);
  const changed = await bridge.inventory(
    inventoryEvidence(companyId, [f, statementFixture()]),
    c,
  );
  assert.notEqual(changed.id, a.id);
  assert.equal(
    await prisma.archiveInventoryItem.count({ where: { inventoryId: a.id } }),
    1,
  );
});
test("partial/full completeness, resume, duplicate/concurrent evidence produce one immutable version and no duplicate success audit", async () => {
  const fs = [
      statementFixture({ terminated: true }),
      statementFixture({ contractor: true }),
    ],
    snapshot = await bridge.inventory(inventoryEvidence(companyId, fs), c);
  await bridge.capture(snapshot.id, bundleEvidence(companyId, fs[0]), c);
  let r = await read.inventory(snapshot.id, c, 0);
  assert.equal(r.coverage.captured, BigInt("1"));
  assert.equal(r.coverage.missing, BigInt("1"));
  assert.equal(
    r.items.find((x) => x.providerStatementId === fs[0].id)?.captured,
    true,
  );
  await Promise.all([
    bridge.capture(snapshot.id, bundleEvidence(companyId, fs[1]), c),
    bridge.capture(snapshot.id, bundleEvidence(companyId, fs[1]), c),
  ]);
  const repeat = await bridge.capture(
    snapshot.id,
    bundleEvidence(companyId, fs[1]),
    c,
  );
  assert.equal("idempotent" in repeat && repeat.idempotent, true);
  r = await read.inventory(snapshot.id, c, 0);
  assert.equal(r.coverage.complete, true);
  assert.equal(r.coverage.captured, BigInt("2"));
  assert.equal(r.coverage.missing, BigInt("0"));
  const statements = await prisma.archiveStatement.findMany({
    where: { providerStatementId: { in: fs.map((f) => f.id) } },
    include: { versions: { include: { lines: true } } },
  });
  assert.equal(statements.length, 2);
  assert.ok(statements.every((s) => s.versions.length === 1));
  assert.equal(statements[0].versions[0].lines.length, 3);
  const events = await prisma.financialAuditEvent.findMany({
    where: {
      operatingGroupId: c.operatingGroupId,
      action: "ARCHIVE_VERSION_CAPTURED",
    },
  });
  assert.equal(events.length, 2);
});
test("new version preserves old; checksum conflict quarantines and marks review", async () => {
  const f = statementFixture({ pid: "2025-42" }),
    snapshot = await bridge.inventory(inventoryEvidence(companyId, [f]), c);
  await bridge.capture(snapshot.id, bundleEvidence(companyId, f), c);
  assert.equal(
    (await read.inventory(snapshot.id, c, 0)).coverage.complete,
    true,
  );
  const changed = structuredClone(f.payload);
  changed.data.version = 2;
  const next = {
    ...f,
    payload: changed,
    bundle: { ...f.bundle, detail: Buffer.from(JSON.stringify(changed)) },
  };
  const newer = await bridge.inventory(inventoryEvidence(companyId, [next]), c);
  await bridge.capture(newer.id, bundleEvidence(companyId, next), c);
  const conflict = {
    ...next,
    bundle: {
      ...next.bundle,
      pdf: Buffer.from("%PDF-1.4\n% Different source\n%%EOF"),
    },
  };
  assert.equal(
    (await bridge.capture(newer.id, bundleEvidence(companyId, conflict), c))
      .status,
    "NEEDS_REVIEW",
  );
  const s = await prisma.archiveStatement.findFirstOrThrow({
    where: { providerStatementId: f.id },
    include: { versions: true, conflicts: true },
  });
  assert.equal(s.versions.length, 2);
  assert.equal(s.conflicts.length, 1);
  assert.equal((await read.inventory(newer.id, c, 0)).coverage.complete, false);
});
test("terminated and unknown/inactive/ambiguous trucks never block archival", async () => {
  await prisma.truck.create({
    data: {
      companyId: c.activeCompanyId,
      unitNumber: "8558",
      unitNumberNormalized: "8558",
      status: "INACTIVE",
      vinNormalized: "SYNTHETICVIN",
    },
  });
  await prisma.truck.create({
    data: {
      companyId: c.activeCompanyId,
      unitNumber: "other",
      unitNumberNormalized: "OTHER",
      status: "ACTIVE",
      vinNormalized: "DIFFERENTVIN",
    },
  });
  for (const [unit, vin, status] of [
    ["8558", null, "COMPANY_UNIT"],
    ["unknown", null, "NEEDS_REVIEW"],
    ["8558", "DIFFERENTVIN", "NEEDS_REVIEW"],
  ] as const) {
    const f = statementFixture({
      terminated: true,
      contractor: true,
      pid: "2024-01",
    });
    Object.assign(f.payload.data.header.driver.truck_info, { unit, vin });
    f.bundle.detail = Buffer.from(JSON.stringify(f.payload));
    const snapshot = await bridge.inventory(
      inventoryEvidence(companyId, [f]),
      c,
    );
    await bridge.capture(snapshot.id, bundleEvidence(companyId, f), c);
    const s = await prisma.archiveStatement.findFirstOrThrow({
      where: { providerStatementId: f.id },
      include: { versions: { include: { trucks: true } } },
    });
    assert.equal(s.versions[0].recipientStatus, "terminated");
    assert.equal(s.versions[0].trucks[0].mappingStatus, status);
  }
  assert.equal(
    (
      await prisma.truck.findFirstOrThrow({
        where: { companyId: c.activeCompanyId, unitNumber: "8558" },
      })
    ).status,
    "INACTIVE",
  );
});
test("historical grant is explicit, does not join Accounting; membership and group isolation remain", async () => {
  const historic = await prisma.company.create({
      data: {
        name: "Historical synthetic",
        memberships: { create: { userId: c.userId, role: "OWNER" } },
      },
    }),
    pid = randomUUID();
  const e = catalogEvidence(pid);
  e.companies[0].carrier_name = "Historical synthetic";
  const cat = await bridge.catalog(e, c);
  const binding = {
    ...confirm(),
    catalogId: cat.id,
    companyId: historic.id,
    providerCompanyId: pid,
  };
  await assert.rejects(() => bridge.bind(binding, c));
  const b = await bridge.bind({ ...binding, historical: true }, c);
  assert.equal(
    await prisma.operatingGroupCompany.count({
      where: { companyId: historic.id },
    }),
    0,
  );
  assert.equal(
    await prisma.archiveScopeGrant.count({ where: { companyId: historic.id } }),
    1,
  );
  await assert.rejects(() =>
    bridge.inventory(inventoryEvidence(pid, [statementFixture()]), c),
  );
  await assert.rejects(() =>
    bridge.inventory(inventoryEvidence(companyId, [statementFixture()]), {
      ...c,
      operatingGroupId: randomUUID(),
    }),
  );
  const expanded = await expandArchiveScope(c);
  assert.ok(expanded.companyIds.includes(historic.id));
  const fixture = statementFixture({ terminated: true, pid: "2025-43" });
  fixture.payload.data.header.carrier.name = "Historical synthetic";
  fixture.bundle.detail = Buffer.from(JSON.stringify(fixture.payload));
  const inventory = await bridge.inventory(
    inventoryEvidence(pid, [fixture]),
    expanded,
  );
  await bridge.capture(inventory.id, bundleEvidence(pid, fixture), expanded);
  assert.equal(
    (await read.inventory(inventory.id, expanded, 0)).coverage.complete,
    true,
  );
  await prisma.companyMembership.delete({
    where: { userId_companyId: { userId: c.userId, companyId: historic.id } },
  });
  const revoked = await expandArchiveScope(c);
  assert.ok(!revoked.companyIds.includes(historic.id));
  await assert.rejects(() => read.inventory(inventory.id, revoked, 0));
  const otherGroup = await prisma.operatingGroup.create({
    data: { name: "Foreign synthetic" },
  });
  await assert.rejects(() =>
    prisma.operatingGroupCompany.create({
      data: { companyId: historic.id, operatingGroupId: otherGroup.id },
    }),
  );
  assert.ok(b.id);
});
test("bridge creates zero economic records", async () => {
  assert.equal(
    await prisma.financialTransaction.count({
      where: { operatingGroupId: c.operatingGroupId },
    }),
    0,
  );
  assert.equal(
    await prisma.financialAllocation.count({
      where: { transaction: { operatingGroupId: c.operatingGroupId } },
    }),
    0,
  );
  assert.equal(
    await prisma.financialExpectation.count({
      where: { operatingGroupId: c.operatingGroupId },
    }),
    0,
  );
  assert.equal(
    await prisma.financialExpectationBankMatch.count({
      where: { operatingGroupId: c.operatingGroupId },
    }),
    0,
  );
  assert.equal(
    await prisma.pilotFuelingEvent.count({
      where: { invoice: { operatingGroupId: c.operatingGroupId } },
    }),
    0,
  );
});
test("posted Pilot baseline survives the complete browser bridge pipeline", async () => {
  const { postedAccountingFixture } = await import(
    "../../../tests/fixtures/accounting-posted"
  );
  const f = await postedAccountingFixture();
  process.env.QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID =
    f.context.operatingGroupId;
  const provider = randomUUID();
  const cat = await bridge.catalog(catalogEvidence(provider), f.context);
  const snapshot = async () => ({
    net: (await new FinancialControlService().overview(f.context)).business
      .netExpensesMinor,
    transactions: await prisma.financialTransaction.count({
      where: { operatingGroupId: f.context.operatingGroupId },
    }),
    allocations: await prisma.financialAllocation.count({
      where: { transaction: { operatingGroupId: f.context.operatingGroupId } },
    }),
    evidence: await prisma.financialTransactionEvidence.count({
      where: { transaction: { operatingGroupId: f.context.operatingGroupId } },
    }),
    events: await prisma.pilotFuelingEvent.count({
      where: { invoice: { operatingGroupId: f.context.operatingGroupId } },
    }),
    matched: await prisma.financialExpectation.count({
      where: {
        operatingGroupId: f.context.operatingGroupId,
        status: "MATCHED",
      },
    }),
    matches: await prisma.financialExpectationBankMatch.count({
      where: { operatingGroupId: f.context.operatingGroupId },
    }),
    truck: (
      await prisma.truck.findFirstOrThrow({
        where: { companyId: f.company.id, unitNumber: "8558" },
      })
    ).status,
  });
  const before = await snapshot();
  assert.deepEqual(before, {
    net: "40955325",
    transactions: 699,
    allocations: 1083,
    evidence: 1083,
    events: 698,
    matched: 5,
    matches: 5,
    truck: "INACTIVE",
  });
  await bridge.bind(
    {
      catalogId: cat.id,
      providerCompanyId: provider,
      companyId: f.company.id,
      confirmation: "CONFIRM_COMPANY_IDENTITY",
      historical: false,
      reason: "Synthetic regression",
    },
    f.context,
  );
  const statement = statementFixture({ terminated: true });
  const inv = await bridge.inventory(
    inventoryEvidence(provider, [statement]),
    f.context,
  );
  await bridge.capture(inv.id, bundleEvidence(provider, statement), f.context);
  await bridge.capture(inv.id, bundleEvidence(provider, statement), f.context);
  assert.deepEqual(await snapshot(), before);
});
