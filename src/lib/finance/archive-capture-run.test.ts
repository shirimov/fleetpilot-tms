import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { FilesystemPrivateFileStorage } from "@/lib/storage/private-file-storage";
import {
  ArchiveCaptureRunService,
  type CaptureContext,
} from "./archive-capture-run";
import { ArchiveService } from "./archive-service";
import { ArchiveBridgeService } from "./archive-bridge-service";
import { FinancialControlService } from "./financial-control-service";
import {
  FixtureArchiveProvider,
  statementFixture,
} from "../../../tests/fixtures/quickmanage";
import {
  inventoryEvidence,
  bundleEvidence,
} from "../../../tests/fixtures/quickmanage-browser";
const ids = [
  "45f349d6-5bd2-469f-883c-c4037184d806",
  "3fa9f398-e5dd-49b6-8528-18217b9e9411",
  "9978b238-c50a-4fcc-b252-b12f32dc3625",
  "d8a294b3-fc57-4701-a895-bcf255a47cfd",
] as const;
const names = [
  "MARYBEG LLC",
  "Caribe Transport Inc",
  "Angels On The Road Inc.",
  "TURNER TRANSPORT LLC",
];
let c: CaptureContext,
  service: ArchiveService,
  bridge: ArchiveBridgeService,
  root: string;
const runs = new ArchiveCaptureRunService(),
  providers: FixtureArchiveProvider[] = [],
  bindings: string[] = [];
async function activate(allowed: readonly string[] = [ids[2]]) {
  if (c.captureRunId) {
    const old = await prisma.archiveCaptureRun.findUniqueOrThrow({
      where: { id: c.captureRunId },
    });
    if (old.status === "ACTIVE") await runs.transition(old.id, "CLOSED", c);
  }
  const run = await runs.create(allowed, "Explicit synthetic test", c);
  await runs.transition(run.id, "ACTIVE", c);
  c.captureRunId = run.id;
  return run.id;
}
async function capture(...args: Parameters<ArchiveBridgeService["capture"]>) {
  const result = await bridge.capture(...args);
  assert.ok("idempotent" in result);
  return result;
}
function fixture(index = 2) {
  const f = statementFixture();
  f.payload.data.header.carrier.name = names[index];
  f.bundle.detail = Buffer.from(JSON.stringify(f.payload));
  return f;
}
const economics = () =>
  Promise.all([
    prisma.financialTransaction.count(),
    prisma.financialAllocation.count(),
    prisma.financialExpectation.count(),
    prisma.financialExpectationBankMatch.count(),
    prisma.pilotFuelingEvent.count(),
  ]);
