import { expect, test, type Page } from 'playwright/test';
import type { KanbanProject } from '@/lib/tasks/kanban-types';

const baseProject: KanbanProject = {
  id: 'project-1',
  name: 'Fleet Operations',
  description: 'Coordinate dispatch, safety, and maintenance work.',
  boards: [
    {
      id: 'board-todo',
      name: 'To do',
      color: '#579bfc',
      order: 0,
      status: 'TODO',
      cards: [
        {
          id: 'card-inspection',
          title: 'Complete trailer inspection',
          description: 'Verify lights, brakes, and tire pressure before dispatch.',
          priority: 'URGENT',
          status: 'TODO',
          assignedTo: 'Maya Chen',
          dueDate: '2026-08-01T00:00:00.000Z',
          order: 0,
          updatedAt: '2026-07-28T09:00:00.000Z',
          labels: [{ id: 'label-safety', name: 'Safety', color: '#ef4444' }],
        },
        {
          id: 'card-rate',
          title: 'Review carrier rate confirmation',
          description: 'Confirm accessorial terms for load FP-2048.',
          priority: 'HIGH',
          status: 'TODO',
          assignedTo: 'Noah Williams',
          dueDate: '2026-08-04T00:00:00.000Z',
          order: 1,
          updatedAt: '2026-07-28T08:00:00.000Z',
          labels: [],
        },
      ],
    },
    {
      id: 'board-progress',
      name: 'In progress',
      color: '#fdab3d',
      order: 1,
      status: 'IN_PROGRESS',
      cards: [
        {
          id: 'card-driver',
          title: 'Confirm driver availability',
          description: 'Check hours of service before assigning the evening load.',
          priority: 'MEDIUM',
          status: 'IN_PROGRESS',
          assignedTo: 'Elena Ortiz',
          dueDate: null,
          order: 0,
          updatedAt: '2026-07-28T10:30:00.000Z',
          labels: [{ id: 'label-dispatch', name: 'Dispatch', color: '#8b5cf6' }],
        },
      ],
    },
    {
      id: 'board-review',
      name: 'Review',
      color: '#a25ddc',
      order: 2,
      status: 'IN_REVIEW',
      cards: [],
    },
    {
      id: 'board-done',
      name: 'Done',
      color: '#00c875',
      order: 3,
      status: 'DONE',
      cards: [],
    },
    {
      id: 'board-legacy',
      name: 'Imported backlog',
      color: '#64748b',
      order: 4,
      status: null,
      cards: [
        {
          id: 'card-legacy',
          title: 'Reconcile imported maintenance note',
          description: null,
          priority: 'LOW',
          status: 'TODO',
          assignedTo: null,
          dueDate: null,
          order: 0,
          updatedAt: '2026-07-26T09:00:00.000Z',
          labels: [],
        },
      ],
    },
  ],
};

