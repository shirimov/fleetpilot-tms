import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import {
  AccountLinkingService,
  OAuthAccountLinkError,
  normalizeEmail,
  selectVerifiedPrimaryGitHubEmail,
} from './account-linking';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const userIds: string[] = [];
const linkingService = new AccountLinkingService(prisma);

after(async () => {
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.$disconnect();
});

test('requires the verified primary GitHub email', () => {
  assert.equal(
    selectVerifiedPrimaryGitHubEmail([
      { email: 'unverified@example.test', primary: true, verified: false },
      { email: 'verified@example.test', primary: false, verified: true },
    ]),
    null,
  );
  assert.equal(
    selectVerifiedPrimaryGitHubEmail([
      { email: ' OWNER@Example.Test ', primary: true, verified: true },
    ]),
    'owner@example.test',
  );
});

test('links a stable provider account without creating duplicate users', async () => {
  const identity = {
    provider: 'github',
    providerAccountId: `github-account-${suffix}`,
    email: `OWNER-${suffix}@Example.Test`,
    displayName: 'Fleet owner',
  };
  const first = await linkingService.link(identity);
  userIds.push(first.id);
  const second = await linkingService.link({
    ...identity,
    email: `changed-${suffix}@example.test`,
  });

  assert.equal(second.id, first.id);
  assert.equal(
    await prisma.user.count({
      where: { email: normalizeEmail(identity.email) },
    }),
    1,
  );
  assert.equal(
    await prisma.authAccount.count({ where: { userId: first.id } }),
    1,
  );
});

test('refuses automatic email linking to an already-linked user', async () => {
  const email = `protected-${suffix}@example.test`;
  const existing = await linkingService.link({
    provider: 'github',
    providerAccountId: `first-account-${suffix}`,
    email,
    displayName: 'Protected owner',
  });
  userIds.push(existing.id);

  await assert.rejects(
    linkingService.link({
      provider: 'github',
      providerAccountId: `second-account-${suffix}`,
      email,
      displayName: 'Replacement account',
    }),
    OAuthAccountLinkError,
  );
  assert.equal(
    await prisma.authAccount.count({ where: { userId: existing.id } }),
    1,
  );
});

test('links a pre-provisioned user only when no provider account exists', async () => {
  const email = `invited-${suffix}@example.test`;
  const invited = await prisma.user.create({
    data: { email, displayName: 'Invited member' },
  });
  userIds.push(invited.id);

  const linked = await linkingService.link({
    provider: 'github',
    providerAccountId: `invited-account-${suffix}`,
    email,
    displayName: 'Provider display name',
  });
  assert.equal(linked.id, invited.id);
});
