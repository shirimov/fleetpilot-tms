import { expect, test, type Page } from 'playwright/test';

const project = {
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
    const movedCard = project.boards[0].cards[0];
    await route.fulfill({
      json: {
        ...project,
        boards: project.boards.map((board) => {
          if (board.id === 'board-todo') {
            return { ...board, cards: board.cards.slice(1) };
          }
          if (board.id === 'board-review') {
            return {
              ...board,
              cards: [{ ...movedCard, status: 'IN_REVIEW', order: 0 }],
            };
          }
          return board;
        }),
      },
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
  await drawer
    .getByLabel('Edit comment by Signed-in user')
    .fill('Inspection is complete.');
  await commentsSection.getByRole('button', { name: 'Save' }).click();
  await expect(drawer.getByText('Inspection is complete.')).toBeVisible();
  await page.keyboard.press('Escape');
  if (await drawer.isVisible()) {
    await page.keyboard.press('Escape');
  }
  await expect(drawer).toBeHidden();
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
  await page
    .getByRole('button', { name: 'Complete trailer inspection', exact: true })
    .click();
  await expect(page.getByRole('dialog').getByText('Historical handoff note.')).toBeVisible();
  await page.screenshot({
    path: 'docs/screenshots/task-collaboration-desktop.png',
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'docs/screenshots/task-collaboration-responsive.png',
    fullPage: true,
  });
});
