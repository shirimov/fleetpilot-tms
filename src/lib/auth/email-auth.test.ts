import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { prisma } from '@/lib/prisma';
import { EmailAuthService, type EmailDelivery } from './email-auth';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const userIds: string[] = [];
const companyIds: string[] = [];
const delivered: Array<{ email: string; magicLink: string }> = [];
const delivery: EmailDelivery = async ({ email, magicLink }) => {
  delivered.push({ email, magicLink });
};
const service = new EmailAuthService(prisma, delivery);

function rawToken(index = delivered.length - 1) {
  return new URLSearchParams(
    new URL(delivered[index].magicLink).hash.slice(1),
  ).get('token') ?? '';
}

async function provision(label: string, options?: { active?: boolean; membership?: boolean }) {
  const company = await prisma.company.create({ data: { name: `${label}-${suffix}` } });
  companyIds.push(company.id);
  const user = await prisma.user.create({
    data: {
      email: `${label}-${suffix}@example.test`,
      displayName: label,
      isActive: options?.active ?? true,
    },
  });
  userIds.push(user.id);
  if (options?.membership !== false) {
    await prisma.companyMembership.create({
      data: { userId: user.id, companyId: company.id, role: 'MEMBER' },
    });
  }
  return user;
}

before(() => {
  process.env.AUTH_SECRET = 'fleetpilot-email-auth-test-secret';
  process.env.AUTH_URL = 'https://alpha.example.test';
  process.env.EMAIL_AUTH_ENABLED = 'true';
});

after(async () => {
  await prisma.emailSignInRequest.deleteMany({
    where: { OR: [{ emailHash: { not: '' } }, { ipHash: { not: '' } }] },
  });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
  await prisma.$disconnect();
});

test('authorized normalized email creates a secure token and reuses the user once', async () => {
  const user = await provision('authorized');
  const beforeDelivery = delivered.length;
  await service.request(`  ${user.email.toUpperCase()} `, '192.0.2.1');
  assert.equal(delivered.length, beforeDelivery + 1);
  assert.equal(delivered.at(-1)?.email, user.email);

  const token = rawToken();
  assert.ok(token.length >= 43);
  assert.equal(await prisma.emailSignInToken.count({ where: { userId: user.id } }), 1);
  const authenticated = await service.consume(token);
  assert.equal(authenticated?.id, user.id);
  assert.equal(await service.consume(token), null);
  assert.equal(await prisma.user.count({ where: { email: user.email } }), 1);
  assert.equal(
    await prisma.authAccount.count({
      where: { userId: user.id, provider: 'email-magic-link' },
    }),
    1,
  );
});

test('unknown, inactive, membership-free, and duplicate normalized emails do not send', async () => {
  const start = delivered.length;
  await service.request(`unknown-${suffix}@example.test`, '192.0.2.2');
  const inactive = await provision('inactive', { active: false });
  await service.request(inactive.email, '192.0.2.3');
  const noMembership = await provision('no-membership', { membership: false });
  await service.request(noMembership.email, '192.0.2.4');

  const duplicateCompany = await prisma.company.create({ data: { name: `duplicate-${suffix}` } });
  companyIds.push(duplicateCompany.id);
  const lowerEmail = `duplicate-${suffix}@example.test`;
  const duplicateUsers = await Promise.all([
    prisma.user.create({ data: { email: lowerEmail, displayName: 'Duplicate one' } }),
    prisma.user.create({ data: { email: lowerEmail.toUpperCase(), displayName: 'Duplicate two' } }),
  ]);
  userIds.push(...duplicateUsers.map(({ id }) => id));
  await prisma.companyMembership.createMany({
    data: duplicateUsers.map(({ id }) => ({ userId: id, companyId: duplicateCompany.id, role: 'MEMBER' as const })),
  });
  await service.request(lowerEmail, '192.0.2.5');
  assert.equal(delivered.length, start);
});

test('expired and wrong tokens cannot authenticate or create accounts', async () => {
  const user = await provision('expired');
  const issuedAt = new Date('2026-08-22T10:00:00.000Z');
  await service.request(user.email, '192.0.2.6', issuedAt);
  const token = rawToken();
  assert.equal(await service.consume('wrong-token', issuedAt), null);
  assert.equal(
    await service.consume(token, new Date('2026-08-22T10:16:00.000Z')),
    null,
  );
  assert.equal(await prisma.authAccount.count({ where: { userId: user.id } }), 0);
});

test('rate limits repeated requests without revealing account state', async () => {
  const user = await provision('rate-limited');
  const start = delivered.length;
  for (let request = 0; request < 7; request += 1) {
    await service.request(user.email, '192.0.2.7');
  }
  assert.ok(delivered.length - start <= 5);
});
