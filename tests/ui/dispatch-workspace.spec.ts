import { expect, test, type Page } from 'playwright/test';

const columns = [
  'DRAFT',
  'PLANNED',
  'ASSIGNED',
  'DISPATCHED',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'POD_UPLOADED',
  'INVOICED',
  'PAID',
] as const;

const load = {
  id: 'load-1',
  loadNumber: 'FP-2048',
  referenceNum: 'RC-88',
  status: 'DRAFT',
  origin: 'Houston, TX',
  destination: 'Dallas, TX',
  pickupDate: '2026-08-02T08:00:00.000Z',
  deliveryDate: '2026-08-02T12:00:00.000Z',
  rate: 2500,
  fuelSurcharge: 100,
  truckId: null,
  driverId: null,
  trailerId: null,
  customerId: 'customer-1',
  invoiceNumber: null,
  updatedAt: '2026-07-29T08:00:00.000Z',
  truck: null,
  driver: null,
  trailer: null,
  customer: { id: 'customer-1', name: 'Alpha Broker', contacts: [] },
  stops: [
    {
      id: 'stop-1',
      type: 'PICKUP',
      order: 0,
      facilityName: 'Houston shipper',
      city: 'Houston',
      state: 'TX',
      appointmentStart: '2026-08-02T08:00:00.000Z',
      appointmentEnd: null,
    },
    {
      id: 'stop-2',
      type: 'DELIVERY',
      order: 1,
      facilityName: 'Dallas receiver',
      city: 'Dallas',
      state: 'TX',
      appointmentStart: '2026-08-02T12:00:00.000Z',
      appointmentEnd: null,
    },
  ],
  documents: [],
  exceptions: ['UNASSIGNED'],
};

async function mockDispatch(page: Page) {
  let currentStatus = 'DRAFT';
  const customers = [
    {
      id: 'customer-1',
      name: 'Alpha Broker',
      email: 'ops@alpha.test',
      phone: null,
      notes: 'Priority customer',
      contacts: [],
    },
  ];
  const trailers = [
    {
      id: 'trailer-1',
      unitNumber: 'TR-101',
      equipmentType: 'DRY_VAN',
      status: 'AVAILABLE',
      vin: null,
      plate: 'ABC123',
      assignment: null,
      documents: [],
    },
  ];
  await page.route('**/api/auth/company', (route) =>
    route.fulfill({
      json: {
        user: {
          displayName: 'Alpha Dispatcher',
          email: 'dispatch@fleetpilot.test',
          image: null,
        },
        activeCompanyId: 'company-alpha',
        companies: [
          { id: 'company-alpha', name: 'Alpha Transport', role: 'OWNER' },
        ],
      },
    }),
  );
  await page.route('**/api/dispatch/board**', async (route) => {
    await route.fulfill({
      json: {
        columns: columns.map((status) => ({
          status,
          loads: status === currentStatus ? [{ ...load, status: currentStatus }] : [],
        })),
      },
    });
  });
  await page.route('**/api/customers**', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      customers.push({ id: 'customer-2', ...body, contacts: body.contacts ?? [] });
      await route.fulfill({ status: 201, json: customers.at(-1) });
      return;
    }
    await route.fulfill({ json: customers });
  });
  await page.route('**/api/trailers**', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      trailers.push({
        id: 'trailer-2',
        ...body,
        vin: body.vin || null,
        plate: body.plate || null,
        assignment: null,
        documents: [],
      });
      await route.fulfill({ status: 201, json: trailers.at(-1) });
      return;
    }
    await route.fulfill({ json: trailers });
  });
  await page.route('**/api/trucks', (route) =>
    route.fulfill({ json: [{ id: 'truck-1', unitNumber: 'T-101' }] }),
  );
  await page.route('**/api/drivers', (route) =>
    route.fulfill({
      json: [{ id: 'driver-1', firstName: 'Alex', lastName: 'Driver' }],
    }),
  );
  await page.route('**/api/loads/load-1/transition', async (route) => {
    currentStatus = route.request().postDataJSON().status;
    await route.fulfill({ json: { ...load, status: currentStatus } });
  });
  await page.route('**/api/loads', async (route) => {
    await route.fulfill({ status: 201, json: { ...load, id: 'load-2' } });
  });
}