async function mockTaskApis(page: Page) {
  const project = structuredClone(baseProject);
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
  let attachments: Array<{
    id: string;
    filename: string;
    byteSize: number;
    mimeType: string;
    createdAt: string;
    uploader: { id: string; displayName: string; image: null };
    canDelete: boolean;
  }> = [];
  let checklist = [
    {
      id: 'checklist-1',
      content: 'Inspect tire pressure',
      isCompleted: false,
      order: 0,
    },
  ];
  let comments: Array<{
    id: string;
    author: string;
    authorUser: { displayName: string; image: null } | null;
    content: string;
    createdAt: string;
    updatedAt: string;
    canEdit: boolean;
  }> = [
    {
      id: 'comment-1',
      author: 'Legacy dispatcher',
      authorUser: null,
      content: 'Historical handoff note.',
      createdAt: '2026-07-27T09:00:00.000Z',
      updatedAt: '2026-07-27T09:00:00.000Z',
      canEdit: false,
    },
  ];
  await page.route('**/api/tasks', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        json: [
          {
            id: project.id,
            name: project.name,
            description: project.description,
          },
        ],
      });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/tasks/projects/project-1/board', async (route) => {
    await route.fulfill({ json: project });
  });
  await page.route('**/api/tasks/mentions*', async (route) => {
    await route.fulfill({
      json: [{ id: 'user-maya', displayName: 'Maya Chen', image: null }],
    });
  });
  await page.route('**/api/tasks/assignees', async (route) => {
    await route.fulfill({
      json: [
        { id: 'user-maya', displayName: 'Maya Chen', image: null },
        { id: 'user-noah', displayName: 'Noah Williams', image: null },
      ],
    });
  });
  await page.route('**/api/tasks/cards', async (route) => {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as Record<string, string | null> & { id: string };
      const card = project.boards.flatMap(({ cards }) => cards).find(({ id }) => id === body.id)!;
      Object.assign(card, {
        ...(Object.hasOwn(body, 'description') ? { description: body.description } : {}),
        ...(Object.hasOwn(body, 'priority') ? { priority: body.priority } : {}),
        ...(Object.hasOwn(body, 'dueDate') ? { dueDate: body.dueDate } : {}),
        ...(Object.hasOwn(body, 'assigneeUserId')
          ? {
              assigneeUserId: body.assigneeUserId,
              assigneeUser: body.assigneeUserId === 'user-maya'
                ? { id: 'user-maya', displayName: 'Maya Chen', image: null }
                : null,
              assignedTo: null,
            }
          : {}),
        updatedAt: '2026-07-28T13:00:00.000Z',
      });
      await route.fulfill({
        json: card,
      });
      return;
    }
    await route.fallback();
  });
  await page.route('**/api/tasks/cards/*/attachments', async (route) => {
    if (route.request().method() === 'POST') {
      const attachment = {
        id: 'attachment-1',
        filename: 'inspection.pdf',
        byteSize: 12,
        mimeType: 'application/pdf',
        createdAt: '2026-07-28T13:00:00.000Z',
        uploader: { id: 'user-maya', displayName: 'Maya Chen', image: null },
        canDelete: true,
      };
      attachments = [...attachments, attachment];
      await route.fulfill({ status: 201, json: attachment });
      return;
    }
    await route.fulfill({ json: attachments });
  });
  await page.route('**/api/tasks/cards/*/attachments/*', async (route) => {
    if (route.request().url().includes('/download')) {
      await route.fulfill({
        body: '%PDF-1.7 mock',
        contentType: 'application/pdf',
      });
      return;
    }
    attachments = [];
    await route.fulfill({ json: { success: true } });
  });
  await page.route('**/api/tasks/cards/*/activity', async (route) => {
    await route.fulfill({
      json: [
        {
          id: 'activity-2',
          action: 'ASSIGNEE_CHANGED',
          actorType: 'USER',
          actorUser: { displayName: 'Maya Chen', image: null },
          entityTitle: 'Complete trailer inspection',
          metadata: {},
          occurredAt: '2026-07-28T09:00:00.000Z',
        },
        {
          id: 'activity-1',
          action: 'TASK_CREATED',
          actorType: 'SYSTEM',
          actorUser: null,
          entityTitle: 'Complete trailer inspection',
          metadata: {},
          occurredAt: '2026-07-27T09:00:00.000Z',
        },
      ],
    });
  });
  await page.route('**/api/tasks/cards/*/checklist', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { content: string };
      const item = {
        id: `checklist-${checklist.length + 1}`,
        content: body.content,
        isCompleted: false,
        order: checklist.length,
      };
      checklist = [...checklist, item];
      await route.fulfill({ status: 201, json: item });
      return;
    }
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON() as { itemIds: string[] };
      checklist = body.itemIds.map((id, order) => ({
        ...checklist.find((item) => item.id === id)!,
        order,
      }));
    }
    await route.fulfill({ json: checklist });
  });
  await page.route('**/api/tasks/cards/*/checklist/*', async (route) => {
    const itemId = route.request().url().split('/').at(-1)!;
    if (route.request().method() === 'DELETE') {
      checklist = checklist.filter(({ id }) => id !== itemId);
      await route.fulfill({ json: { success: true } });
      return;
    }
    const body = route.request().postDataJSON() as {
      content?: string;
      isCompleted?: boolean;
    };
    const item = checklist.find(({ id }) => id === itemId)!;
    const updated = { ...item, ...body };
    checklist = checklist.map((candidate) =>
      candidate.id === itemId ? updated : candidate,
    );
    await route.fulfill({ json: updated });
  });
  await page.route('**/api/tasks/cards/*/comments', async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { content: string };
      const comment = {
        id: `comment-${comments.length + 1}`,
        author: 'Signed-in user',
        authorUser: { displayName: 'Signed-in user', image: null },
        content: body.content,
        createdAt: '2026-07-28T12:00:00.000Z',
        updatedAt: '2026-07-28T12:00:00.000Z',
        canEdit: true,
      };
      comments = [...comments, comment];
      await route.fulfill({ status: 201, json: comment });
      return;
    }
    await route.fulfill({ json: comments });
  });
  await page.route('**/api/tasks/cards/*/comments/*', async (route) => {
    const commentId = route.request().url().split('/').at(-1)!;
    if (route.request().method() === 'DELETE') {
      comments = comments.filter(({ id }) => id !== commentId);
      await route.fulfill({ json: { success: true } });
      return;
    }
    const body = route.request().postDataJSON() as { content: string };
    const comment = {
      ...comments.find(({ id }) => id === commentId)!,
      content: body.content,
    };
    comments = comments.map((candidate) =>
      candidate.id === commentId ? comment : candidate,
    );
    await route.fulfill({ json: comment });
  });
  await page.route('**/api/tasks/cards/*/move', async (route) => {
    const body = route.request().postDataJSON() as { cardId: string; destinationBoardId: string };
    const movedCard = project.boards.flatMap(({ cards }) => cards).find(({ id }) => id === body.cardId)!;
    const destination = project.boards.find(({ id }) => id === body.destinationBoardId)!;
    project.boards.forEach((board) => {
      board.cards = board.cards.filter(({ id }) => id !== body.cardId);
    });
    destination.cards.push({ ...movedCard, status: destination.status ?? movedCard.status, order: destination.cards.length });
    await route.fulfill({
      json: project,
    });
  });
}

