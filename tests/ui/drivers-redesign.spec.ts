import { expect, test, type Page } from "playwright/test";
// Synthetic fixtures are only installed by Playwright network interception.
const drivers = Array.from({ length: 12 }, (_, index) => ({
  id: `test-driver-${String(index + 1).padStart(3, "0")}`,
  firstName: `Test Driver ${index + 1}`,
  lastName: "Preview",
  phone: "555-0100",
  email: `driver${index + 1}@example.test`,
  licenseNum: "TEST-CDL",
  payType: index % 2 ? "PER_MILE" : "PERCENTAGE",
  payRate: index % 2 ? 0.65 : 25,
  truckId: index % 3 ? null : `test-truck-${index}`,
  truck:
    index % 3
      ? null
      : { id: `test-truck-${index}`, unitNumber: `T-${101 + index}` },
  createdAt: "2026-01-15T00:00:00Z",
  updatedAt: "2026-10-24T00:00:00Z",
}));
async function setup(page: Page) {
  await page.route("**/api/auth/company", (route) =>
    route.fulfill({
      json: {
        user: {
          displayName: "Test Fleet Manager",
          email: "manager@example.test",
          image: null,
        },
        activeCompanyId: "test-company",
        companies: [
          {
            id: "test-company",
            name: "Preview Company · Test Data",
            role: "OWNER",
          },
        ],
      },
    }),
  );
  await page.route("**/api/drivers", (route) =>
    route.fulfill({ json: drivers }),
  );
  await page.route("**/api/drivers/*", (route) =>
    route.fulfill({
      json: {
        ...drivers.find((driver) => route.request().url().endsWith(driver.id)),
        company: { name: "Preview Company · Test Data" },
        loads: [
          {
            id: "test-load",
            loadNumber: "TEST-001",
            status: "IN_TRANSIT",
            origin: "Chicago, IL",
            destination: "Dallas, TX",
            pickupDate: "2026-10-24T08:00:00Z",
            deliveryDate: "2026-10-26T17:00:00Z",
            miles: 925,
            truck: { unitNumber: "T-101" },
          },
        ],
        settlements: [
          {
            id: "test-settlement",
            weekEnding: "2026-10-23T00:00:00Z",
            driverPay: 1000,
            fuelDeduction: 100,
            otherDeductions: 25,
            netPay: 875,
            isPaid: true,
            paidAt: "2026-10-24T00:00:00Z",
          },
        ],
        driverOrientations: [
          {
            id: "test-orientation",
            completedAt: "2026-01-15T00:00:00Z",
            completedBy: "Test Reviewer",
            notes: "Synthetic orientation note for UI verification.",
          },
        ],
      },
    }),
  );
  await page.route("**/api/drivers/*/documents", (route) =>
    route.fulfill({
      json: {
        documents: [],
        alerts: {
          expired: 0,
          within30: 0,
          within60: 0,
          within90: 0,
          unknownExpiry: 0,
          missingRequired: [
            "CDL_FRONT",
            "CDL_BACK",
            "MEDICAL_CERTIFICATE",
            "MVR",
            "APPLICATION",
            "EMPLOYMENT_AGREEMENT",
            "ROAD_TEST",
          ],
        },
      },
    }),
  );
  await page.route("**/api/drivers/*/qualification?**", (route) =>
    route.fulfill({ json: { reviews: [], totalPages: 1, page: 1, total: 0 } }),
  );
  await page.route("**/api/drivers/*/activity?**", (route) =>
    route.fulfill({ json: { events: [], totalPages: 1, page: 1, total: 0 } }),
  );
  await page.route("**/api/drivers/reminders?**", (route) =>
    route.fulfill({
      json: { notifications: [], total: 0, page: 1, totalPages: 1 },
    }),
  );
  await page.route("**/api/trucks?**", (route) =>
    route.fulfill({
      json: {
        items: [{ id: "test-truck-0", unitNumber: "T-101" }],
        pagination: { totalPages: 1 },
      },
    }),
  );
}
test("dashboard search, filters, pagination and six profile sections", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 1536, height: 1024 });
  await page.goto("/drivers");
  await expect(page.getByText("Showing 1–8 of 12 drivers")).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/drivers-dashboard-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("Showing 9–12 of 12 drivers")).toBeVisible();
  await page.getByLabel("Search drivers").fill("driver1@example.test");
  await expect(page.getByText("Showing 1–1 of 1 drivers")).toBeVisible();
  await page.getByLabel("Search drivers").fill("");
  await page
    .getByRole("button", {
      name: "Open profile for Test Driver 1 Preview",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Load #TEST-001")).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/drivers-profile-desktop.png",
    fullPage: true,
    animations: "disabled",
  });
  for (const label of [
    "Documents",
    "Assignments & Trips",
    "Pay & Settlements",
    "Safety",
    "Notes & Files",
  ]) {
    await page.getByRole("tab", { name: label, exact: true }).click();
    await expect(
      page.getByRole("tab", { name: label, exact: true }),
    ).toHaveAttribute("aria-selected", "true");
    if (label === "Documents")
      await expect(
        page.getByText("No documents on file", { exact: true }),
      ).toBeVisible();
    if (label === "Pay & Settlements") {
      await expect(page.getByText("$875.00")).toBeVisible();
      await expect(page.getByText("$125.00")).toBeVisible();
    }
    if (label === "Notes & Files")
      await expect(
        page.getByText("Synthetic orientation note for UI verification."),
      ).toBeVisible();
    await page.screenshot({
      path: `docs/screenshots/drivers-${label.toLowerCase().replaceAll(/[^a-z]+/g, "-")}.png`,
      fullPage: false,
      animations: "disabled",
    });
  }
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: "Open profile for Test Driver 1 Preview",
    }),
  ).toBeFocused();
  await page.getByRole("button", { name: "Reset filters" }).click();
  await page
    .getByRole("button", { name: "Unassigned", exact: false })
    .first()
    .click();
  await expect(page.getByText("Showing 1–8 of 8 drivers")).toBeVisible();
});
test("mobile drawer and add/edit errors preserve entered values", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/drivers");
  await expect(
    page.getByRole("button", {
      name: "Open profile for Test Driver 1 Preview",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/screenshots/drivers-dashboard-mobile.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", {
      name: "Open profile for Test Driver 1 Preview",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Contact information", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/drivers-profile-mobile.png",
    fullPage: false,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "Edit driver", exact: true }).click();
  await expect(page.getByLabel("First name")).toHaveValue("Test Driver 1");
  await expect(page.getByLabel("Assign to truck")).toHaveValue("test-truck-0");
  await page.route("**/api/drivers/test-driver-001", (route) =>
    route.fulfill({
      status: 403,
      json: { error: "Permission denied for test." },
    }),
  );
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Permission denied for test.",
  );
  await expect(page.getByLabel("First name")).toHaveValue("Test Driver 1");
  page.on("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Add Driver", exact: false }).click();
  await expect(page.getByLabel("First name")).toHaveValue("");
});
test("failed roster does not display false zero counts and can retry into an empty state", async ({
  page,
}) => {
  await setup(page);
  let fail = true;
  await page.route("**/api/drivers", (route) =>
    route.fulfill({
      status: fail ? 500 : 200,
      json: fail ? { error: "Unavailable" } : [],
    }),
  );
  await page.goto("/drivers");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "Drivers unavailable",
  );
  await expect(
    page.getByRole("button", { name: "Add Driver", exact: false }),
  ).toBeDisabled();
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByText("No drivers yet", { exact: true })).toBeVisible();
});