before(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "capture-runs-"));
  const companies = await Promise.all(
    names.map((name) => prisma.company.create({ data: { name } })),
  );
  const user = await prisma.user.create({
    data: {
      email: randomUUID() + "@example.test",
      displayName: "Run owner",
      activeCompanyId: companies[0].id,
      memberships: {
        create: companies.map((x) => ({ companyId: x.id, role: "OWNER" })),
      },
    },
  });
  const group = await new FinancialControlService().createGroup("Run scope", {
    companyId: companies[0].id,
    role: "OWNER",
    user: { ...user, activeCompanyId: companies[0].id },
  });
  await prisma.operatingGroupCompany.createMany({
    data: companies
      .slice(1)
      .map((x) => ({ companyId: x.id, operatingGroupId: group.id })),
  });
  c = {
    userId: user.id,
    activeCompanyId: companies[0].id,
    companyIds: companies.map((x) => x.id),
    operatingGroupId: group.id,
    role: "OWNER",
  };
  const account = "capture-run-" + randomUUID();
  process.env.QUICKMANAGE_ARCHIVE_ACCOUNT_KEY = account;
  process.env.QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID = group.id;
  process.env.QUICKMANAGE_CAPTURE_ENABLED = "true";
  process.env.QUICKMANAGE_BROWSER_BRIDGE_ENABLED = "true";
  process.env.QUICKMANAGE_ARCHIVE_ENABLED = "true";
  service = new ArchiveService(
    prisma,
    new FilesystemPrivateFileStorage("financial-statements", root),
    new FilesystemPrivateFileStorage("quickmanage-details", root),
  );
  bridge = new ArchiveBridgeService(prisma, service);
  for (let i = 0; i < 4; i++) {
    const p = new FixtureArchiveProvider();
    p.accountKey = account;
    p.companyId = ids[i];
    p.companies = async () => [
      { id: ids[i], carrier_name: names[i], status: "active" },
    ];
    providers.push(p);
    bindings.push((await service.bind(companies[i].id, ids[i], p, c)).id);
  }
});
after(async () => {
  await rm(root, { recursive: true, force: true });
  await prisma.$disconnect();
});
test("OWNER-only creation, exact bound allowlist, no unbound or cross-group scope", async () => {
  for (const context of [
    { ...c, role: "ADMIN" as const },
    { ...c, userId: randomUUID() },
    { ...c, operatingGroupId: randomUUID() },
  ])
    await assert.rejects(() => runs.create([ids[2]], "deny", context));
  for (const scope of [
    [],
    [ids[2], ids[2]],
    [randomUUID()],
    ["Angels On The Road Inc."],
  ])
    await assert.rejects(() => runs.create(scope, "deny", c));
  await assert.rejects(() =>
    runs.create([ids[2]], "deny", { ...c, companyIds: [c.activeCompanyId] }),
  );
  const draft = await runs.create([ids[2]], "draft", c);
  await assert.rejects(() =>
    bridge.inventory(inventoryEvidence(ids[2], [fixture()]), {
      ...c,
      captureRunId: draft.id,
    }),
  );
  await runs.transition(draft.id, "CLOSED", c);
});
test("Angels-only run allows inventory, capture, idempotent retry and denies every other bound company on ALL paths", async () => {
  const before = await economics();
  await activate();
  const f = fixture();
  const inv = await bridge.inventory(inventoryEvidence(ids[2], [f]), c);
  const result = await capture(inv.id, bundleEvidence(ids[2], f), c);
  assert.ok(result.versionId);
  assert.equal(
    (await capture(inv.id, bundleEvidence(ids[2], f), c)).idempotent,
    true,
  );
  assert.equal(
    (
      await prisma.archiveVersion.findUniqueOrThrow({
        where: { id: result.versionId },
      })
    ).captureRunId,
    c.captureRunId,
  );
  for (const i of [0, 1, 3]) {
    const other = fixture(i);
    await assert.rejects(() =>
      bridge.inventory(inventoryEvidence(ids[i], [other]), c),
    );
    await assert.rejects(() =>
      bridge.capture(inv.id, bundleEvidence(ids[i], other), c),
    );
    await assert.rejects(() => service.capture(bindings[i], other.bundle, c));
    providers[i].fixtures = [other];
    await assert.rejects(() =>
      service.discover(bindings[i], "2026-37", providers[i], c),
    );
  }
  await assert.rejects(() =>
    bridge.inventory(inventoryEvidence(randomUUID(), [f]), c),
  );
  await assert.rejects(() =>
    bridge.inventory(inventoryEvidence(ids[2], [f]), {
      ...c,
      captureRunId: undefined,
    }),
  );
  await assert.rejects(() =>
    bridge.inventory(inventoryEvidence(ids[2], [f]), {
      ...c,
      userId: randomUUID(),
    }),
  );
  await assert.rejects(() =>
    bridge.inventory(inventoryEvidence(ids[2], [f]), {
      ...c,
      operatingGroupId: randomUUID(),
    }),
  );
  await assert.rejects(() =>
    service.capture(bindings[2], fixture(1).bundle, c),
  );
  const audits = await prisma.financialAuditEvent.findMany({
    where: { operatingGroupId: c.operatingGroupId },
  });
  assert.ok(audits.some((x) => x.action === "ARCHIVE_CAPTURE_RUN_CREATED"));
  assert.ok(audits.some((x) => x.action === "ARCHIVE_CAPTURE_RUN_ACTIVE"));
  assert.ok(
    audits.some(
      (x) =>
        x.action === "ARCHIVE_VERSION_CAPTURED" &&
        JSON.stringify(x.metadata).includes(c.captureRunId!),
    ),
  );
  assert.deepEqual(await economics(), before);
});
test("immutable scope, client tampering, multi-company run, run-ID/job tampering and closed-run denial", async () => {
  const oldId = c.captureRunId!;
  const old = await bridge.inventory(inventoryEvidence(ids[2], [fixture()]), c);
  await assert.rejects(() =>
    prisma.archiveCaptureRun.update({
      where: { id: oldId },
      data: { allowedProviderCompanyIds: [...ids] },
    }),
  );
  const run = await activate([ids[2], ids[3]]);
  assert.notEqual(run, oldId);
  for (const i of [2, 3]) {
    const f = fixture(i);
    const inv = await bridge.inventory(inventoryEvidence(ids[i], [f]), c);
    assert.ok((await capture(inv.id, bundleEvidence(ids[i], f), c)).versionId);
  }
  for (const i of [0, 1])
    await assert.rejects(() =>
      bridge.inventory(inventoryEvidence(ids[i], [fixture(i)]), c),
    );
  const item = await prisma.archiveInventoryItem.findFirstOrThrow({
    where: { inventoryId: old.id },
  });
  await assert.rejects(() => service.run(old.id, [item.id], providers[2], c));
  await assert.rejects(() =>
    bridge.inventory(
      {
        ...inventoryEvidence(ids[2], [fixture()]),
        allowedProviderCompanyIds: ids,
      },
      c,
    ),
  );
  await runs.transition(run, "COMPLETED", c);
  for (const i of [2, 3]) {
    await assert.rejects(() =>
      bridge.inventory(inventoryEvidence(ids[i], [fixture(i)]), c),
    );
    await assert.rejects(() =>
      service.capture(bindings[i], fixture(i).bundle, c),
    );
  }
  await assert.rejects(() => runs.transition(run, "ACTIVE", c));
});
test("global and per-channel gates fail closed in services, not only routes", async () => {
  await activate();
  for (const key of [
    "QUICKMANAGE_CAPTURE_ENABLED",
    "QUICKMANAGE_BROWSER_BRIDGE_ENABLED",
  ]) {
    process.env[key] = "false";
    await assert.rejects(() =>
      bridge.inventory(inventoryEvidence(ids[2], [fixture()]), c),
    );
    process.env[key] = "true";
  }
  process.env.QUICKMANAGE_ARCHIVE_ENABLED = "false";
  await assert.rejects(() =>
    service.discover(bindings[2], "2026-37", providers[2], c),
  );
  process.env.QUICKMANAGE_ARCHIVE_ENABLED = "true";
});
test("closing during provider download prevents commit and retry cannot escape closed scope", async () => {
  await activate();
  const f = fixture();
  providers[2].fixtures = [f];
  const inv = await service.discover(bindings[2], "2026-37", providers[2], c);
  const item = await prisma.archiveInventoryItem.findFirstOrThrow({
    where: { inventoryId: inv.id },
  });
  let ready!: () => void, release!: () => void;
  const waiting = new Promise<void>((r) => {
      ready = r;
    }),
    pause = new Promise<void>((r) => {
      release = r;
    });
  const original = providers[2].bundle.bind(providers[2]);
  providers[2].bundle = async () => {
    ready();
    await pause;
    return f.bundle;
  };
  const before = await prisma.archiveVersion.count({
    where: { statement: { company: { operatingGroupId: c.operatingGroupId } } },
  });
  const pending = service.run(inv.id, [item.id], providers[2], c);
  await waiting;
  await runs.transition(c.captureRunId!, "CLOSED", c);
  release();
  const result = await pending;
  assert.equal(result[0].status, "FAILED");
  assert.equal(
    await prisma.archiveVersion.count({
      where: {
        statement: { company: { operatingGroupId: c.operatingGroupId } },
      },
    }),
    before,
  );
  await assert.rejects(() => service.run(inv.id, [item.id], providers[2], c));
  providers[2].bundle = original;
});
test("new run preserves old inventory and evidence, with resumable same-run inventory evolution", async () => {
  await activate();
  const f = fixture();
  const old = await bridge.inventory(inventoryEvidence(ids[2], [f]), c);
  const result = await capture(old.id, bundleEvidence(ids[2], f), c);
  const version = await prisma.archiveVersion.findUniqueOrThrow({
    where: { id: result.versionId },
  });
  await activate();
  const newer = await bridge.inventory(inventoryEvidence(ids[2], [f]), c);
  assert.notEqual(newer.id, old.id);
  assert.equal(
    (await bridge.inventory(inventoryEvidence(ids[2], [f]), c)).id,
    newer.id,
  );
  assert.equal(
    (await capture(newer.id, bundleEvidence(ids[2], f), c)).idempotent,
    true,
  );
  assert.deepEqual(
    await prisma.archiveVersion.findUniqueOrThrow({
      where: { id: version.id },
    }),
    version,
  );
  assert.deepEqual(
    await prisma.archiveInventory.findUniqueOrThrow({ where: { id: old.id } }),
    { ...old, sealed: true },
  );
  const evolved = await bridge.inventory(
    inventoryEvidence(ids[2], [f, fixture()]),
    c,
  );
  assert.notEqual(evolved.id, newer.id);
});

test("closure waits for an evidence transaction already holding the commit lock", async () => {
  await activate();
  let ready!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => {
      ready = r;
    }),
    pause = new Promise<void>((r) => {
      release = r;
    });
  class PausedStorage extends FilesystemPrivateFileStorage {
    async put(bytes: Uint8Array) {
      ready();
      await pause;
      return super.put(bytes);
    }
  }
  const isolated = new ArchiveService(
    prisma,
    new PausedStorage("financial-statements", root),
    new FilesystemPrivateFileStorage("quickmanage-details", root),
  );
  const pending = isolated.capture(bindings[2], fixture().bundle, c);
  await entered;
  let closed = false;
  const closure = runs.transition(c.captureRunId!, "CLOSED", c).then(() => {
    closed = true;
  });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(closed, false);
  release();
  assert.ok((await pending).versionId);
  await closure;
  await assert.rejects(() =>
    isolated.capture(bindings[2], fixture().bundle, c),
  );
  const denied = await prisma.financialAuditEvent.findFirst({
    where: {
      operatingGroupId: c.operatingGroupId,
      action: "ARCHIVE_CAPTURE_RUN_DENIED",
    },
  });
  assert.ok(denied);
});
