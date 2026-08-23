import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from 'playwright/test';
import { prisma } from '@/lib/prisma';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

test('signed-in MEMBER without an employee link opens the safe My Profile state', async ({
  page,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const company = await prisma.company.create({
    data: { name: `Profile UI ${suffix}` },
  });
  const user = await prisma.user.create({
    data: {
      email: `profile-ui-${suffix}@example.test`,
      displayName: 'Unlinked Profile Member',
      memberships: { create: { companyId: company.id, role: 'MEMBER' } },
    },
  });
  const token = randomBytes(32).toString('base64url');
  await prisma.emailSignInToken.create({
    data: {
      userId: user.id,
      email: user.email,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });

  try {
    await page.goto(`/login/email/verify#token=${token}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');

    await page
      .getByRole('navigation', { name: 'Primary navigation' })
      .getByRole('link', { name: 'My Profile' })
      .click();

    await expect(page).toHaveURL('/profile');
    await expect(page.getByRole('heading', { name: 'My Profile' })).toBeVisible();
    await expect(
      page.getByText('Your employee profile has not been linked yet.'),
    ).toBeVisible();
    await expect(page.getByRole('link', { name: 'HR' })).toHaveCount(0);
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
});