test.beforeEach(async ({ page }) => {
  await mockTaskApis(page);
  await page.goto('/tasks');
  await expect(page.getByLabel('Project')).toHaveValue('project-1');
  await expect(page.getByText('Coordinate dispatch, safety, and maintenance work.')).toBeVisible();
});

test('switches views, filters tasks, and keeps the legacy group visible', async ({
  page,
}) => {
  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByRole('columnheader', { name: 'Task' })).toBeVisible();
  await expect(page.getByText('Imported backlog')).toBeVisible();
  await expect(page.getByText('Legacy · unmapped')).toBeVisible();

  await page.getByPlaceholder('Search tasks').fill('trailer');
  await expect(page.getByRole('button', { name: 'Complete trailer inspection' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Confirm driver availability' })).toBeHidden();
  await expect(page.getByText('Imported backlog')).toBeVisible();
});

test('supports checklist and comment collaboration in the task drawer', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Complete trailer inspection', exact: true })
    .click();
  const drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: 'Complete trailer inspection' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await page
    .getByRole('button', { name: 'Complete trailer inspection', exact: true })
    .click();
  await expect(drawer).toBeVisible();
  await expect(drawer.getByText('changed the assignee')).toBeVisible();
  await expect(drawer.getByText('Historical handoff note.')).toBeVisible();
  await drawer.getByLabel('New checklist item').fill('Check brake lights');
  await drawer.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(drawer.getByText('Check brake lights')).toBeVisible();
  await drawer.getByLabel('Complete Check brake lights').check();
  await expect(drawer.getByText('1/2 complete')).toBeVisible();

  await drawer.getByLabel('New comment').fill('Inspection is underway.');
  await drawer.getByRole('button', { name: 'Comment' }).click();
  await expect(drawer.getByText('Inspection is underway.')).toBeVisible();
  const commentsSection = drawer.getByRole('region', { name: 'Comments' });
  await commentsSection.getByRole('button', { name: 'Edit' }).click();
  const commentEditor = drawer.getByLabel('Edit comment by Signed-in user');
  await commentEditor.fill('Unsaved edit');
  await page.keyboard.press('Escape');
  await expect(drawer).toBeVisible();
  await expect(commentEditor).toBeHidden();
  await commentsSection.getByRole('button', { name: 'Edit' }).click();
  await drawer
    .getByLabel('Edit comment by Signed-in user')
    .fill('Inspection is complete.');
  await commentsSection.getByRole('button', { name: 'Save' }).click();
  await expect(drawer.getByText('Inspection is complete.')).toBeVisible();
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(drawer).toBeHidden();
});

test('keeps task drawer focus modal and restores the exact task trigger', async ({
  page,
}) => {
  const trigger = page.getByRole('button', {
    name: 'Complete trailer inspection',
    exact: true,
  });
  await trigger.click();

  const drawer = page.getByRole('dialog', {
    name: 'Complete trailer inspection',
  });
  const closeButton = drawer.getByRole('button', { name: 'Close', exact: true });
  await expect(closeButton).toBeFocused();
  await expect(drawer).toHaveAttribute(
    'aria-describedby',
    'task-drawer-description',
  );

  await expect(
    page.locator('body > [inert][aria-hidden="true"]').first(),
  ).toBeAttached();
  await page.evaluate(() => {
    const backgroundViewButton = Array.from(
      document.querySelectorAll<HTMLButtonElement>('button'),
    ).find((button) => button.textContent?.trim() === 'Table');
    backgroundViewButton?.focus();
  });
  await expect(closeButton).toBeFocused();

  await page.keyboard.press('Shift+Tab');
  await expect(closeButton).not.toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(() =>
        document.querySelector('[role="dialog"]')?.contains(document.activeElement),
      ),
    )
    .toBe(true);
  await page.keyboard.press('Tab');
  await expect(closeButton).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
});

