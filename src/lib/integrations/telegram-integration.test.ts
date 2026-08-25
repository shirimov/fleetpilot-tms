/* eslint-disable @typescript-eslint/no-explicit-any */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { after } from 'node:test';
import test from 'node:test';
import { prisma } from '@/lib/prisma';
import { createTelegramCallbackData } from './telegram-callback';
import { telegramLinkService } from './telegram-link-service';
import { telegramDeliveryService } from './telegram-delivery-service';
import { telegramWebhookService } from './telegram-webhook-service';
import { taskService } from '@/lib/tasks/task-service';
import * as TelegramWebhookRoute from '@/app/api/integrations/telegram/webhook/route';

const originalEnv = {
  TELEGRAM_ENABLED: process.env.TELEGRAM_ENABLED,
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
  TELEGRAM_BOT_USERNAME: process.env.TELEGRAM_BOT_USERNAME,
  AUTH_URL: process.env.AUTH_URL,
};
const originalFetch = global.fetch;

process.env.TELEGRAM_ENABLED = 'true';
process.env.TELEGRAM_BOT_TOKEN = '123456:telegram-test-token';
process.env.TELEGRAM_WEBHOOK_SECRET = 'telegram-webhook-secret';
process.env.TELEGRAM_BOT_USERNAME = 'fleetpilot_test_bot';
process.env.AUTH_URL = 'https://alpha.example.test';

type Fixture = Awaited<ReturnType<typeof createFixture>>;

async function createFixture() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const company = await prisma.company.create({
    data: { name: `telegram-int-${stamp}` },
  });
  const foreignCompany = await prisma.company.create({
    data: { name: `telegram-foreign-${stamp}` },
  });
  const owner = await prisma.user.create({
    data: { email: `owner-${stamp}@telegram.test`, displayName: 'Owner User' },
  });
  const member = await prisma.user.create({
    data: { email: `member-${stamp}@telegram.test`, displayName: 'Member User' },
  });
  const outsider = await prisma.user.create({
    data: { email: `outsider-${stamp}@telegram.test`, displayName: 'Outsider User' },
  });
  const foreignMember = await prisma.user.create({
    data: { email: `foreign-${stamp}@telegram.test`, displayName: 'Foreign User' },
  });
  await prisma.companyMembership.createMany({
    data: [
      { companyId: company.id, userId: owner.id, role: 'OWNER' },
      { companyId: company.id, userId: member.id, role: 'MEMBER' },
      { companyId: foreignCompany.id, userId: foreignMember.id, role: 'MEMBER' },
    ],
  });
  const project = await prisma.taskProject.create({
    data: { name: 'Telegram Project', companyId: company.id },
  });
  const todoBoard = await prisma.taskBoard.create({
    data: { projectId: project.id, name: 'To Do', order: 0, status: 'TODO' },
  });
  const inProgressBoard = await prisma.taskBoard.create({
    data: {
      projectId: project.id,
      name: 'In Progress',
      order: 1,
      status: 'IN_PROGRESS',
    },
  });
  const doneBoard = await prisma.taskBoard.create({
    data: { projectId: project.id, name: 'Done', order: 2, status: 'DONE' },
  });
  const card = await prisma.taskCard.create({
    data: {
      projectId: project.id,
      boardId: todoBoard.id,
      title: 'Call Daimler Financial',
      description: 'Call them back with the updated financing details.',
      assigneeUserId: member.id,
      priority: 'HIGH',
      status: 'TODO',
      dueDate: new Date(Date.now() + 2 * 60 * 60 * 1000),
    },
  });
  const foreignProject = await prisma.taskProject.create({
    data: { name: 'Foreign Telegram Project', companyId: foreignCompany.id },
  });
  const foreignBoard = await prisma.taskBoard.create({
    data: { projectId: foreignProject.id, name: 'To Do', order: 0, status: 'TODO' },
  });
  const foreignCard = await prisma.taskCard.create({
    data: {
      projectId: foreignProject.id,
      boardId: foreignBoard.id,
      title: 'Foreign task',
      priority: 'MEDIUM',
      status: 'TODO',
      assigneeUserId: foreignMember.id,
    },
  });
  return {
    company,
    foreignCompany,
    owner,
    member,
    outsider,
    foreignMember,
    project,
    todoBoard,
    inProgressBoard,
    doneBoard,
    card,
    foreignCard,
  };
}

