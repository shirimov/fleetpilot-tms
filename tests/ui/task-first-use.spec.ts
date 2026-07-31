import { expect, test, type Page, type Route } from 'playwright/test';

type FirstUseOptions = {
  failProjectCreation?: boolean;
  holdTaskCreation?: boolean;
};

async function mockFirstUseApis(page: Page, options: FirstUseOptions = {}) {
  let projectExists = false;
  let taskPostCount = 0;
  let releaseTaskCreation: (() => void) | undefined;
  const taskCreationGate = options.holdTaskCreation
    ? new Promise<void>((resolve) => {
        releaseTaskCreation = resolve;
      })
    : Promise.resolve();
  const project = {
    id: 'project-new',
    name: 'Alpha Operations',
    description: null,
    boards: [
      {
        id: 'board-todo',
        name: 'To do',
        color: '#3b82f6',
        order: 0,
        status: 'TODO',
        cards: [] as Array<Record<string, unknown>>,
      },
      {
        id: 'board-progress',
        name: 'In progress',
        color: '#f59e0b',
        order: 1,
        status: 'IN_PROGRESS',
        cards: [] as Array<Record<string, unknown>>,
      },
      {
        id: 'board-review',
        name: 'In review',
        color: '#8b5cf6',
        order: 2,
        status: 'IN_REVIEW',
        cards: [] as Array<Record<string, unknown>>,
      },
      {
        id: 'board-done',
        name: 'Done',
        color: '#10b981',
        order: 3,
        status: 'DONE',
        cards: [] as Array<Record<string, unknown>>,
      },
    ],
  };

  await page.route('**/api/auth/company', (route) =>
    route.fulfill({
      json: {
        user: {
          displayName: 'Alpha Owner',
          email: 'owner@alpha.test',
          image: null,
        },
        activeCompanyId: 'company-alpha',
        companies: [
          { id: 'company-alpha', name: 'Alpha Transport', role: 'OWNER' },
        ],
      },
    }),
  );
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: projectExists
          ? [{ id: project.id, name: project.name, description: null }]
          : [],
      });
      return;
    }
    if (options.failProjectCreation) {
      await route.fulfill({
        status: 400,
        json: { error: 'Project name is already in use.' },
      });
      return;
    }
    projectExists = true;
    await route.fulfill({ status: 201, json: project });
  });
  await page.route('**/api/tasks/projects/project-new/board', (route) =>
    route.fulfill({ json: project }),
  );
  await page.route('**/api/tasks/cards', async (route: Route) => {
    if (route.request().method() !== 'POST') {
      await route.fallback();
      return;
    }
    taskPostCount += 1;
    await taskCreationGate;
    const body = route.request().postDataJSON() as {
      boardId: string;
      title: string;
      priority: string;
      dueDate: string | null;
    };
    const destination = project.boards.find(({ id }) => id === body.boardId)!;
    const card = {
      id: 'card-new',
      title: body.title,
      description: null,
      priority: body.priority,
      status: destination.status,
      assignedTo: null,
      dueDate: body.dueDate
        ? `${body.dueDate}T00:00:00.000Z`
        : null,
      order: destination.cards.length,
      updatedAt: '2030-01-01T00:00:00.000Z',
      labels: [],
      checklistItems: [],
    };
    destination.cards.push(card);
    await route.fulfill({ status: 201, json: card });
  });

  return {
    getTaskPostCount: () => taskPostCount,
    releaseTaskCreation: () => releaseTaskCreation?.(),
  };
}

test('creates the first project with accessible focus management', async ({
  page,
}) => {
  await mockFirstUseApis(page);
  await page.goto('/tasks');

  await expect(page.getByRole('heading', { name: 'No task projects yet' })).toBeVisible();
  const addTask = page.getByRole('button', { name: '+ Add task' });
  await expect(addTask).toBeDisabled();
  await expect(addTask).toHaveAttribute(
    'title',
    'Create a project before adding tasks',
  );

  const trigger = page.getByRole('button', { name: 'Create project' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Create project' });
  const nameInput = dialog.getByLabel('Project name');
  await expect(nameInput).toBeFocused();
  await expect(page.locator('body > [inert][aria-hidden="true"]').first()).toBeAttached();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.click();
  await nameInput.fill('Alpha Operations');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel('Project')).toHaveValue('project-new');
  await expect(page.getByRole('heading', { name: 'To do' })).toBeVisible();
  await expect(addTask).toBeEnabled();
});

test('creates one task and reconciles it into board and table views', async ({
  page,
}) => {
  const controls = await mockFirstUseApis(page, { holdTaskCreation: true });
  await page.goto('/tasks');
  await page.getByRole('button', { name: 'Create project' }).click();
  await page.getByLabel('Project name').fill('Alpha Operations');
  await page
    .getByRole('dialog', { name: 'Create project' })
    .getByRole('button', { name: 'Create project' })
    .click();
  await expect(page.getByRole('heading', { name: 'To do' })).toBeVisible();

  const trigger = page.getByRole('button', { name: '+ Add task' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Add a task' });
  const titleInput = dialog.getByLabel('Title');
  await expect(titleInput).toBeFocused();
  await expect(dialog.getByLabel('Project')).toHaveValue('project-new');
  await titleInput.fill('Prepare first dispatch');
  await dialog.getByLabel('Status').selectOption('IN_PROGRESS');
  await dialog.getByLabel('Priority').selectOption('HIGH');
  await dialog.getByLabel('Due date').fill('2030-01-15');

  const submit = dialog.locator('button[type="submit"]');
  await submit.click();
  await expect(submit).toBeDisabled();
  await expect(submit).toHaveText('Adding…');
  await submit.evaluate((button: HTMLButtonElement) => button.click());
  expect(controls.getTaskPostCount()).toBe(1);
  controls.releaseTaskCreation();

  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
  const progressGroup = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'In progress' }),
  });
  await expect(
    progressGroup.getByRole('button', {
      name: 'Prepare first dispatch',
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByRole('cell', { name: 'Prepare first dispatch' })).toBeVisible();
});

test('keeps project API errors in the creation dialog', async ({ page }) => {
  await mockFirstUseApis(page, { failProjectCreation: true });
  await page.goto('/tasks');
  const trigger = page.getByRole('button', { name: 'Create project' });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Create project' });
  await dialog.getByLabel('Project name').fill('Duplicate project');
  await dialog.getByRole('button', { name: 'Create project' }).click();
  await expect(dialog.getByRole('alert')).toHaveText(
    'Project name is already in use.',
  );
  await expect(dialog).toBeVisible();
  await expect(dialog.locator('button[type="submit"]')).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});