test('autosaves rich Markdown, scopes mentions, and uploads attachments', async ({
  page,
}) => {
  await page
    .getByRole('button', { name: 'Complete trailer inspection', exact: true })
    .click();
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('button', { name: 'write' }).click();
  const editor = drawer.getByLabel('Task description Markdown');
  const saveRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/tasks/cards') &&
      request.method() === 'PATCH',
  );
  await editor.fill(
    '# Inspection plan\n\n- [ ] Verify brakes\n\n<script>alert(1)</script>\n\n@Ma',
  );
  await drawer.getByRole('listbox', { name: 'Mention suggestions' }).getByRole('option', { name: 'Maya Chen' }).click();
  const request = await saveRequest;
  expect(request.postDataJSON().mentionUserIds).toEqual(['user-maya']);
  await expect(drawer.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await drawer.getByRole('button', { name: 'preview' }).click();
  await expect(drawer.getByRole('heading', { name: 'Inspection plan' })).toBeVisible();
  await expect(drawer.getByText('alert(1)')).toBeHidden();
  await expect(drawer.getByLabel('Mention Maya Chen')).toBeVisible();

  await drawer.getByLabel('Choose task attachment').setInputFiles({
    name: 'inspection.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.7 mock'),
  });
  await expect(drawer.getByText('Upload complete.')).toBeVisible();
  await expect(drawer.getByRole('link', { name: 'inspection.pdf' })).toBeVisible();
});