async function destroyFixture(fixture: Fixture) {
  await prisma.telegramDelivery.deleteMany({
    where: { companyId: { in: [fixture.company.id, fixture.foreignCompany.id] } },
  });
  await prisma.telegramPendingAction.deleteMany({
    where: { companyId: { in: [fixture.company.id, fixture.foreignCompany.id] } },
  });
  await prisma.telegramUpdateRequest.deleteMany({
    where: { companyId: { in: [fixture.company.id, fixture.foreignCompany.id] } },
  });
  await prisma.telegramInboundUpdate.deleteMany({
    where: { companyId: { in: [fixture.company.id, fixture.foreignCompany.id] } },
  });
  await prisma.telegramLinkToken.deleteMany({
    where: { companyId: { in: [fixture.company.id, fixture.foreignCompany.id] } },
  });
  await prisma.telegramUserLink.deleteMany({
    where: { companyId: { in: [fixture.company.id, fixture.foreignCompany.id] } },
  });
  await prisma.taskActivity.deleteMany({
    where: { projectId: { in: [fixture.project.id, fixture.foreignCard.projectId] } },
  });
  await prisma.taskProject.deleteMany({
    where: { id: { in: [fixture.project.id, fixture.foreignCard.projectId] } },
  });
  await prisma.companyMembership.deleteMany({
    where: { companyId: { in: [fixture.company.id, fixture.foreignCompany.id] } },
  });
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [
          fixture.owner.id,
          fixture.member.id,
          fixture.outsider.id,
          fixture.foreignMember.id,
        ],
      },
    },
  });
  await prisma.company.deleteMany({
    where: { id: { in: [fixture.company.id, fixture.foreignCompany.id] } },
  });
}

function parseStartToken(deepLink: string) {
  return new URL(deepLink).searchParams.get('start')!;
}

function installFetchMock(
  handler: (url: string, init?: RequestInit) => Promise<Response> | Response,
) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  global.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}

function okTelegramResponse(body: unknown) {
  return new Response(JSON.stringify({ ok: true, result: body }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

after(async () => {
  global.fetch = originalFetch;
  process.env.TELEGRAM_ENABLED = originalEnv.TELEGRAM_ENABLED;
  process.env.TELEGRAM_BOT_TOKEN = originalEnv.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_WEBHOOK_SECRET = originalEnv.TELEGRAM_WEBHOOK_SECRET;
  process.env.TELEGRAM_BOT_USERNAME = originalEnv.TELEGRAM_BOT_USERNAME;
  process.env.AUTH_URL = originalEnv.AUTH_URL;
  await prisma.$disconnect();
});

test('linking stores only token hash, consumes once, and links numeric Telegram identity', async () => {
  const fixture = await createFixture();
  try {
    const invitation = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    });
    const token = parseStartToken(invitation.deepLink);
    const tokenRow = await prisma.telegramLinkToken.findFirstOrThrow({
      where: { companyId: fixture.company.id, userId: fixture.member.id },
    });
    assert.notEqual(tokenRow.tokenHash, token);
    const linked = await telegramLinkService.consumeLinkToken({
      token,
      telegramUserId: BigInt(99887766),
      telegramChatId: BigInt(99887766),
      telegramUsername: 'member_username',
    });
    assert.equal(linked.link.telegramUserId, BigInt(99887766));
    await assert.rejects(
      telegramLinkService.consumeLinkToken({
        token,
        telegramUserId: BigInt(99887766),
        telegramChatId: BigInt(99887766),
        telegramUsername: 'member_username',
      }),
      /invalid or expired/i,
    );

    const concurrentInvitation = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    });
    const concurrentToken = parseStartToken(concurrentInvitation.deepLink);
    const concurrentResults = await Promise.allSettled([
      telegramLinkService.consumeLinkToken({
        token: concurrentToken,
        telegramUserId: BigInt(99887767),
        telegramChatId: BigInt(99887767),
        telegramUsername: 'first_claim',
      }),
      telegramLinkService.consumeLinkToken({
        token: concurrentToken,
        telegramUserId: BigInt(99887768),
        telegramChatId: BigInt(99887768),
        telegramUsername: 'second_claim',
      }),
    ]);
    assert.equal(
      concurrentResults.filter(({ status }) => status === 'fulfilled').length,
      1,
    );
  } finally {
    await destroyFixture(fixture);
  }
});

