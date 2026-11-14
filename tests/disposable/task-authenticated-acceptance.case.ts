import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { expect, test } from 'playwright/test';
import { assertDisposableIsolation } from './assert-isolation';

assertDisposableIsolation('tasks');

type BoardResponse = {
  id: string;
  boards: Array<{
    id: string;
    status: string | null;
    cards: Array<{ id: string; title: string; status: string; updatedAt: string }>;
  }>;
};

function checkedId(value: unknown): asserts value is string {
  expect(typeof value).toBe('string');
  expect(value).toMatch(/^[a-zA-Z0-9_-]{1,128}$/);
}
function checkedDate(value: unknown): asserts value is string {
  expect(typeof value).toBe('string');
  expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  expect(Number.isFinite(Date.parse(value as string))).toBe(true);
  expect(new Date(value as string).toISOString()).toBe(value);
}

// Isolated CI only. No rendered completed-card or DOM edit/move claim.
test('real email session persists an unassigned task through completion', async ({ browser, baseURL }) => {
  test.setTimeout(90_000);
  assertDisposableIsolation('tasks');
  const { prisma } = await import('@/lib/prisma');
  const errors: unknown[] = [];
  let context: Awaited<ReturnType<typeof browser.newContext>> | undefined;
  const companyId = randomUUID();
  const userId = randomUUID();
  const email = `task-acceptance-${randomUUID()}@example.test`;
  try {
    expect(baseURL).toBe('http://127.0.0.1:3100');

    // Refuse a reused/populated fixture database before writing anything. These
    // aggregate reads disclose no records; they do not replace the CI scope gate.
    expect(await prisma.user.count()).toBe(0);
    expect(await prisma.company.count()).toBe(0);
    expect(await prisma.taskProject.count()).toBe(0);
    expect(await prisma.telegramUserLink.count()).toBe(0);
    expect(await prisma.telegramDelivery.count()).toBe(0);

    const suffix = randomUUID();
    const projectName = `Synthetic Task Acceptance ${suffix}`;
    const title = `Synthetic unassigned task ${suffix}`;
    const editedTitle = `Synthetic edited task ${suffix}`;
    const token = randomBytes(32).toString('base64url');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    context = await browser.newContext({
      baseURL,
      storageState: { cookies: [], origins: [] },
      serviceWorkers: 'block',
    });
    const page = await context.newPage();

    const denied = await context.request.get('/api/tasks', { maxRedirects: 0 });
    expect(denied.status()).toBe(401);
    expect(await denied.json()).toEqual({ error: 'Authentication is required.' });

    // Seed only identity, Company membership and the actual one-time token.
    // The real Credentials provider consumes it and issues the session cookie.
    await prisma.company.create({ data: { id: companyId, name: `Synthetic Company ${suffix}` } });
    await prisma.user.create({
      data: {
        id: userId,
        email,
        displayName: 'Synthetic Task Acceptance User',
        isActive: true,
        activeCompanyId: companyId,
        memberships: { create: { companyId, role: 'MEMBER' } },
      },
    });
    await prisma.emailSignInToken.create({
      data: { userId, email, tokenHash, expiresAt: new Date(Date.now() + 15 * 60 * 1000) },
    });
    await page.goto(`/login/email/verify#token=${token}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');
    const consumed = await prisma.emailSignInToken.findUniqueOrThrow({ where: { tokenHash } });
    expect(consumed.consumedAt).not.toBeNull();
    const sessionResponse = await context.request.get('/api/auth/session');
    expect(sessionResponse.status()).toBe(200);
    expect((await sessionResponse.json()).user.id).toBe(userId);

    const projectResponse = await context.request.post('/api/tasks', { data: { name: projectName } });
    expect(projectResponse.status()).toBe(201);
    const project = await projectResponse.json() as {
      id: string;
      boards: Array<{ id: string; status: string | null }>;
    };
    checkedId(project.id);
    expect(Array.isArray(project.boards)).toBe(true);
    expect(await prisma.taskProject.findUniqueOrThrow({ where: { id: project.id } }))
      .toMatchObject({ name: projectName, companyId });
    const todo = project.boards.find((board) => board.status === 'TODO');
    const done = project.boards.find((board) => board.status === 'DONE');
    expect(todo).toBeDefined();
    expect(done).toBeDefined();
    if (!todo || !done) throw new Error('Expected the existing default TODO and DONE boards.');
    checkedId(todo.id);
    checkedId(done.id);

    // Card POST/PATCH drain the GLOBAL Telegram queue. A fresh isolated DB,
    // no links, no assignment and no concurrent writers are required, not just
    // a synthetic Company. Never clear someone else's delivery queue to pass.
    expect(await prisma.telegramDelivery.count()).toBe(0);
    const createResponse = await context.request.post('/api/tasks/cards', {
      data: { projectId: project.id, boardId: todo.id, title },
    });
    expect(createResponse.status()).toBe(201);
    const card = await createResponse.json() as { id: string; updatedAt: string };
    checkedId(card.id);
    checkedDate(card.updatedAt);
    expect(await prisma.taskCard.findUniqueOrThrow({ where: { id: card.id } })).toMatchObject({
      projectId: project.id,
      boardId: todo.id,
      title,
      status: 'TODO',
      assigneeUserId: null,
      createdByUserId: userId,
      completedAt: null,
    });
    const boardPath = `/api/tasks/projects/${project.id}/board`;
    const initialBoard = await context.request.get(boardPath);
    expect(initialBoard.status()).toBe(200);
    expect((await initialBoard.json() as BoardResponse).boards.flatMap((board) => board.cards))
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: card.id, title, status: 'TODO' })]));

    expect(await prisma.telegramDelivery.count()).toBe(0);
    const editResponse = await context.request.patch('/api/tasks/cards', {
      data: { id: card.id, title: editedTitle, expectedUpdatedAt: card.updatedAt },
    });
    expect(editResponse.status()).toBe(200);
    const edited = await editResponse.json() as { id: string; updatedAt: string };
    checkedId(edited.id);
    expect(edited.id).toBe(card.id);
    checkedDate(edited.updatedAt);
    const moveResponse = await context.request.post(`/api/tasks/cards/${card.id}/move`, {
      data: {
        sourceBoardId: todo.id,
        destinationBoardId: done.id,
        destinationIndex: 0,
        expectedUpdatedAt: edited.updatedAt,
      },
    });
    expect(moveResponse.status()).toBe(200);
    const moved = await moveResponse.json() as BoardResponse;
    checkedId(moved.id);
    expect(moved.id).toBe(project.id);
    const movedCard = moved.boards.find((board) => board.id === done.id)?.cards.find((item) => item.id === card.id);
    expect(movedCard).toBeDefined();
    if (!movedCard) throw new Error('Move response omitted the completed card.');
    checkedId(movedCard.id);
    checkedDate(movedCard.updatedAt);
    const persisted = await prisma.taskCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(persisted).toMatchObject({ boardId: done.id, title: editedTitle, status: 'DONE', assigneeUserId: null });
    expect(persisted.completedAt).not.toBeNull();

    // Reload the actual workspace, then read the explicit all-time completion
    // view to avoid a midnight-sensitive assertion about the active-board view.
    await page.reload();
    await expect(page.getByLabel('Project', { exact: true })).toHaveValue(project.id);
    const completedResponse = await context.request.get(`${boardPath}?view=completed&period=all`);
    expect(completedResponse.status()).toBe(200);
    const completedBoard = await completedResponse.json() as BoardResponse;
    expect(completedBoard.boards.find((board) => board.id === done.id)?.cards)
      .toEqual(expect.arrayContaining([expect.objectContaining({ id: card.id, title: editedTitle, status: 'DONE' })]));
    const afterReload = await prisma.taskCard.findUniqueOrThrow({ where: { id: card.id } });
    expect(afterReload.completedAt?.toISOString()).toBe(persisted.completedAt?.toISOString());
    expect(afterReload).toMatchObject({ boardId: done.id, title: editedTitle, status: 'DONE' });

    const activityResponse = await context.request.get(`/api/tasks/cards/${card.id}/activity`);
    expect(activityResponse.status()).toBe(200);
    const activities = await activityResponse.json() as Array<{ id: string; action: string; actorUserId: string | null }>;
    const storedActivities = await prisma.taskActivity.findMany({ where: { projectId: project.id, cardId: card.id } });
    expect(activities.map((activity) => activity.id).sort())
      .toEqual(storedActivities.map((activity) => activity.id).sort());
    for (const action of ['TASK_CREATED', 'TITLE_CHANGED', 'BOARD_CHANGED', 'STATUS_CHANGED']) {
      expect(activities).toEqual(expect.arrayContaining([
        expect.objectContaining({ action, actorUserId: userId }),
      ]));
    }
    expect(await prisma.telegramDelivery.count()).toBe(0);
    expect(await prisma.telegramUserLink.count()).toBe(0);
    expect(await prisma.emailSignInRequest.count()).toBe(0);
  } catch (error) {
    errors.push(error);
  } finally {
    // Each cleanup is attempted even when another fails. Primary remains first.
    try { await context?.close(); } catch (error) { errors.push(error); }
    try {
      await prisma.$transaction([
        prisma.taskActivity.deleteMany({ where: { project: { companyId } } }),
        prisma.taskCard.deleteMany({ where: { project: { companyId } } }),
        prisma.taskBoard.deleteMany({ where: { project: { companyId } } }),
        prisma.taskProject.deleteMany({ where: { companyId } }),
        prisma.emailSignInToken.deleteMany({ where: { userId } }),
        prisma.authAccount.deleteMany({ where: { userId } }),
        prisma.companyMembership.deleteMany({ where: { userId, companyId } }),
        prisma.user.deleteMany({ where: { id: userId, email } }),
        prisma.company.deleteMany({ where: { id: companyId } }),
      ], { timeout: 10_000 });
    } catch (error) { errors.push(error); }
    for (const check of [
      () => prisma.taskProject.count({ where: { companyId } }),
      () => prisma.user.count({ where: { id: userId } }),
      () => prisma.company.count({ where: { id: companyId } }),
    ]) {
      try { expect(await check()).toBe(0); } catch (error) { errors.push(error); }
    }
    try { await prisma.$disconnect(); } catch (error) { errors.push(error); }
  }
  if (errors.length) throw new AggregateError(errors, 'Task acceptance and/or owned cleanup failed');
});
