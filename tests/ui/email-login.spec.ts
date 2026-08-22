import { expect, test } from 'playwright/test';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '@/lib/prisma';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

test('login offers GitHub and accessible employee email sign in with generic success', async ({ page }) => {
  await page.route('**/api/auth/email/request', (route) =>
    route.fulfill({
      status: 202,
      json: { message: 'If this email is authorized, a sign-in link has been sent.' },
    }),
  );
  await page.goto('/login');
  await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Continue with Email' })).toBeVisible();
  await page.getByLabel('Work email').fill('member@example.test');
  await page.getByRole('button', { name: 'Continue with Email' }).click();
  await expect(page.getByText('If this email is authorized, a sign-in link has been sent.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Resend sign-in link' })).toBeVisible();
});

test('invalid or expired magic link has a safe recovery path', async ({ page }) => {
  await page.goto('/login/email/verify');
  await expect(page.getByRole('heading', { name: 'This sign-in link is invalid or expired' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Return to sign in' })).toHaveAttribute('href', '/login');
});

test('email login remains usable on a mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login');
  await expect(page.getByLabel('Work email')).toBeInViewport();
  await expect(page.getByRole('button', { name: 'Continue with Email' })).toBeInViewport();
});

test('verified MEMBER gets a real Auth.js session, lands on tasks, and can logout and re-login', async ({ page }) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const company = await prisma.company.create({ data: { name: `Email UI ${suffix}` } });
  const user = await prisma.user.create({
    data: {
      email: `email-ui-${suffix}@example.test`,
      displayName: 'Email Test Member',
      memberships: { create: { companyId: company.id, role: 'MEMBER' } },
    },
  });

  async function issueToken() {
    const token = randomBytes(32).toString('base64url');
    await prisma.emailSignInToken.create({
      data: {
        userId: user.id,
        email: user.email,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 15 * 60 * 1000),
      },
    });
    return token;
  }

  try {
    await page.goto(`/login/email/verify#token=${await issueToken()}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');
    await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login');

    await page.goto(`/login/email/verify#token=${await issueToken()}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');
  } finally {
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
});