test('linking rejects expired, removed-membership, and inactive-user tokens', async () => {
  const fixture = await createFixture();
  try {
    await assert.rejects(
      telegramLinkService.createLinkInvitation({
        actorUserId: fixture.owner.id,
        actorRole: 'OWNER',
        companyId: fixture.company.id,
        userId: fixture.foreignMember.id,
      }),
      /active company members/i,
    );
    const invitation = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    });
    const token = parseStartToken(invitation.deepLink);
    await prisma.telegramLinkToken.updateMany({
      where: { companyId: fixture.company.id, userId: fixture.member.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await assert.rejects(
      telegramLinkService.consumeLinkToken({
        token,
        telegramUserId: BigInt(101),
        telegramChatId: BigInt(101),
        telegramUsername: null,
      }),
      /invalid or expired/i,
    );

    const invitation2 = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    });
    await prisma.companyMembership.deleteMany({
      where: { companyId: fixture.company.id, userId: fixture.member.id },
    });
    await assert.rejects(
      telegramLinkService.consumeLinkToken({
        token: parseStartToken(invitation2.deepLink),
        telegramUserId: BigInt(202),
        telegramChatId: BigInt(202),
        telegramUsername: null,
      }),
      /no longer valid/i,
    );

    await prisma.companyMembership.create({
      data: { companyId: fixture.company.id, userId: fixture.member.id, role: 'MEMBER' },
    });
    await prisma.user.update({
      where: { id: fixture.member.id },
      data: { isActive: false },
    });
    const invitation3 = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    }).catch((error) => error);
    assert(invitation3 instanceof Error);
  } finally {
    await destroyFixture(fixture);
  }
});

test('global telegram identity uniqueness prevents one Telegram user from linking to two FleetPilot users', async () => {
  const fixture = await createFixture();
  try {
    const secondMember = await prisma.user.create({
      data: { email: `second-${Date.now()}@telegram.test`, displayName: 'Second Member' },
    });
    await prisma.companyMembership.create({
      data: { companyId: fixture.company.id, userId: secondMember.id, role: 'MEMBER' },
    });
    const first = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    });
    const second = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: secondMember.id,
    });
    await telegramLinkService.consumeLinkToken({
      token: parseStartToken(first.deepLink),
      telegramUserId: BigInt(303),
      telegramChatId: BigInt(303),
      telegramUsername: 'linked_once',
    });
    await assert.rejects(
      telegramLinkService.consumeLinkToken({
        token: parseStartToken(second.deepLink),
        telegramUserId: BigInt(303),
        telegramChatId: BigInt(303),
        telegramUsername: 'linked_twice',
      }),
      /already linked/i,
    );
    await prisma.companyMembership.deleteMany({ where: { userId: secondMember.id } });
    await prisma.user.delete({ where: { id: secondMember.id } });
  } finally {
    await destroyFixture(fixture);
  }
});

test('webhook route enforces secret validation and malformed payload handling', async () => {
  const missingSecret = await (TelegramWebhookRoute as any).POST(
    new Request('https://example.test/api/integrations/telegram/webhook', {
      method: 'POST',
      body: JSON.stringify({ update_id: 1 }),
      headers: { 'Content-Type': 'application/json' },
    }) as any,
  );
  assert.equal(missingSecret.status, 401);

  const malformed = await (TelegramWebhookRoute as any).POST(
    new Request('https://example.test/api/integrations/telegram/webhook', {
      method: 'POST',
      body: '{bad-json',
      headers: {
        'Content-Type': 'application/json',
        'x-telegram-bot-api-secret-token': 'telegram-webhook-secret',
      },
    }) as any,
  );
  assert.equal(malformed.status, 400);
});

test('duplicate inbound update ids are ignored and unlinked Telegram users cannot mutate tasks', async () => {
  const fixture = await createFixture();
  try {
    installFetchMock(async () => okTelegramResponse({ message_id: 1 }));
    await telegramWebhookService.handleUpdate({
      update_id: 5001,
      message: {
        message_id: 1,
        text: 'hello',
        from: { id: 401, username: 'unknown' },
        chat: { id: 401, type: 'private' },
      },
    });
    await telegramWebhookService.handleUpdate({
      update_id: 5001,
      message: {
        message_id: 1,
        text: 'hello',
        from: { id: 401, username: 'unknown' },
        chat: { id: 401, type: 'private' },
      },
    });
    assert.equal(
      await prisma.telegramInboundUpdate.count({ where: { telegramUpdateId: BigInt(5001) } }),
      1,
    );
    assert.equal(await prisma.taskComment.count({ where: { cardId: fixture.card.id } }), 0);
  } finally {
    global.fetch = originalFetch;
    await destroyFixture(fixture);
  }
});

