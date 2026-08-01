import 'dotenv/config';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { safeMarkdownUrl } from '@/components/tasks/MarkdownContent';
import {
  extractMentionUserIds,
  isCurrentDescriptionSave,
} from '@/components/tasks/TaskDescriptionEditor';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { prisma } from '@/lib/prisma';
import {
  FilesystemPrivateFileStorage,
  privateDownloadHeaders,
} from '@/lib/storage/private-file-storage';
import {
  MAX_TASK_ATTACHMENT_BYTES,
  sanitizeTaskFilename,
  validateTaskFile,
} from './task-file-policy';
import { TaskMoveConflictError, TaskNotFoundError } from './task-errors';
import { TaskService } from './task-service';
import type { TaskAttachmentStorage } from './task-storage';
import type { TaskCompanyActor } from './task-types';

class MemoryStorage implements TaskAttachmentStorage {
  files = new Map<string, Uint8Array>();
  sequence = 0;
  async put(bytes: Uint8Array) {
    const key = `00000000-0000-4000-8000-${String(++this.sequence).padStart(12, '0')}`;
    this.files.set(key, bytes);
    return key;
  }
  async get(key: string) {
    const value = this.files.get(key);
    if (!value) throw new Error('missing');
    return value;
  }
  async delete(key: string) {
    this.files.delete(key);
  }
}

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const storage = new MemoryStorage();
const service = new TaskService(prisma, undefined, storage);
let companyId = '';
let foreignCompanyId = '';
let userId = '';
let teammateId = '';
let foreignUserId = '';
let inactiveUserId = '';
let cardId = '';
let foreignCardId = '';
let actor: TaskCompanyActor;
let teammateActor: TaskCompanyActor;

before(async () => {
  const [company, foreignCompany] = await Promise.all([
    prisma.company.create({ data: { name: `Rich content ${suffix}` } }),
    prisma.company.create({ data: { name: `Foreign rich content ${suffix}` } }),
  ]);
  companyId = company.id;
  foreignCompanyId = foreignCompany.id;
  const [user, teammate, foreignUser, inactiveUser] = await Promise.all([
    prisma.user.create({ data: { email: `rich-${suffix}@test.dev`, displayName: 'Rich author' } }),
    prisma.user.create({ data: { email: `mention-${suffix}@test.dev`, displayName: 'Mention teammate' } }),
    prisma.user.create({ data: { email: `foreign-rich-${suffix}@test.dev`, displayName: 'Foreign user' } }),
    prisma.user.create({ data: { email: `inactive-rich-${suffix}@test.dev`, displayName: 'Inactive teammate', isActive: false } }),
  ]);
  userId = user.id;
  teammateId = teammate.id;
  foreignUserId = foreignUser.id;
  inactiveUserId = inactiveUser.id;
  await prisma.companyMembership.createMany({
    data: [
      { companyId, userId, role: 'MEMBER' },
      { companyId, userId: teammateId, role: 'MEMBER' },
      { companyId: foreignCompanyId, userId: foreignUserId, role: 'OWNER' },
      { companyId, userId: inactiveUserId, role: 'MEMBER' },
    ],
  });
  actor = { userId, companyId, displayName: user.displayName, role: 'MEMBER' };
  teammateActor = {
    userId: teammateId,
    companyId,
    displayName: teammate.displayName,
    role: 'MEMBER',
  };
  const [project, foreignProject] = await Promise.all([
    service.createProject({ name: `Rich project ${suffix}`, companyId }),
    service.createProject({ name: `Foreign rich project ${suffix}`, companyId: foreignCompanyId }),
  ]);
  cardId = (await service.createCard({
    projectId: project.id,
    boardId: project.boards[0].id,
    title: 'Rich task',
  })).id;
  foreignCardId = (await service.createCard({
    projectId: foreignProject.id,
    boardId: foreignProject.boards[0].id,
    title: 'Foreign task',
  })).id;
});

