import { fixtureCaptureRun } from "../../../tests/fixtures/archive-run";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { prisma } from "@/lib/prisma";
import { FilesystemPrivateFileStorage } from "@/lib/storage/private-file-storage";
import { FinancialControlService } from "./financial-control-service";
import { ArchiveService } from "./archive-service";
import { ArchiveReadService } from "./archive-read";
import type { CaptureContext as FinancialAuthorization } from "./archive-capture-run";
import {
  FixtureArchiveProvider,
  statementFixture,
} from "../../../tests/fixtures/quickmanage";

test("scale: 14 Companies, 310 inventories, 9127 real synthetic captures and 8276 terminated recipients remain paginated and isolated", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "qm-scale-"));
  try {
    const companies: { id: string }[] = [];
    for (let i = 0; i < 14; i++)
      companies.push(
        await prisma.company.create({
          data: { name: `Archive scale ${randomUUID()}` },
        }),
      );
    const owner = await prisma.user.create({
      data: {
        email: randomUUID() + "@example.test",
        displayName: "Archive scale",
        activeCompanyId: companies[0].id,
        memberships: {
          create: companies.map((c) => ({ companyId: c.id, role: "OWNER" })),
        },
      },
    });
    const group = await new FinancialControlService().createGroup(
      "Archive scale",
      {
        companyId: companies[0].id,
        role: "OWNER",
        user: {
          id: owner.id,
          email: owner.email,
          displayName: owner.displayName,
          activeCompanyId: companies[0].id,
          isActive: true,
        },
      },
    );
    await prisma.operatingGroupCompany.createMany({
      data: companies
        .slice(1)
        .map((c) => ({ operatingGroupId: group.id, companyId: c.id })),
    });
    const ctx: FinancialAuthorization = {
      userId: owner.id,
      activeCompanyId: companies[0].id,
      operatingGroupId: group.id,
      role: "OWNER",
      companyIds: companies.map((c) => c.id),
    };
    const service = new ArchiveService(
      prisma,
      new FilesystemPrivateFileStorage("financial-statements", root),
      new FilesystemPrivateFileStorage("quickmanage-details", root),
    );
    const providers = companies.map(() => new FixtureArchiveProvider());
    const account = "scale-" + randomUUID();
    const bindings = [];
    for (let i = 0; i < 14; i++) {
      providers[i].accountKey = account;
      bindings.push(
        await service.bind(
          companies[i].id,
          providers[i].companyId,
          providers[i],
          ctx,
        ),
      );
    }
    await fixtureCaptureRun(ctx);
    let captured = 0,
      extraVersions = 0;
    const started = Date.now();
    for (let g = 0; g < 310; g++) {
      const companyIndex = g % 14,
        p = providers[companyIndex],
        b = bindings[companyIndex];
      const period = g % 141,
        pid = `${2024 + Math.floor(period / 52)}-${String((period % 52) + 1).padStart(2, "0")}`;
      p.fixtures = [];
      const changed = new Set<string>();
      for (let j = 0; j < (g < 137 ? 30 : 29); j++) {
        const f = statementFixture({
          pid,
          terminated: captured < 8276,
          contractor: captured % 2 === 0,
        });
        if (captured % 100 === 0) {
          await service.capture(b.id, f.bundle, ctx);
          f.payload.data.version = 2;
          f.bundle.detail = Buffer.from(JSON.stringify(f.payload));
          f.bundle.pdf = Buffer.from("%PDF-1.4\nsynthetic v2 " + f.id);
          changed.add(f.id);
          extraVersions++;
        }
        p.fixtures.push(f);
        captured++;
      }
      const inventory = await service.discover(b.id, pid, p, ctx);
      const items = await prisma.archiveInventoryItem.findMany({
        where: { inventoryId: inventory.id },
      });
      for (let i = 0; i < items.length; i += 5)
        await service.run(
          inventory.id,
          items.slice(i, i + 5).map((x) => x.id),
          p,
          ctx,
        );
      for (const id of changed) {
        const statement = await prisma.archiveStatement.findUniqueOrThrow({
          where: {
            archiveCompanyId_providerStatementId: {
              archiveCompanyId: b.id,
              providerStatementId: id,
            },
          },
        });
        await service.accept(statement.id, ctx);
      }
    }
    let queries = 0;
    const counted = prisma.$extends({
      query: {
        $allOperations({ args, query }) {
          queries++;
          return query(args);
        },
      },
    });
    const read = new ArchiveReadService(counted as typeof prisma);
    const queryStart = Date.now();
    const overview = await read.overview(ctx);
    assert.equal(overview.statementCount, 9127);
    assert.equal(overview.groups, BigInt(310));
    assert.equal(overview.complete, BigInt(310));
    assert.equal(overview.missing, BigInt(0));
    assert.equal(overview.conflicts, BigInt(0));
    assert.equal(overview.unexpected, BigInt(0));
    const groups = await read.inventories(ctx, 0);
    assert.equal(groups.items.length, 25);
    assert.equal(groups.total, BigInt(310));
    const statements = await read.statements(ctx, new URLSearchParams());
    assert.equal(statements.items.length, 25);
    assert.equal(statements.total, 9127);
    const terminated = await read.statements(
      ctx,
      new URLSearchParams("lifecycle=terminated"),
    );
    assert.equal(terminated.total, 8276);
    const companyOnly = { ...ctx, companyIds: [companies[0].id] };
    const scoped = await read.statements(companyOnly, new URLSearchParams());
    assert.ok(scoped.total > 0 && scoped.total < 9127);
    assert.ok(
      scoped.items.every((s) => s.company.companyId === companies[0].id),
    );
    assert.ok(queries <= 20, `Unexpected query fan-out: ${queries}`);
    const queryMs = Date.now() - queryStart;
    assert.equal(
      await prisma.archiveVersion.count({
        where: { statement: { company: { operatingGroupId: group.id } } },
      }),
      9127 + extraVersions,
    );
    const economicCounts = await Promise.all([
      prisma.financialTransaction.count({
        where: { operatingGroupId: group.id },
      }),
      prisma.financialAllocation.count({
        where: { transaction: { operatingGroupId: group.id } },
      }),
      prisma.financialExpectation.count({
        where: { operatingGroupId: group.id },
      }),
      prisma.financialExpectationBankMatch.count({
        where: { operatingGroupId: group.id },
      }),
      prisma.pilotFuelingEvent.count({
        where: { invoice: { operatingGroupId: group.id } },
      }),
    ]);
    assert.deepEqual(economicCounts, [0, 0, 0, 0, 0]);
    t.diagnostic(
      JSON.stringify({
        captured,
        extraVersions,
        groups: 310,
        terminated: 8276,
        prismaOperations: queries,
        queryMs,
        totalMs: Date.now() - started,
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
    await prisma.$disconnect();
  }
});