test('assignment delivery is queued, Telegram failure does not rollback assignment, and duplicate assignment does not duplicate delivery', async () => {
  const fixture = await createFixture();
  try {
    const linked = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    });
    await telegramLinkService.consumeLinkToken({
      token: parseStartToken(linked.deepLink),
      telegramUserId: BigInt(402),
      telegramChatId: BigInt(402),
      telegramUsername: 'assignee',
    });
    await prisma.taskCard.update({
      where: { id: fixture.card.id },
      data: { assigneeUserId: null, assignedTo: null },
    });
    installFetchMock(async () =>
      new Response(
        JSON.stringify({ ok: false, description: 'temporary outage' }),
        { status: 500, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    const updated = await taskService.updateCard(
      { id: fixture.card.id, assigneeUserId: fixture.member.id },
      {
        userId: fixture.owner.id,
        displayName: fixture.owner.displayName,
        companyId: fixture.company.id,
        role: 'OWNER',
      },
    );
    assert.equal(updated.assigneeUserId, fixture.member.id);
    await telegramDeliveryService.drainDueDeliveries();
    assert.equal(
      await prisma.telegramDelivery.count({
        where: { taskCardId: fixture.card.id, type: 'ASSIGNMENT' },
      }),
      1,
    );
    const delivery = await prisma.telegramDelivery.findFirstOrThrow({
      where: { taskCardId: fixture.card.id, type: 'ASSIGNMENT' },
    });
    assert.equal(delivery.status, 'RETRYING');

    await taskService.updateCard(
      { id: fixture.card.id, title: 'Call Daimler Financial ASAP', assigneeUserId: fixture.member.id },
      {
        userId: fixture.owner.id,
        displayName: fixture.owner.displayName,
        companyId: fixture.company.id,
        role: 'OWNER',
      },
    );
    assert.equal(
      await prisma.telegramDelivery.count({
        where: { taskCardId: fixture.card.id, type: 'ASSIGNMENT' },
      }),
      1,
    );
  } finally {
    global.fetch = originalFetch;
    await destroyFixture(fixture);
  }
});

test('disabled Telegram stays fail closed while task assignment succeeds', async () => {
  const fixture = await createFixture();
  const previousEnabled = process.env.TELEGRAM_ENABLED;
  try {
    const invitation = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    });
    await telegramLinkService.consumeLinkToken({
      token: parseStartToken(invitation.deepLink),
      telegramUserId: BigInt(4021),
      telegramChatId: BigInt(4021),
      telegramUsername: 'disabled_target',
    });
    await prisma.taskCard.update({
      where: { id: fixture.card.id },
      data: { assigneeUserId: null },
    });
    process.env.TELEGRAM_ENABLED = 'false';
    installFetchMock(async () => {
      throw new Error('Telegram HTTP must not be called while disabled.');
    });

    await taskService.updateCard(
      { id: fixture.card.id, assigneeUserId: fixture.member.id },
      {
        userId: fixture.owner.id,
        displayName: fixture.owner.displayName,
        companyId: fixture.company.id,
        role: 'OWNER',
      },
    );
    const assigned = await prisma.taskCard.findUniqueOrThrow({
      where: { id: fixture.card.id },
    });
    assert.equal(assigned.assigneeUserId, fixture.member.id);
    assert.deepEqual(await telegramDeliveryService.drainDueDeliveries(), {
      processed: 0,
    });
    const summary = await telegramDeliveryService.getTaskTelegramSummary(
      fixture.card.id,
      fixture.company.id,
    );
    assert.equal(summary?.telegramAvailable, false);
    assert.equal(summary?.assigneeTelegramConnected, false);
    assert.equal(summary?.canRequestUpdate, false);
    await assert.rejects(
      telegramDeliveryService.createUpdateRequest({
        companyId: fixture.company.id,
        requestedByUserId: fixture.owner.id,
        requestedByRole: 'OWNER',
        requestedByDisplayName: fixture.owner.displayName,
        taskCardId: fixture.card.id,
      }),
      /integration is unavailable/i,
    );
  } finally {
    process.env.TELEGRAM_ENABLED = previousEnabled;
    global.fetch = originalFetch;
    await destroyFixture(fixture);
  }
});

