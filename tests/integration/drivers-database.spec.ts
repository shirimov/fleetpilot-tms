import {
  expect,
  test,
  request as playwrightRequest,
  type APIRequestContext,
} from "playwright/test";
import { encode } from "next-auth/jwt";
import { prisma } from "../../src/lib/prisma";

// These tests write fixtures through real APIs. Refuse every other database.
const database = new URL(process.env.DATABASE_URL || "postgresql://invalid/");
if (
  database.hostname !== "127.0.0.1" ||
  database.port !== "15439" ||
  database.pathname !== "/fleetpilot_drivers_verify"
) {
  throw new Error(
    "Drivers database verification requires the disposable PR99 database on loopback port 15439.",
  );
}
const secret = process.env.AUTH_SECRET;
if (secret !== "fleetpilot-drivers-db-test-only")
  throw new Error("Use the dedicated Drivers verification auth secret.");
const tag = `drivers-db-${Date.now()}`;
let companyA = "",
  companyB = "",
  truckA = "",
  truckB = "",
  driverA = "",
  driverB = "",
  mixedDriver = "";
let loadA = "",
  loadB = "",
  settlementA = "";
const userIds: string[] = [],
  driverIds: string[] = [],
  clients: APIRequestContext[] = [];
let admin: APIRequestContext,
  owner: APIRequestContext,
  staff: APIRequestContext,
  foreign: APIRequestContext;
let ordinary: APIRequestContext,
  inactive: APIRequestContext,
  legacy: APIRequestContext;