test("create and edit retain existing CRUD contracts", async ({ page }) => {
  await setup(page);
  let saved: Record<string, unknown> | null = null;
  let method = "";
  await page.route("**/api/drivers", async (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: drivers });
    method = route.request().method();
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { ...drivers[0], ...saved } });
  });
  await page.goto("/drivers");
  await page.getByRole("button", { name: "Add Driver", exact: false }).click();
  await page.getByLabel("First name").fill("New Test");
  await page.getByLabel("Last name").fill("Driver");
  await page.getByLabel("Pay rate").fill("25");
  await page.getByLabel("Assign to truck").selectOption("test-truck-0");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add driver", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(method).toBe("POST");
  expect(saved).toMatchObject({
    firstName: "New Test",
    truckId: "test-truck-0",
    payRate: "25",
  });
  await page
    .getByRole("button", {
      name: "Open profile for Test Driver 1 Preview",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "Edit driver", exact: true }).click();
  await page.getByLabel("Phone", { exact: true }).fill("555-0199");
  await page.route("**/api/drivers/test-driver-001", async (route) => {
    method = route.request().method();
    saved = route.request().postDataJSON();
    return route.fulfill({ json: { ...drivers[0], ...saved } });
  });
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(method).toBe("PATCH");
  expect(saved).toMatchObject({
    phone: "555-0199",
    truckId: "test-truck-0",
    payRate: "25",
  });
});

test("profile errors retry and tablet layout stays within the viewport", async ({
  page,
}) => {
  await setup(page);
  await page.setViewportSize({ width: 820, height: 1180 });
  let fail = true;
  await page.route("**/api/drivers/test-driver-001", (route) =>
    route.fulfill({
      status: fail ? 500 : 200,
      json: fail
        ? { error: "Unavailable" }
        : {
            ...drivers[0],
            company: { name: "Preview Company" },
            loads: [],
            settlements: [],
            driverOrientations: [],
          },
    }),
  );
  await page.goto("/drivers");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/screenshots/drivers-dashboard-tablet.png",
    fullPage: true,
    animations: "disabled",
  });
  await page
    .getByRole("button", {
      name: "Open profile for Test Driver 1 Preview",
      exact: true,
    })
    .click();
  await expect(page.getByRole("dialog").getByRole("alert")).toContainText(
    "Profile could not be loaded",
  );
  fail = false;
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(
    page.getByText("No linked loads", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("tab", { name: "Assignments & Trips", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await expect(
    page.getByRole("tab", { name: "Pay & Settlements", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByText("No linked settlements", { exact: true }),
  ).toBeVisible();
});

test("driver APIs reject anonymous requests before reading private records", async ({
  request,
}) => {
  for (const path of ["/api/drivers", "/api/drivers/test-foreign-driver"]) {
    const response = await request.get(path);
    expect(response.status()).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Authentication is required.",
    });
    expect(response.headers()["cache-control"]).toContain("no-store");
  }
});