test('Add Update creates a FleetPilot comment with Telegram provenance and duplicate/expired replies are denied', async () => {
  const fixture = await createFixture();
  try {
    const invitation = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    });
    await telegramLinkService.consumeLinkToken({
      token: parseStartToken(invitation.deepLink),
      telegramUserId: BigInt(403),
      telegramChatId: BigInt(403),
      telegramUsername: 'commenter',
    });
    installFetchMock(async () => okTelegramResponse({ message_id: 12 }));
    await telegramDeliveryService.createPendingTextAction({
      companyId: fixture.company.id,
      userId: fixture.member.id,
      taskCardId: fixture.card.id,
      telegramChatId: BigInt(403),
    });
    const pendingClaims = await Promise.all([
      telegramDeliveryService.consumePendingTextAction({
        companyId: fixture.company.id,
        userId: fixture.member.id,
        telegramChatId: BigInt(403),
      }),
      telegramDeliveryService.consumePendingTextAction({
        companyId: fixture.company.id,
        userId: fixture.member.id,
        telegramChatId: BigInt(403),
      }),
    ]);
    assert.equal(pendingClaims.filter(Boolean).length, 1);
    await telegramDeliveryService.createPendingTextAction({
      companyId: fixture.company.id,
      userId: fixture.member.id,
      taskCardId: fixture.card.id,
      telegramChatId: BigInt(403),
    });
    await telegramWebhookService.handleUpdate({
      update_id: 6001,
      message: {
        message_id: 10,
        text: 'Called them. Waiting for financing department.',
        from: { id: 403, username: 'commenter' },
        chat: { id: 403, type: 'private' },
      },
    });
    const comment = await prisma.taskComment.findFirstOrThrow({
      where: { cardId: fixture.card.id },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal(comment.authorUserId, fixture.member.id);
    const activity = await prisma.taskActivity.findFirstOrThrow({
      where: { cardId: fixture.card.id, action: 'COMMENT_ADDED' },
      orderBy: { occurredAt: 'desc' },
    });
    assert.equal(activity.sourceType, 'TELEGRAM');
    assert.match(String(activity.sourceId), /telegram-update:6001/);

    const before = await prisma.taskComment.count({ where: { cardId: fixture.card.id } });
    await telegramWebhookService.handleUpdate({
      update_id: 6002,
      message: {
        message_id: 11,
        text: 'Second reply should not attach.',
        from: { id: 403, username: 'commenter' },
        chat: { id: 403, type: 'private' },
      },
    });
    assert.equal(await prisma.taskComment.count({ where: { cardId: fixture.card.id } }), before);

    await telegramDeliveryService.createPendingTextAction({
      companyId: fixture.company.id,
      userId: fixture.member.id,
      taskCardId: fixture.card.id,
      telegramChatId: BigInt(403),
    });
    await prisma.telegramPendingAction.updateMany({
      where: { companyId: fixture.company.id, userId: fixture.member.id, consumedAt: null },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await telegramWebhookService.handleUpdate({
      update_id: 6003,
      message: {
        message_id: 12,
        text: 'Expired reply.',
        from: { id: 403, username: 'commenter' },
        chat: { id: 403, type: 'private' },
      },
    });
    assert.equal(await prisma.taskComment.count({ where: { cardId: fixture.card.id } }), before);
  } finally {
    global.fetch = originalFetch;
    await destroyFixture(fixture);
  }
});

test('wrong Telegram user, removed membership, and inactive user cannot use pending task updates', async () => {
  const fixture = await createFixture();
  try {
    const invitation = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    });
    await telegramLinkService.consumeLinkToken({
      token: parseStartToken(invitation.deepLink),
      telegramUserId: BigInt(404),
      telegramChatId: BigInt(404),
      telegramUsername: 'linked_member',
    });
    installFetchMock(async () => okTelegramResponse({ message_id: 13 }));
    await telegramDeliveryService.createPendingTextAction({
      companyId: fixture.company.id,
      userId: fixture.member.id,
      taskCardId: fixture.card.id,
      telegramChatId: BigInt(404),
    });
    await telegramWebhookService.handleUpdate({
      update_id: 6101,
      message: {
        message_id: 13,
        text: 'Wrong user',
        from: { id: 405, username: 'other' },
        chat: { id: 405, type: 'private' },
      },
    });
    assert.equal(await prisma.taskComment.count({ where: { cardId: fixture.card.id } }), 0);

    await prisma.companyMembership.deleteMany({
      where: { companyId: fixture.company.id, userId: fixture.member.id },
    });
    await telegramWebhookService.handleUpdate({
      update_id: 6102,
      message: {
        message_id: 14,
        text: 'Removed member',
        from: { id: 404, username: 'linked_member' },
        chat: { id: 404, type: 'private' },
      },
    });
    assert.equal(await prisma.taskComment.count({ where: { cardId: fixture.card.id } }), 0);

    await prisma.companyMembership.create({
      data: { companyId: fixture.company.id, userId: fixture.member.id, role: 'MEMBER' },
    });
    await prisma.user.update({ where: { id: fixture.member.id }, data: { isActive: false } });
    await telegramWebhookService.handleUpdate({
      update_id: 6103,
      message: {
        message_id: 15,
        text: 'Inactive user',
        from: { id: 404, username: 'linked_member' },
        chat: { id: 404, type: 'private' },
      },
    });
    assert.equal(await prisma.taskComment.count({ where: { cardId: fixture.card.id } }), 0);
  } finally {
    global.fetch = originalFetch;
    await destroyFixture(fixture);
  }
});