async function client(userId: string) {
  const token = await encode({
    secret: secret!,
    salt: "authjs.session-token",
    token: { userId },
    maxAge: 3600,
  });
  const context = await playwrightRequest.newContext({
    baseURL: "http://127.0.0.1:3124",
    extraHTTPHeaders: { Cookie: `authjs.session-token=${token}` },
  });
  clients.push(context);
  return context;
}
async function user(
  name: string,
  companyId: string,
  role: "OWNER" | "ADMIN" | "MEMBER",
  employeeRole?:
    | "DISPATCHER"
    | "MANAGER"
    | "SAFETY"
    | "LEAD_DISPATCH"
    | "UPDATER"
    | "ADMIN"
    | "OTHER",
  employeeActive = true,
  employeeCompany = companyId,
) {
  const created = await prisma.user.create({
    data: {
      email: `${tag}-${name}@example.test`,
      displayName: name,
      activeCompanyId: companyId,
      memberships: { create: { companyId, role } },
    },
  });
  userIds.push(created.id);
  if (employeeRole)
    await prisma.employee.create({
      data: {
        firstName: name,
        lastName: tag,
        userId: created.id,
        companyId: employeeCompany,
        role: employeeRole,
        isActive: employeeActive,
        employmentStatus: employeeActive ? "ACTIVE" : "INACTIVE",
      },
    });
  return { id: created.id, context: await client(created.id) };
}
const input = {
  firstName: "Persisted",
  lastName: "Verification",
  phone: "555-0199",
  email: "driver@example.test",
  licenseNum: "TEST-CDL",
  payType: "PERCENTAGE",
  payRate: "25",
  truckId: "",
};
test.beforeAll(async () => {
  companyA = (await prisma.company.create({ data: { name: `${tag}-A` } })).id;
  companyB = (await prisma.company.create({ data: { name: `${tag}-B` } })).id;
  truckA = (
    await prisma.truck.create({
      data: {
        companyId: companyA,
        unitNumber: `${tag}-A`,
        unitNumberNormalized: `${tag}-A`.toUpperCase(),
      },
    })
  ).id;
  truckB = (
    await prisma.truck.create({
      data: {
        companyId: companyB,
        unitNumber: `${tag}-B`,
        unitNumberNormalized: `${tag}-B`.toUpperCase(),
      },
    })
  ).id;
  const dualAdmin = await user("admin", companyA, "ADMIN");
  admin = dualAdmin.context;
  await prisma.companyMembership.create({
    data: { companyId: companyB, userId: dualAdmin.id, role: "ADMIN" },
  });
  owner = (await user("owner", companyA, "OWNER")).context;
  staff = (await user("dispatcher", companyA, "MEMBER", "DISPATCHER")).context;
  ordinary = (await user("ordinary", companyA, "MEMBER")).context;
  inactive = (
    await user("inactive-employee", companyA, "MEMBER", "DISPATCHER", false)
  ).context;
  legacy = (
    await user(
      "foreign-employee",
      companyA,
      "MEMBER",
      "MANAGER",
      true,
      companyB,
    )
  ).context;
  foreign = (await user("foreign", companyB, "ADMIN")).context;
  driverA = (
    await prisma.driver.create({
      data: {
        companyId: companyA,
        firstName: "Historical",
        lastName: tag,
        payRate: 30,
        truckId: truckA,
      },
    })
  ).id;
  driverB = (
    await prisma.driver.create({
      data: {
        companyId: companyB,
        firstName: "Foreign",
        lastName: tag,
        payRate: 70,
        truckId: truckB,
      },
    })
  ).id;
  mixedDriver = (
    await prisma.driver.create({
      data: {
        companyId: companyA,
        firstName: "Legacy association",
        lastName: tag,
        payRate: 20,
        truckId: truckB,
      },
    })
  ).id;
  driverIds.push(driverA, driverB, mixedDriver);
  loadA = (
    await prisma.load.create({
      data: {
        companyId: companyA,
        loadNumber: `${tag}-A`,
        origin: "A origin",
        destination: "A destination",
        rate: 2000,
        driverId: driverA,
        truckId: truckA,
      },
    })
  ).id;
  loadB = (
    await prisma.load.create({
      data: {
        companyId: companyB,
        loadNumber: `${tag}-B`,
        origin: "FOREIGN_SECRET",
        destination: "B destination",
        rate: 9000,
        driverId: driverA,
        truckId: truckB,
      },
    })
  ).id;
  settlementA = (
    await prisma.settlement.create({
      data: {
        truckId: truckA,
        driverId: driverA,
        loadId: loadA,
        weekEnding: new Date("2026-10-24"),
        grossRevenue: 2000,
        driverPay: 600,
        netPay: 500,
        fuelDeduction: 100,
      },
    })
  ).id;
  await prisma.settlement.create({
    data: {
      truckId: truckB,
      driverId: driverA,
      loadId: loadB,
      weekEnding: new Date("2026-10-24"),
      grossRevenue: 9000,
      driverPay: 7000,
      netPay: 7000,
    },
  });
  // A third legacy association has an own-company truck but a foreign load.
  const foreignLoad = await prisma.load.create({
    data: {
      companyId: companyB,
      loadNumber: `${tag}-foreign-load`,
      origin: "FOREIGN_SECRET",
      destination: "Foreign",
      rate: 8000,
      driverId: driverA,
    },
  });
  await prisma.settlement.create({
    data: {
      truckId: truckA,
      driverId: driverA,
      loadId: foreignLoad.id,
      weekEnding: new Date("2026-10-24"),
      grossRevenue: 8000,
      driverPay: 6500,
      netPay: 6500,
    },
  });
  await prisma.driverOrientation.create({
    data: {
      driverId: driverA,
      completedBy: "Test reviewer",
      checklist: {},
      signature: "PRIVATE_SIGNATURE",
      notes: "Historical orientation preserved",
    },
  });
});