test('reconciles saved descriptions across drawer close and refresh', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Complete trailer inspection', exact: true });
  await trigger.click();
  let drawer = page.getByRole('dialog');
  await drawer.getByRole('button', { name: 'write' }).click();
  const savedResponse = page.waitForResponse((response) => response.url().endsWith('/api/tasks/cards') && response.request().method() === 'PATCH');
  await drawer.getByLabel('Task description Markdown').fill('# Persisted dispatch notes');
  await savedResponse;
  await expect(drawer.getByRole('status').filter({ hasText: 'Saved' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(drawer).toBeHidden();
  await trigger.click();
  drawer = page.getByRole('dialog');
  await expect(drawer.getByRole('heading', { name: 'Persisted dispatch notes' })).toBeVisible();
  await drawer.getByRole('button', { name: 'Close', exact: true }).click();
  await page.reload();
  await page.getByRole('button', { name: 'Complete trailer inspection', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Persisted dispatch notes' })).toBeVisible();
});

test('edits verified assignee and deadline inline in Board and Table views', async ({ page }) => {
  const assignee = page.getByLabel('Assignee for Complete trailer inspection');
  const assigneeRequest = page.waitForRequest((request) => request.url().endsWith('/api/tasks/cards') && request.method() === 'PATCH' && request.postData()?.includes('assigneeUserId') === true);
  await assignee.selectOption('user-maya');
  expect((await assigneeRequest).postDataJSON().assigneeUserId).toBe('user-maya');

  const deadline = page.getByLabel('Due date and time for Complete trailer inspection');
  await deadline.fill('2030-08-01T16:45');
  await expect(page.getByRole('timer').first()).toBeVisible();

  await page.getByRole('button', { name: 'Table' }).click();
  await expect(page.getByRole('columnheader', { name: 'Assignee' })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Countdown' })).toBeVisible();
  await expect(page.getByLabel('Assignee for Complete trailer inspection')).toHaveValue('user-maya');
  await expect(page.getByLabel('Due date and time for Complete trailer inspection')).toHaveValue('2030-08-01T16:45');
  const statusRequest = page.waitForRequest((request) => request.url().endsWith('/api/tasks/cards/card-inspection/move') && request.method() === 'POST');
  await page.getByLabel('Status for Complete trailer inspection').selectOption('IN_PROGRESS');
  expect((await statusRequest).postDataJSON().destinationBoardId).toBe('board-progress');
  await expect(page.getByLabel('Status for Complete trailer inspection')).toHaveValue('IN_PROGRESS');
});

test('shows description autosave failures and permits an explicit retry', async ({ page }) => {
  await page.route('**/api/tasks/cards', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ status: 409, json: { error: 'Task changed in another session.' } });
      return;
    }
    await route.fallback();
  });
  await page.getByRole('button', { name: 'Complete trailer inspection', exact: true }).click();
  const drawer = page.getByRole('dialog');
  await drawer.getByRole('button', { name: 'write' }).click();
  await drawer.getByLabel('Task description Markdown').fill('Unsaved dispatch change');
  await expect(drawer.getByRole('alert')).toHaveText('Task changed in another session.');
  await expect(drawer.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('moves a task optimistically and reconciles the canonical response', async ({
  page,
}) => {
  const handle = page.getByRole('button', {
    name: 'Move Complete trailer inspection',
  });
  const reviewGroup = page.locator('section').filter({
    has: page.getByRole('heading', { name: 'Review' }),
  });
  const [handleBox, reviewBox] = await Promise.all([
    handle.boundingBox(),
    reviewGroup.boundingBox(),
  ]);
  expect(handleBox).not.toBeNull();
  expect(reviewBox).not.toBeNull();

  const moveRequest = page.waitForRequest(
    (request) =>
      request.url().endsWith('/api/tasks/cards/card-inspection/move') &&
      request.method() === 'POST',
  );
  await page.mouse.move(
    handleBox!.x + handleBox!.width / 2,
    handleBox!.y + handleBox!.height / 2,
  );
  await page.mouse.down();
  await page.mouse.move(
    reviewBox!.x + reviewBox!.width / 2,
    reviewBox!.y + reviewBox!.height / 2,
    { steps: 12 },
  );
  await page.mouse.up();

  const request = await moveRequest;
  expect(request.postDataJSON()).toEqual({
    cardId: 'card-inspection',
    sourceBoardId: 'board-todo',
    destinationBoardId: 'board-review',
    destinationIndex: 0,
    expectedUpdatedAt: '2026-07-28T09:00:00.000Z',
  });
  await expect(
    reviewGroup.getByRole('button', {
      name: 'Complete trailer inspection',
      exact: true,
    }),
  ).toBeVisible();
});

test('captures approved desktop and responsive workspace references', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: 'docs/screenshots/task-alpha-board-desktop.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Table' }).click();
  await page.screenshot({
    path: 'docs/screenshots/task-alpha-table-desktop.png',
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Board' }).click();
  await page
    .getByRole('button', { name: 'Complete trailer inspection', exact: true })
    .click();
  await expect(page.getByRole('dialog').getByText('Historical handoff note.')).toBeVisible();
  await page.screenshot({
    path: 'docs/screenshots/task-rich-content-desktop.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'docs/screenshots/task-alpha-mobile.png',
    fullPage: true,
  });
  await page.screenshot({
    path: 'docs/screenshots/task-rich-content-responsive.png',
    fullPage: true,
  });
});