test.beforeEach(async ({ page }) => {
  await mockDispatch(page);
  await page.goto('/loads');
  await expect(page.getByRole('heading', { name: 'Dispatch workflow' })).toBeVisible();
});

test('opens completed dispatch modules from primary navigation', async ({ page }) => {
  await page.getByRole('link', { name: 'Customers', exact: true }).click();
  await expect(page).toHaveURL(/\/loads\?view=customers$/);
  await expect(page.getByRole('tab', { name: 'Customers' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByRole('link', { name: 'Trailers', exact: true }).click();
  await expect(page).toHaveURL(/\/loads\?view=trailers$/);
  await expect(page.getByRole('tab', { name: 'Trailers' })).toHaveAttribute(
    'aria-selected',
    'true',
  );

  await page.getByRole('link', { name: 'Loads', exact: true }).click();
  await expect(page).toHaveURL(/\/loads\?view=loads$/);
  await expect(page.getByRole('columnheader', { name: 'Load' })).toBeVisible();

  await page.getByRole('link', { name: 'Dispatch Board', exact: true }).click();
  await expect(page).toHaveURL(/\/loads\?view=dispatch$/);
  await expect(page.getByRole('region', { name: 'Draft loads' })).toBeVisible();
});

test('searches, manages customers and trailers, and creates multi-stop loads', async ({
  page,
}) => {
  await page.getByLabel('Search dispatch loads').fill('FP-2048');
  await expect(page.getByText('FP-2048')).toBeVisible();

  await page.getByRole('tab', { name: 'Customers' }).click();
  await page.getByLabel('Customer name').fill('Beta Shipper');
  await page.getByLabel('Primary contact').fill('Sam Dock');
  await page.getByRole('button', { name: 'Save customer' }).click();
  await expect(page.getByRole('heading', { name: 'Beta Shipper' })).toBeVisible();

  await page.getByRole('tab', { name: 'Trailers' }).click();
  await page.getByLabel('Unit number').fill('TR-202');
  await page.getByRole('button', { name: 'Save trailer' }).click();
  await expect(page.getByText('TR-202')).toBeVisible();

  await page.getByRole('button', { name: 'New load' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Load number').fill('FP-3000');
  await dialog.getByLabel('Rate').fill('3200');
  await dialog.getByLabel('Facility').first().fill('Origin dock');
  await dialog.getByLabel('city').first().fill('Laredo');
  await dialog.getByLabel('Facility').nth(1).fill('Destination dock');
  await dialog.getByLabel('city').nth(1).fill('Austin');
  await dialog.getByRole('button', { name: 'pickup' }).click();
  await expect(dialog.getByText('3. PICKUP')).toBeVisible();
  await dialog.getByLabel('Facility').nth(2).fill('Second pickup');
  await dialog.getByLabel('city').nth(2).fill('San Antonio');
  await dialog.getByRole('button', { name: 'Save load' }).click();
  await expect(dialog).toBeHidden();
});

test('moves a load through the dispatch board and shows exception indicators', async ({
  page,
}) => {
  await expect(page.getByLabel('1 exceptions')).toBeVisible();
  const card = page.getByText('FP-2048');
  const planned = page.getByRole('region', { name: 'Planned loads' });
  const cardBox = await card.boundingBox();
  const plannedBox = await planned.boundingBox();
  if (!cardBox || !plannedBox) throw new Error('Drag targets are unavailable.');
  await page.mouse.move(cardBox.x + cardBox.width / 2, cardBox.y + cardBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(plannedBox.x + plannedBox.width / 2, plannedBox.y + 80, {
    steps: 12,
  });
  await page.mouse.up();
  await expect(planned.getByText('FP-2048')).toBeVisible();
});