test('Start and Complete callbacks use centralized task transitions and duplicate callbacks are idempotent', async () => {
  const fixture = await createFixture();
  try {
    const invitation = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    });
    await telegramLinkService.consumeLinkToken({
      token: parseStartToken(invitation.deepLink),
      telegramUserId: BigInt(406),
      telegramChatId: BigInt(406),
      telegramUsername: 'starter',
    });
    installFetchMock(async (url) =>
      url.includes('answerCallbackQuery')
        ? okTelegramResponse(true)
        : okTelegramResponse({ message_id: 16 }),
    );
    const startData = createTelegramCallbackData('start', fixture.card.id);
    await telegramWebhookService.handleUpdate({
      update_id: 6201,
      callback_query: {
        id: 'cb-start-1',
        data: startData,
        from: { id: 406, username: 'starter' },
        message: { message_id: 20, chat: { id: 406, type: 'private' } },
      },
    });
    let card = await prisma.taskCard.findUniqueOrThrow({ where: { id: fixture.card.id } });
    assert.equal(card.status, 'IN_PROGRESS');
    assert.equal(card.boardId, fixture.inProgressBoard.id);
    const activityCount = await prisma.taskActivity.count({
      where: { cardId: fixture.card.id, action: 'STATUS_CHANGED' },
    });

    await telegramWebhookService.handleUpdate({
      update_id: 6202,
      callback_query: {
        id: 'cb-start-2',
        data: startData,
        from: { id: 406, username: 'starter' },
        message: { message_id: 21, chat: { id: 406, type: 'private' } },
      },
    });
    assert.equal(
      await prisma.taskActivity.count({
        where: { cardId: fixture.card.id, action: 'STATUS_CHANGED' },
      }),
      activityCount,
    );

    const completeData = createTelegramCallbackData('complete', fixture.card.id);
    await telegramWebhookService.handleUpdate({
      update_id: 6203,
      callback_query: {
        id: 'cb-complete',
        data: completeData,
        from: { id: 406, username: 'starter' },
        message: { message_id: 22, chat: { id: 406, type: 'private' } },
      },
    });
    card = await prisma.taskCard.findUniqueOrThrow({ where: { id: fixture.card.id } });
    assert.equal(card.status, 'DONE');
    assert.equal(card.boardId, fixture.doneBoard.id);
  } finally {
    global.fetch = originalFetch;
    await destroyFixture(fixture);
  }
});