after(async () => {
  await prisma.taskActivity.deleteMany({
    where: { project: { companyId: { in: [companyId, foreignCompanyId] } } },
  });
  await prisma.taskProject.deleteMany({
    where: { companyId: { in: [companyId, foreignCompanyId] } },
  });
  await prisma.user.deleteMany({
    where: { id: { in: [userId, teammateId, foreignUserId, inactiveUserId] } },
  });
  await prisma.company.deleteMany({
    where: { id: { in: [companyId, foreignCompanyId] } },
  });
  await prisma.$disconnect();
});

test('Markdown URLs and mention parsing fail safe', () => {
  assert.equal(safeMarkdownUrl('javascript:alert(1)'), '#');
  assert.equal(safeMarkdownUrl('https://fleetpilot.example/task'), 'https://fleetpilot.example/task');
  assert.equal(safeMarkdownUrl(`user:${teammateId}`), `user:${teammateId}`);
  assert.deepEqual(
    extractMentionUserIds(
      `@[Mention teammate](user:${teammateId}) and again @[Mention teammate](user:${teammateId})`,
    ),
    [teammateId],
  );
});

test('description autosave ignores responses for a different card or request generation', () => {
  assert.equal(isCurrentDescriptionSave('card-1', 'card-1', 2, 2), true);
  assert.equal(isCurrentDescriptionSave('card-1', 'card-2', 2, 2), false);
  assert.equal(isCurrentDescriptionSave('card-1', 'card-1', 1, 2), false);
});

