import { fixtureCaptureRun } from "../../../tests/fixtures/archive-run";
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
  assessArchiveCompanyProvenance,
  expandArchiveScope,
  legacyProvenanceCompatibilityAudit,
} from "./archive-bridge-service";
import { ArchiveService } from "./archive-service";
import { ArchiveReadService } from "./archive-read";
import { FinancialControlService } from "./financial-control-service";
import type { CaptureContext as FinancialAuthorization } from "./archive-capture-run";
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
test("only the documented 1-9 swapped-field provenance is compatible", () => {
  const canonical = {
    id: "cdf065bb-9002-4aa6-86b1-dd66f75e8692",
    name: "1-9 Transportation Inc",
  };
  const source = {
    id: "964e6cf7-9d60-4aba-af76-4212a6e28071",
    carrier_name: "1-9 Transportation Inc",
  };
  const legacy = {
    id: "immutable-legacy-event",
    action: "TRUCK_IMPORTED_FROM_QUICKMANAGE",
    metadata: {
      provider: "QUICKMANAGE",
      operatedBy: "1-9 Transportation Inc",
      sourceCompanyId: "e28fb8ff-0822-4166-954a-52d9544c0b0c",
      sourceTruckId: source.id,
    },
  };
  assert.deepEqual(
    assessArchiveCompanyProvenance(canonical, source, [legacy]),
    {
      conflict: false,
      legacyEventIds: [legacy.id],
    },
  );
  for (const changed of [
    { ...legacy, action: "IMPORT" },
    {
      ...legacy,
      metadata: { ...legacy.metadata, sourceTruckId: randomUUID() },
    },
    {
      ...legacy,
      metadata: { ...legacy.metadata, sourceCompanyId: randomUUID() },
    },
    { ...legacy, metadata: { ...legacy.metadata, operatedBy: "Other" } },
  ]) {
    assert.deepEqual(
      assessArchiveCompanyProvenance(canonical, source, [changed]),
      { conflict: true, legacyEventIds: [] },
    );
  }
  assert.equal(
    assessArchiveCompanyProvenance({ ...canonical, id: randomUUID() }, source, [
      legacy,
    ]).conflict,
    true,
  );
  assert.equal(
    assessArchiveCompanyProvenance(canonical, source, [legacy, legacy])
      .conflict,
    true,
  );
  assert.equal(
    assessArchiveCompanyProvenance(canonical, source, [
      legacy,
      {
        ...legacy,
        id: "separate-conflict",
        metadata: { ...legacy.metadata, sourceCompanyId: randomUUID() },
      },
    ]).conflict,
    true,
  );
  assert.deepEqual(legacyProvenanceCompatibilityAudit([legacy.id]), {
    mode: "LEGACY_SWAPPED_COMPANY_TRUCK_FIELDS_V1",
    lifecycleEventIds: [legacy.id],
    originalEventPreserved: true,
    currentProviderIdentity: "INDEPENDENTLY_VERIFIED_BROWSER_CATALOG",
  });
  assert.equal(legacyProvenanceCompatibilityAudit([]), null);
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
  await fixtureCaptureRun(c);
  assert.equal((await bridge.bind(confirm(), c)).id, b.id);
  const audit = await prisma.financialAuditEvent.findMany({
    where: {
      operatingGroupId: c.operatingGroupId,
      action: "ARCHIVE_BROWSER_COMPANY_CONFIRMED",
    },
  });
  assert.equal(audit.length, 1);
  assert.equal((await bridge.review(c)).rows[0].status, "OWNER_CONFIRMED");
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
  const expanded: FinancialAuthorization = {
    ...(await expandArchiveScope(c)),
    captureRunId: c.captureRunId,
  };
  await fixtureCaptureRun(expanded);
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
  await new (
    await import("./archive-capture-run")
  ).ArchiveCaptureRunService().transition(
    expanded.captureRunId!,
    "CLOSED",
    expanded,
  );
  c.captureRunId = undefined;
  await prisma.companyMembership.delete({
    where: { userId_companyId: { userId: c.userId, companyId: historic.id } },
  });
  await fixtureCaptureRun(c);
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
test("binding rejects conflicting provenance, inactive/revoked owners and foreign groups", async () => {
  const historic = await prisma.company.create({
    data: {
      name: "Ambiguous synthetic",
      memberships: { create: { userId: c.userId, role: "OWNER" } },
    },
  });
  const provider = randomUUID();
  const cat = await bridge.catalog(catalogEvidence(provider), c);
  const input = {
    ...confirm(),
    catalogId: cat.id,
    providerCompanyId: provider,
    companyId: historic.id,
    historical: true,
  };
  await prisma.truckLifecycleEvent.create({
    data: {
      companyId: historic.id,
      actorUserId: c.userId,
      truckReference: "synthetic",
      unitNumber: "synthetic",
      action: "IMPORT",
      metadata: {
        provider: "QUICKMANAGE",
        sourceCompanyId: randomUUID(),
        sourceTruckId: provider,
      },
    },
  });
  await assert.rejects(() => bridge.bind(input, c), /provenance/);
  assert.equal(
    await prisma.archiveScopeGrant.count({ where: { companyId: historic.id } }),
    0,
  );
  const foreign = await prisma.operatingGroup.create({
    data: {
      name: "Foreign binding",
      companies: { create: { companyId: historic.id } },
    },
  });
  assert.ok(foreign.id);
  await assert.rejects(() => bridge.bind(input, c));
  await prisma.user.update({
    where: { id: c.userId },
    data: { isActive: false },
  });
  try {
    await assert.rejects(() => bridge.bind(confirm(), c));
  } finally {
    await prisma.user.update({
      where: { id: c.userId },
      data: { isActive: true },
    });
  }
  await prisma.operatingGroupMembership.update({
    where: {
      operatingGroupId_userId: {
        operatingGroupId: c.operatingGroupId,
        userId: c.userId,
      },
    },
    data: { role: "ADMIN" },
  });
  try {
    await assert.rejects(() => bridge.bind(confirm(), c));
  } finally {
    await prisma.operatingGroupMembership.update({
      where: {
        operatingGroupId_userId: {
          operatingGroupId: c.operatingGroupId,
          userId: c.userId,
        },
      },
      data: { role: "OWNER" },
    });
  }
  const target = await prisma.company.create({
    data: {
      name: "Other owned Company",
      memberships: { create: { userId: c.userId, role: "OWNER" } },
    },
  });
  await assert.rejects(
    () =>
      bridge.bind({ ...confirm(), companyId: target.id, historical: true }, c),
    /already bound/,
  );
});
test("ten-item resume and smaller fabricated manifests retain honest snapshot semantics", async () => {
  const fs = Array.from({ length: 10 }, () =>
    statementFixture({ pid: "2023-03" }),
  );
  const e = inventoryEvidence(companyId, fs);
  const inv = await bridge.inventory(e, c);
  for (const f of fs.slice(0, 4))
    await bridge.capture(inv.id, bundleEvidence(companyId, f), c);
  assert.equal((await bridge.inventory(e, c)).id, inv.id);
  const reopened = await new ArchiveReadService().inventory(inv.id, c, 0);
  assert.equal(reopened.coverage.missing, BigInt("6"));
  assert.equal(reopened.items.filter((x) => !x.captured).length, 6);
  const smaller = await bridge.inventory(
    inventoryEvidence(companyId, fs.slice(0, 4)),
    c,
  );
  assert.equal(
    (await read.inventory(smaller.id, c, 0)).coverage.complete,
    true,
  );
  assert.equal(
    (smaller.metadata as { completenessBasis: string }).completenessBasis,
    "CAPTURED_INVENTORY_SNAPSHOT",
  );
  assert.equal((await read.inventory(inv.id, c, 0)).coverage.complete, false);
  const omitCaptured = await bridge.inventory(
    inventoryEvidence(companyId, fs.slice(0, 3)),
    c,
  );
  assert.equal(
    (await read.inventory(omitCaptured.id, c, 0)).coverage.complete,
    false,
  );
});
test("concurrent different-content submissions preserve one canonical version and quarantine retry", async () => {
  const f = statementFixture({ pid: "2023-04" });
  const other = {
    ...f,
    bundle: {
      ...f.bundle,
      pdf: Buffer.from("%PDF-1.4\n% alternate synthetic\n%%EOF"),
    },
  };
  const inv = await bridge.inventory(inventoryEvidence(companyId, [f]), c);
  const results = await Promise.all([
    bridge.capture(inv.id, bundleEvidence(companyId, f), c),
    bridge.capture(inv.id, bundleEvidence(companyId, other), c),
  ]);
  // The run lock may serialize both requests through completion; either a
  // lease retry or a completed, quarantined conflict is safe.
  assert.ok(results.filter((x) => x.status === "CAPTURING").length <= 1);
  const s = await prisma.archiveStatement.findFirstOrThrow({
    where: { providerStatementId: f.id },
    include: { versions: true },
  });
  const before = s.versions[0];
  await bridge.capture(inv.id, bundleEvidence(companyId, f), c);
  await bridge.capture(inv.id, bundleEvidence(companyId, other), c);
  const after = await prisma.archiveStatement.findUniqueOrThrow({
    where: { id: s.id },
    include: { versions: true, conflicts: true },
  });
  assert.deepEqual(after.versions, [before]);
  assert.equal(after.conflicts.length, 1);
  assert.equal(after.status, "NEEDS_REVIEW");
  assert.equal(
    (before.header as { archiveProvenance: { acquisition: string } })
      .archiveProvenance.acquisition,
    "BROWSER_EVIDENCE_V1",
  );
  const audits = await prisma.financialAuditEvent.findMany({
    where: {
      operatingGroupId: c.operatingGroupId,
      action: {
        in: ["ARCHIVE_INVENTORY_CAPTURED", "ARCHIVE_CONTENT_CONFLICT"],
      },
    },
  });
  assert.ok(audits.length);
  assert.ok(
    audits.every(
      (a) =>
        (a.metadata as { acquisition: string }).acquisition ===
        "BROWSER_EVIDENCE_V1",
    ),
  );
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
  const { postedAccountingFixture } =
    await import("../../../tests/fixtures/accounting-posted");
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
  await fixtureCaptureRun(f.context);
  const statement = statementFixture({ terminated: true });
  const inv = await bridge.inventory(
    inventoryEvidence(provider, [statement]),
    f.context,
  );
  await bridge.capture(inv.id, bundleEvidence(provider, statement), f.context);
  await bridge.capture(inv.id, bundleEvidence(provider, statement), f.context);
  assert.deepEqual(await snapshot(), before);
});

test("dual raw observations accept only fixed-pay order variance and retain exact-identity completeness", async () => {
  // Earlier authorization/economics cases deliberately switch the configured
  // account/group. Restore this fixture's exact server scope for this case.
  const binding = await prisma.archiveCompany.findFirstOrThrow({
    where: { providerCompanyId: companyId, companyId: c.activeCompanyId },
  });
  process.env.QUICKMANAGE_ARCHIVE_ACCOUNT_KEY = binding.accountKey;
  process.env.QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID = c.operatingGroupId;
  const { fixedPaysFixture } =
    await import("../../../tests/fixtures/quickmanage-fixed-pays");
  const { hash } = await import("./archive-normalize");
  const f = fixedPaysFixture(),
    original = f.bundle.detail;
  const inv = await bridge.inventory(inventoryEvidence(companyId, [f]), c);
  f.payload.data.fixed_pays.reverse();
  const after = Buffer.from(JSON.stringify(f.payload));
  const e = {
    ...bundleEvidence(companyId, f),
    detailAfterBase64: after.toString("base64"),
    detailAfterSha256: hash(after),
  };
  const captured = await bridge.capture(inv.id, e, c);
  assert.ok("versionId" in captured);
  const version = await prisma.archiveVersion.findUniqueOrThrow({
    where: { id: captured.versionId! },
  });
  assert.equal(version.detailChecksum, hash(original));
  assert.equal((await read.inventory(inv.id, c, 0)).coverage.complete, true);
  const repeat = await bridge.capture(
    inv.id,
    bundleEvidence(companyId, { ...f, bundle: { ...f.bundle, detail: after } }),
    c,
  );
  assert.equal("idempotent" in repeat && repeat.idempotent, true);
  assert.equal((await read.inventory(inv.id, c, 0)).coverage.complete, true);
  f.payload.data.fixed_pays[0].worked_unit++;
  const changed = Buffer.from(JSON.stringify(f.payload));
  const conflict = await bridge.capture(
    inv.id,
    bundleEvidence(companyId, {
      ...f,
      bundle: { ...f.bundle, detail: changed },
    }),
    c,
  );
  assert.equal(conflict.status, "NEEDS_REVIEW");
  const coverage = (await read.inventory(inv.id, c, 0)).coverage;
  assert.equal(coverage.complete, false);
  assert.equal(Number(coverage.conflicts), 1);
  assert.equal(
    await prisma.archiveVersion.count({
      where: { statementId: version.statementId },
    }),
    1,
  );
});

test("dual raw observations accept equal-time trip order variance and retain exact-identity completeness", async () => {
  // Earlier authorization/economics cases deliberately switch the configured
  // account/group. Restore this fixture's exact server scope for this case.
  const binding = await prisma.archiveCompany.findFirstOrThrow({
    where: { providerCompanyId: companyId, companyId: c.activeCompanyId },
  });
  process.env.QUICKMANAGE_ARCHIVE_ACCOUNT_KEY = binding.accountKey;
  process.env.QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID = c.operatingGroupId;
  const { tripTiesFixture } =
    await import("../../../tests/fixtures/quickmanage-trip-ties");
  const { hash } = await import("./archive-normalize");
  const f = tripTiesFixture(),
    original = f.bundle.detail;
  const inv = await bridge.inventory(inventoryEvidence(companyId, [f]), c);
  [f.payload.data.trips[7], f.payload.data.trips[8]] = [
    f.payload.data.trips[8],
    f.payload.data.trips[7],
  ];
  const after = Buffer.from(JSON.stringify(f.payload));
  const e = {
    ...bundleEvidence(companyId, f),
    detailAfterBase64: after.toString("base64"),
    detailAfterSha256: hash(after),
  };
  const captured = await bridge.capture(inv.id, e, c);
  assert.ok("versionId" in captured);
  const version = await prisma.archiveVersion.findUniqueOrThrow({
    where: { id: captured.versionId! },
  });
  assert.equal(version.detailChecksum, hash(original));
  assert.equal((await read.inventory(inv.id, c, 0)).coverage.complete, true);
  const repeat = await bridge.capture(
    inv.id,
    bundleEvidence(companyId, { ...f, bundle: { ...f.bundle, detail: after } }),
    c,
  );
  assert.equal("idempotent" in repeat && repeat.idempotent, true);
  assert.equal((await read.inventory(inv.id, c, 0)).coverage.complete, true);
  f.payload.data.trips[7].rate++;
  const changed = Buffer.from(JSON.stringify(f.payload));
  const conflict = await bridge.capture(
    inv.id,
    bundleEvidence(companyId, {
      ...f,
      bundle: { ...f.bundle, detail: changed },
    }),
    c,
  );
  assert.equal(conflict.status, "NEEDS_REVIEW");
  const coverage = (await read.inventory(inv.id, c, 0)).coverage;
  assert.equal(coverage.complete, false);
  assert.equal(Number(coverage.conflicts), 1);
  assert.equal(
    await prisma.archiveVersion.count({
      where: { statementId: version.statementId },
    }),
    1,
  );
});
