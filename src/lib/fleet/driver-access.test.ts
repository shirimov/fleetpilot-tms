import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DriverAuthorizationService,
  isDriverReadPath,
} from "../drivers/driver-authorization";
import { navigationForRole } from "../../components/app-shell/navigation";
import type { CompanyAuthorization } from "../auth/authorization";
import type { PrismaClient } from "@prisma/client";

const context = (role: "ADMIN" | "OWNER" | "MEMBER"): CompanyAuthorization => ({
  companyId: "active-company",
  role,
  user: {
    id: "verified-user",
    email: "staff@example.test",
    displayName: "Staff",
    isActive: true,
    activeCompanyId: "active-company",
  },
});
test("Drivers job-role access is scoped to verified active company and employment, never edit or compensation", async () => {
  let query: unknown;
  const database = {
    employee: {
      findFirst: async (args: unknown) => {
        query = args;
        return { id: "staff" };
      },
    },
  } as unknown as PrismaClient;
  const service = new DriverAuthorizationService(database);
  assert.deepEqual(await service.accessFor(context("MEMBER")), {
    canRead: true,
    canEdit: false,
    canViewCompensation: false,
  });
  const where = (query as { where: Record<string, unknown> }).where;
  assert.equal(where.userId, "verified-user");
  assert.equal(where.companyId, "active-company");
  assert.equal(where.isActive, true);
  assert.equal(where.employmentStatus, "ACTIVE");
  assert.deepEqual(await service.accessFor(context("ADMIN")), {
    canRead: true,
    canEdit: true,
    canViewCompensation: true,
  });
});
test("unlinked employees fail closed and the exception cannot open unrelated paths", async () => {
  const service = new DriverAuthorizationService({
    employee: { findFirst: async () => null },
  } as unknown as PrismaClient);
  assert.equal((await service.accessFor(context("MEMBER"))).canRead, false);
  assert.equal(isDriverReadPath("/drivers"), true);
  assert.equal(isDriverReadPath("/api/drivers/driver-id"), true);
  for (const path of [
    "/api/trucks",
    "/api/settlements",
    "/api/drivers/id/private",
    "/drivers-secret",
    "/accounting",
  ])
    assert.equal(isDriverReadPath(path), false);
});
test("Drivers navigation exception leaves all other MEMBER module restrictions intact", () => {
  const ordinary = navigationForRole("MEMBER").flatMap((section) =>
    section.items.map((item) => item.href),
  );
  const operational = navigationForRole("MEMBER", true).flatMap((section) =>
    section.items.map((item) => item.href),
  );
  assert.deepEqual(
    operational.filter((href) => !ordinary.includes(href)),
    ["/drivers"],
  );
});