test('private storage isolates namespaces, writes atomically, and rejects path selectors', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'fleetpilot-private-storage-'));
  try {
    const tasks = new FilesystemPrivateFileStorage('task-attachments', root);
    const dispatch = new FilesystemPrivateFileStorage('dispatch-documents', root);
    const bytes = new Uint8Array([1, 2, 3]);
    const taskKey = await tasks.put(bytes);
    const dispatchKey = await dispatch.put(bytes);

    assert.deepEqual([...await tasks.get(taskKey)], [...bytes]);
    assert.deepEqual([...await dispatch.get(dispatchKey)], [...bytes]);
    assert.deepEqual(await readdir(path.join(root, 'task-attachments')), [taskKey]);
    assert.deepEqual(await readdir(path.join(root, 'dispatch-documents')), [dispatchKey]);
    await assert.rejects(tasks.get('../dispatch-documents/secret'), /key is invalid/);
    await tasks.delete(taskKey);
    await tasks.delete(taskKey);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('private download headers prevent caching, sniffing, and filename injection', () => {
  const headers = privateDownloadHeaders('invoice"\r\nX-Evil: yes.pdf', 'application/pdf');
  assert.equal(headers['Cache-Control'], 'private, no-store');
  assert.equal(headers['X-Content-Type-Options'], 'nosniff');
  assert.doesNotMatch(headers['Content-Disposition'], /[\r\n]/);
  assert.match(headers['Content-Disposition'], /^attachment;/);
});

test('upload validation rejects traversal, active content, mismatch, and oversize', () => {
  assert.throws(() => sanitizeTaskFilename('../invoice.pdf'), /filename/i);
  assert.throws(() => sanitizeTaskFilename('invoice.pdf.exe'), /active-content/i);
  assert.throws(
    () => validateTaskFile(
      new File([new Uint8Array([1])], 'invoice.pdf', { type: 'application/pdf' }),
      new Uint8Array([1]),
    ),
    /content/i,
  );
  assert.equal(MAX_TASK_ATTACHMENT_BYTES, 20 * 1024 * 1024);
});

test('description writes are stale-safe, deduplicated, and company-verified', async () => {
  const before = await prisma.taskCard.findUniqueOrThrow({ where: { id: cardId } });
  await service.updateCard(
    {
      id: cardId,
      description: `# Dispatch\n@[Mention teammate](user:${teammateId})`,
      mentionUserIds: [teammateId, teammateId],
      expectedUpdatedAt: before.updatedAt,
    },
    actor,
  );
  await service.updateCard(
    {
      id: cardId,
      description: `# Dispatch\n@[Mention teammate](user:${teammateId})`,
      mentionUserIds: [teammateId],
      expectedUpdatedAt: before.updatedAt,
    },
    actor,
  );
  assert.equal(
    await prisma.taskActivity.count({
      where: { entityId: cardId, action: 'DESCRIPTION_CHANGED' },
    }),
    1,
  );
  await assert.rejects(
    service.updateCard(
      {
        id: cardId,
        description: 'stale',
        expectedUpdatedAt: before.updatedAt,
      },
      actor,
    ),
    TaskMoveConflictError,
  );
  await assert.rejects(
    service.updateCard(
      { id: cardId, description: 'forged', mentionUserIds: [foreignUserId] },
      actor,
    ),
    /active member/,
  );
  assert.equal(
    await prisma.taskMention.count({
      where: { cardId, mentionedUserId: teammateId, resolvedAt: null },
    }),
    1,
  );
  assert.equal(
    await prisma.taskActivity.count({
      where: { entityId: cardId, action: 'MENTION_ADDED' },
    }),
    1,
  );
});

test('verified assignees are active company members and changes are attributable', async () => {
  assert.deepEqual(
    (await service.getAssigneeCandidates(companyId)).map(({ id }) => id).sort(),
    [teammateId, userId].sort(),
  );
  const before = await prisma.taskCard.findUniqueOrThrow({ where: { id: cardId } });
  const assigned = await service.updateCard(
    { id: cardId, assigneeUserId: teammateId, expectedUpdatedAt: before.updatedAt },
    actor,
  );
  assert.equal(assigned.assigneeUserId, teammateId);
  assert.equal(assigned.assigneeUser?.displayName, 'Mention teammate');
  await assert.rejects(
    service.updateCard({ id: cardId, assigneeUserId: foreignUserId }, actor),
    /active member/,
  );
  await assert.rejects(
    service.updateCard({ id: cardId, assigneeUserId: inactiveUserId }, actor),
    /active member/,
  );
  await service.updateCard({ id: cardId, assigneeUserId: null }, actor);
  assert.equal(
    await prisma.taskActivity.count({ where: { entityId: cardId, action: 'ASSIGNEE_CHANGED' } }),
    2,
  );
});

test('attachments are private, tenant-scoped, attributable, and permission checked', async () => {
  const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
  const attachment = await service.createAttachment(
    cardId,
    {
      originalFilename: 'rate-confirmation.pdf',
      displayFilename: 'rate-confirmation.pdf',
      mimeType: 'application/pdf',
      byteSize: bytes.length,
    },
    bytes,
    actor,
  );
  assert.equal('storageKey' in attachment, false);
  assert.equal((await service.getAttachmentDownload(cardId, attachment.id, actor)).bytes.length, bytes.length);
  await assert.rejects(
    service.getAttachmentDownload(foreignCardId, attachment.id, actor),
    TaskNotFoundError,
  );
  await assert.rejects(
    service.deleteAttachment(cardId, attachment.id, teammateActor),
    AuthorizationDeniedError,
  );
  await service.deleteAttachment(cardId, attachment.id, actor);
  assert.equal(storage.files.size, 0);
  assert.equal(
    await prisma.taskActivity.count({
      where: {
        entityId: cardId,
        action: { in: ['ATTACHMENT_ADDED', 'ATTACHMENT_REMOVED'] },
      },
    }),
    2,
  );
});

test('mention autocomplete is active-company scoped', async () => {
  assert.deepEqual(
    (await service.getMentionCandidates(companyId, 'Mention')).map(({ id }) => id),
    [teammateId],
  );
  await prisma.user.update({ where: { id: teammateId }, data: { isActive: false } });
  assert.deepEqual(await service.getMentionCandidates(companyId, 'Mention'), []);
  await prisma.user.update({ where: { id: teammateId }, data: { isActive: true } });
});