test('foreign-company task callbacks are denied for linked users', async () => {
  const fixture = await createFixture();
  try {
    const invitation = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    });
    await telegramLinkService.consumeLinkToken({
      token: parseStartToken(invitation.deepLink),
      telegramUserId: BigInt(407),
      telegramChatId: BigInt(407),
      telegramUsername: 'safe_member',
    });
    installFetchMock(async (url) =>
      url.includes('answerCallbackQuery')
        ? okTelegramResponse(true)
        : okTelegramResponse({ message_id: 17 }),
    );
    await assert.rejects(
      telegramWebhookService.handleUpdate({
        update_id: 6301,
        callback_query: {
          id: 'cb-foreign',
          data: createTelegramCallbackData('start', fixture.foreignCard.id),
          from: { id: 407, username: 'safe_member' },
          message: { message_id: 25, chat: { id: 407, type: 'private' } },
        },
      }),
    );
    const foreignCard = await prisma.taskCard.findUniqueOrThrow({ where: { id: fixture.foreignCard.id } });
    assert.equal(foreignCard.status, 'TODO');

    await prisma.taskCard.update({
      where: { id: fixture.card.id },
      data: { assigneeUserId: fixture.owner.id },
    });
    await assert.rejects(
      telegramWebhookService.handleUpdate({
        update_id: 6302,
        callback_query: {
          id: 'cb-unassigned',
          data: createTelegramCallbackData('start', fixture.card.id),
          from: { id: 407, username: 'safe_member' },
          message: { message_id: 26, chat: { id: 407, type: 'private' } },
        },
      }),
    );
    const unassignedCard = await prisma.taskCard.findUniqueOrThrow({
      where: { id: fixture.card.id },
    });
    assert.equal(unassignedCard.status, 'TODO');
  } finally {
    global.fetch = originalFetch;
    await destroyFixture(fixture);
  }
});

test('archiving invalidates Telegram actions and stale callbacks fail closed without resurrecting history', async () => {
  const fixture = await createFixture();
  try {
    const invitation = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    });
    await telegramLinkService.consumeLinkToken({
      token: parseStartToken(invitation.deepLink),
      telegramUserId: BigInt(499),
      telegramChatId: BigInt(499),
      telegramUsername: 'archived_task_user',
    });
    installFetchMock(async (url) =>
      url.includes('answerCallbackQuery')
        ? okTelegramResponse(true)
        : okTelegramResponse({ message_id: 99 }),
    );
    const request = await telegramDeliveryService.createUpdateRequest({
      companyId: fixture.company.id,
      requestedByUserId: fixture.owner.id,
      requestedByRole: 'OWNER',
      requestedByDisplayName: fixture.owner.displayName,
      taskCardId: fixture.card.id,
    });
    await taskService.setCardArchived(fixture.card.id, true, {
      userId: fixture.owner.id,
      displayName: fixture.owner.displayName,
      companyId: fixture.company.id,
      role: 'OWNER',
    });
    assert.equal((await prisma.telegramUpdateRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'CANCELLED');
    assert.ok((await prisma.telegramPendingAction.findFirstOrThrow({ where: { telegramUpdateRequestId: request.id } })).invalidatedAt);

    await assert.rejects(
      telegramWebhookService.handleUpdate({
        update_id: 6991,
        callback_query: {
          id: 'archived-start',
          data: createTelegramCallbackData('start', fixture.card.id),
          from: { id: 499, username: 'archived_task_user' },
          message: { message_id: 99, chat: { id: 499, type: 'private' } },
        },
      }),
    );
    await telegramWebhookService.handleUpdate({
      update_id: 6992,
      callback_query: {
        id: 'archived-update',
        data: createTelegramCallbackData('update', fixture.card.id),
        from: { id: 499, username: 'archived_task_user' },
        message: { message_id: 100, chat: { id: 499, type: 'private' } },
      },
    });
    assert.equal(await prisma.telegramPendingAction.count({ where: { taskCardId: fixture.card.id, invalidatedAt: null, consumedAt: null } }), 0);

    await taskService.setCardArchived(fixture.card.id, false, {
      userId: fixture.owner.id,
      displayName: fixture.owner.displayName,
      companyId: fixture.company.id,
      role: 'OWNER',
    });
    assert.equal((await prisma.telegramUpdateRequest.findUniqueOrThrow({ where: { id: request.id } })).status, 'CANCELLED');
    assert.ok((await prisma.telegramPendingAction.findFirstOrThrow({ where: { telegramUpdateRequestId: request.id } })).invalidatedAt);
    const replacement = await telegramDeliveryService.createUpdateRequest({
      companyId: fixture.company.id,
      requestedByUserId: fixture.owner.id,
      requestedByRole: 'OWNER',
      requestedByDisplayName: fixture.owner.displayName,
      taskCardId: fixture.card.id,
    });
    assert.equal(replacement.status, 'PENDING');
  } finally {
    global.fetch = originalFetch;
    await destroyFixture(fixture);
  }
});