test("create, independent DB retrieval, edit and truck assignment persist through actual authenticated APIs", async () => {
  const response = await admin.post("/api/drivers", {
    data: { ...input, truckId: truckA, companyId: companyB },
  });
  expect(response.status()).toBe(200);
  const created = await response.json();
  driverIds.push(created.id);
  expect(
    await prisma.driver.findUniqueOrThrow({ where: { id: created.id } }),
  ).toMatchObject({
    companyId: companyA,
    firstName: "Persisted",
    payRate: 25,
    truckId: truckA,
  });
  const edited = await admin.patch(`/api/drivers/${created.id}`, {
    data: {
      ...input,
      firstName: "Edited",
      payType: "PER_MILE",
      payRate: "0.65",
      truckId: "",
    },
  });
  expect(edited.status()).toBe(200);
  expect(
    await prisma.driver.findUniqueOrThrow({ where: { id: created.id } }),
  ).toMatchObject({
    firstName: "Edited",
    payType: "PER_MILE",
    payRate: 0.65,
    truckId: null,
  });
  expect(
    (await (await admin.get(`/api/drivers/${created.id}`)).json()).firstName,
  ).toBe("Edited");
  const reassigned = await admin.patch(`/api/drivers/${created.id}`, {
    data: { ...input, truckId: truckA },
  });
  expect(reassigned.status()).toBe(200);
  expect(
    (await prisma.driver.findUniqueOrThrow({ where: { id: created.id } }))
      .truckId,
  ).toBe(truckA);
});
test("company scopes profiles, loads, settlements and legacy cross-company truck associations", async () => {
  const roster = await (await admin.get("/api/drivers")).json();
  expect(roster.some((driver: { id: string }) => driver.id === driverB)).toBe(
    false,
  );
  expect((await admin.get(`/api/drivers/${driverB}`)).status()).toBe(404);
  const response = await admin.get(`/api/drivers/${driverA}`);
  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const profile = await response.json();
  expect(profile.loads.map((load: { id: string }) => load.id)).toEqual([loadA]);
  expect(
    profile.settlements.map((settlement: { id: string }) => settlement.id),
  ).toEqual([settlementA]);
  expect(JSON.stringify(profile)).not.toContain("FOREIGN_SECRET");
  expect(JSON.stringify(profile)).not.toContain("PRIVATE_SIGNATURE");
  const mixed = await (await admin.get(`/api/drivers/${mixedDriver}`)).json();
  expect(mixed).toMatchObject({
    truckId: null,
    truck: null,
    assignmentRestricted: true,
  });
  expect(
    (await prisma.driver.findUniqueOrThrow({ where: { id: mixedDriver } }))
      .truckId,
  ).toBe(truckB);
  expect((await foreign.get(`/api/drivers/${driverA}`)).status()).toBe(404);
});
test("rejects cross-company writes and malformed pay without changing existing records", async () => {
  const before = await prisma.driver.findUniqueOrThrow({
    where: { id: driverA },
  });
  expect(
    (await admin.patch(`/api/drivers/${driverB}`, { data: input })).status(),
  ).toBe(404);
  expect(
    (
      await admin.patch(`/api/drivers/${driverA}`, {
        data: { ...input, truckId: truckB },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await admin.post("/api/drivers", { data: { ...input, truckId: truckB } })
    ).status(),
  ).toBe(400);
  expect(
    (
      await admin.patch(`/api/drivers/${driverA}`, {
        data: { ...input, payRate: "25oops" },
      })
    ).status(),
  ).toBe(400);
  expect(
    await prisma.driver.findUniqueOrThrow({ where: { id: driverA } }),
  ).toEqual(before);
});
test("active same-company dispatch staff can read operational profiles, without edits or compensation disclosure", async () => {
  const roster = await staff.get("/api/drivers");
  expect(roster.status()).toBe(200);
  expect(roster.headers()["x-drivers-can-edit"]).toBe("false");
  expect((await roster.json())[0]).toMatchObject({
    payRate: null,
    payType: null,
    canEdit: false,
  });
  const profile = await (await staff.get(`/api/drivers/${driverA}`)).json();
  expect(profile).toMatchObject({
    payRate: null,
    payType: null,
    settlements: [],
    canViewCompensation: false,
  });
  expect(profile.loads.map((load: { id: string }) => load.id)).toEqual([loadA]);
  expect((await staff.get(`/api/drivers/${driverB}`)).status()).toBe(404);
  expect((await staff.post("/api/drivers", { data: input })).status()).toBe(
    403,
  );
  expect(
    (await staff.patch(`/api/drivers/${driverA}`, { data: input })).status(),
  ).toBe(403);
  expect((await staff.delete(`/api/drivers/${driverA}`)).status()).toBe(403);
  expect((await staff.get("/api/settlements")).status()).toBe(403);
  expect((await staff.get("/api/trucks")).status()).toBe(403);
});
test("unlinked, inactive and foreign-company employee roles grant no driver access", async () => {
  for (const context of [ordinary, inactive, legacy]) {
    expect((await context.get("/api/drivers")).status()).toBe(403);
    expect((await context.get(`/api/drivers/${driverA}`)).status()).toBe(403);
  }
});
test("DELETE preserves historical records and unlinked drivers, including their truck and financial history", async () => {
  const before = await prisma.driver.findUniqueOrThrow({
    where: { id: driverA },
  });
  for (const context of [admin, owner])
    expect((await context.delete(`/api/drivers/${driverA}`)).status()).toBe(
      409,
    );
  expect(
    await prisma.driver.findUniqueOrThrow({ where: { id: driverA } }),
  ).toEqual(before);
  expect(await prisma.load.count({ where: { driverId: driverA } })).toBe(3);
  expect(await prisma.settlement.count({ where: { driverId: driverA } })).toBe(
    3,
  );
  expect(
    await prisma.driverOrientation.count({ where: { driverId: driverA } }),
  ).toBe(1);
  const unlinked = await prisma.driver.create({
    data: {
      companyId: companyA,
      firstName: "Unlinked",
      lastName: tag,
      payRate: 0,
    },
  });
  driverIds.push(unlinked.id);
  expect((await admin.delete(`/api/drivers/${unlinked.id}`)).status()).toBe(
    409,
  );
  expect(await prisma.driver.count({ where: { id: unlinked.id } })).toBe(1);
  expect((await admin.delete(`/api/drivers/${driverB}`)).status()).toBe(404);
});
test("verified operational job roles grant reads only and revocation takes effect immediately", async () => {
  for (const role of [
    "LEAD_DISPATCH",
    "UPDATER",
    "MANAGER",
    "SAFETY",
    "ADMIN",
  ] as const) {
    const operational = await user(`reader-${role}`, companyA, "MEMBER", role);
    expect((await operational.context.get("/api/drivers")).status()).toBe(200);
    expect(
      (
        await operational.context.post("/api/drivers", { data: input })
      ).status(),
    ).toBe(403);
  }
  const changed = await user(
    "revoked-reader",
    companyA,
    "MEMBER",
    "DISPATCHER",
  );
  expect((await changed.context.get("/api/drivers")).status()).toBe(200);
  await prisma.employee.update({
    where: { userId: changed.id },
    data: { employmentStatus: "TERMINATED" },
  });
  expect((await changed.context.get("/api/drivers")).status()).toBe(403);
  const inactiveAccount = await user("disabled-account", companyA, "ADMIN");
  await prisma.user.update({
    where: { id: inactiveAccount.id },
    data: { isActive: false },
  });
  expect((await inactiveAccount.context.get("/api/drivers")).status()).toBe(
    403,
  );
  const unrecognized = await user("custom-role", companyA, "MEMBER", "OTHER");
  await prisma.employee.update({
    where: { userId: unrecognized.id },
    data: { roleCustom: "Fleet manager" },
  });
  expect((await unrecognized.context.get("/api/drivers")).status()).toBe(403);
});
test("authenticated staff browser retains the approved drawer with read-only controls and compensation restriction", async ({
  page,
}) => {
  const staffUser = await prisma.user.findUniqueOrThrow({
    where: { email: `${tag}-dispatcher@example.test` },
  });
  const token = await encode({
    secret: secret!,
    salt: "authjs.session-token",
    token: { userId: staffUser.id },
    maxAge: 3600,
  });
  await page.context().addCookies([
    {
      name: "authjs.session-token",
      value: token,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
  await page.goto("/drivers");
  await expect(
    page.getByRole("button", {
      name: `Open profile for Historical ${tag}`,
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add Driver", exact: false }),
  ).toBeDisabled();
  await expect(page.getByLabel("Filter by pay type")).toBeDisabled();
  await expect(
    page.getByRole("link", { name: "Drivers", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Accounting", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", {
      name: `Open profile for Historical ${tag}`,
      exact: true,
    })
    .click();
  await expect(
    page.getByRole("button", { name: "Edit driver", exact: true }),
  ).toBeDisabled();
  await page
    .getByRole("tab", { name: "Pay & Settlements", exact: true })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "Compensation access restricted",
      exact: true,
    }),
  ).toBeVisible();
});
test.afterAll(async () => {
  // Only fixtures with this run's IDs are removed. No truncate, migration reset or production access.
  await prisma.driverOrientation.deleteMany({
    where: { driverId: { in: driverIds } },
  });
  await prisma.settlement.deleteMany({
    where: { driverId: { in: driverIds } },
  });
  await prisma.load.deleteMany({
    where: { companyId: { in: [companyA, companyB].filter(Boolean) } },
  });
  await prisma.driverAudit.deleteMany({
    where: { driverId: { in: driverIds } },
  });
  await prisma.driver.deleteMany({ where: { id: { in: driverIds } } });
  await prisma.truck.deleteMany({
    where: { id: { in: [truckA, truckB].filter(Boolean) } },
  });
  await prisma.employee.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.companyMembership.deleteMany({
    where: { userId: { in: userIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.company.deleteMany({
    where: { id: { in: [companyA, companyB].filter(Boolean) } },
  });
  await prisma.$disconnect();
  await Promise.all(clients.map((context) => context.dispose()));
});