test('request update creates queue state, links responseCommentId/respondedAt, and disconnect invalidates future Telegram mutations', async () => {
  const fixture = await createFixture();
  try {
    const invitation = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    });
    await telegramLinkService.consumeLinkToken({
      token: parseStartToken(invitation.deepLink),
      telegramUserId: BigInt(408),
      telegramChatId: BigInt(408),
      telegramUsername: 'request_target',
    });
    installFetchMock(async (url) =>
      url.includes('answerCallbackQuery')
        ? okTelegramResponse(true)
        : okTelegramResponse({ message_id: 18 }),
    );
    const request = await telegramDeliveryService.createUpdateRequest({
      companyId: fixture.company.id,
      requestedByUserId: fixture.owner.id,
      requestedByRole: 'OWNER',
      requestedByDisplayName: fixture.owner.displayName,
      taskCardId: fixture.card.id,
    });
    assert.equal(request.status, 'PENDING');
    assert.equal(
      await prisma.telegramDelivery.count({
        where: { taskCardId: fixture.card.id, type: 'UPDATE_REQUEST' },
      }),
      1,
    );
    assert.equal(
      await prisma.telegramPendingAction.count({
        where: {
          telegramUpdateRequestId: request.id,
          type: 'ADD_UPDATE',
          invalidatedAt: null,
        },
      }),
      1,
    );
    await assert.rejects(
      telegramDeliveryService.createUpdateRequest({
        companyId: fixture.company.id,
        requestedByUserId: fixture.owner.id,
        requestedByRole: 'OWNER',
        requestedByDisplayName: fixture.owner.displayName,
        taskCardId: fixture.card.id,
      }),
      /already requested recently/i,
    );

    await telegramWebhookService.handleUpdate({
      update_id: 6401,
      message: {
        message_id: 30,
        text: 'Current status: waiting on finance.',
        from: { id: 408, username: 'request_target' },
        chat: { id: 408, type: 'private' },
      },
    });
    const refreshed = await prisma.telegramUpdateRequest.findUniqueOrThrow({
      where: { id: request.id },
    });
    assert.equal(refreshed.status, 'RESPONDED');
    assert.ok(refreshed.respondedAt);
    assert.ok(refreshed.responseCommentId);

    await telegramLinkService.disconnectLink({
      actorUserId: fixture.member.id,
      actorRole: 'MEMBER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    });
    await telegramDeliveryService.createPendingTextAction({
      companyId: fixture.company.id,
      userId: fixture.member.id,
      taskCardId: fixture.card.id,
      telegramChatId: BigInt(408),
    });
    await telegramWebhookService.handleUpdate({
      update_id: 6402,
      message: {
        message_id: 31,
        text: 'Should be denied after disconnect.',
        from: { id: 408, username: 'request_target' },
        chat: { id: 408, type: 'private' },
      },
    });
    const count = await prisma.taskComment.count({ where: { cardId: fixture.card.id } });
    assert.equal(count, 1);
  } finally {
    global.fetch = originalFetch;
    await destroyFixture(fixture);
  }
});

test('commands /help, /tasks, and /due send deterministic responses for the linked company only', async () => {
  const fixture = await createFixture();
  try {
    const invitation = await telegramLinkService.createLinkInvitation({
      actorUserId: fixture.owner.id,
      actorRole: 'OWNER',
      companyId: fixture.company.id,
      userId: fixture.member.id,
    });
    await telegramLinkService.consumeLinkToken({
      token: parseStartToken(invitation.deepLink),
      telegramUserId: BigInt(409),
      telegramChatId: BigInt(409),
      telegramUsername: 'commands_user',
    });
    const calls = installFetchMock(async (url) =>
      url.includes('answerCallbackQuery')
        ? okTelegramResponse(true)
        : okTelegramResponse({ message_id: 19 }),
    );
    await telegramWebhookService.handleUpdate({
      update_id: 6501,
      message: {
        message_id: 40,
        text: '/help',
        from: { id: 409, username: 'commands_user' },
        chat: { id: 409, type: 'private' },
      },
    });
    await telegramWebhookService.handleUpdate({
      update_id: 6502,
      message: {
        message_id: 41,
        text: '/tasks',
        from: { id: 409, username: 'commands_user' },
        chat: { id: 409, type: 'private' },
      },
    });
    await telegramWebhookService.handleUpdate({
      update_id: 6503,
      message: {
        message_id: 42,
        text: '/due',
        from: { id: 409, username: 'commands_user' },
        chat: { id: 409, type: 'private' },
      },
    });
    assert.equal(calls.filter(({ url }) => url.includes('/sendMessage')).length >= 3, true);
  } finally {
    global.fetch = originalFetch;
    await destroyFixture(fixture);
  }
});
