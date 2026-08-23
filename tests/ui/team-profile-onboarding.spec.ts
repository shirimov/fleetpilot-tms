import { createHash, randomBytes } from 'node:crypto';
import { expect, test } from 'playwright/test';
import { prisma } from '@/lib/prisma';

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

async function issueToken(userId: string, email: string) {
  const token = randomBytes(32).toString('base64url');
  await prisma.emailSignInToken.create({
    data: {
      userId,
      email,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    },
  });
  return token;
}

test('OWNER onboards an existing Team User and MEMBER My Profile resolves', async ({
  page,
}) => {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const company = await prisma.company.create({
    data: { name: `Team profile UI ${suffix}` },
  });
  const [owner, member] = await Promise.all([
    prisma.user.create({
      data: {
        email: `team-profile-owner-${suffix}@example.test`,
        displayName: 'Profile Owner',
        activeCompanyId: company.id,
        memberships: { create: { companyId: company.id, role: 'OWNER' } },
      },
    }),
    prisma.user.create({
      data: {
        email: `team-profile-member-${suffix}@example.test`,
        displayName: 'Maya Member',
        activeCompanyId: company.id,
        memberships: { create: { companyId: company.id, role: 'MEMBER' } },
      },
    }),
  ]);

  try {
    await page.goto(`/login/email/verify#token=${await issueToken(owner.id, owner.email)}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');
    await page.goto('/administration');

    const memberRow = page
      .getByRole('cell', { name: member.email })
      .locator('xpath=ancestor::tr');
    await expect(memberRow.getByText('Not created')).toBeVisible();
    await memberRow.getByRole('button', { name: 'Create Employee Profile' }).click();

    const dialog = page.getByRole('dialog', { name: 'Create Employee Profile' });
    await expect(dialog.getByLabel('First name')).toHaveValue('Maya');
    await expect(dialog.getByLabel('Last name')).toHaveValue('Member');
    await expect(dialog.getByText(`Account email: ${member.email}`)).toBeVisible();
    await dialog.getByLabel('Job title').fill('Dispatcher');
    await dialog.getByLabel('Department').fill('Operations');
    await dialog.getByLabel('Salary / rate').fill('65000');
    await dialog.getByRole('button', { name: 'Create and Link Profile' }).click();

    await expect(dialog).toBeHidden();
    await expect(memberRow.getByText('Linked')).toBeVisible();
    const viewProfile = memberRow.getByRole('link', { name: 'View Profile' });
    await expect(viewProfile).toBeVisible();

    const teamResponse = await page.request.get('/api/company/team');
    expect(teamResponse.ok()).toBe(true);
    const teamBody = await teamResponse.json();
    const teamMember = teamBody.members.find(
      (candidate: { user: { id: string } }) => candidate.user.id === member.id,
    );
    expect(teamMember.employee).toMatchObject({
      jobTitle: 'Dispatcher',
      department: 'Operations',
    });
    expect('salary' in teamMember.employee).toBe(false);
    expect('compensationNotes' in teamMember.employee).toBe(false);

    await viewProfile.click();
    await expect(page).toHaveURL(/\/hr\/employees\//);
    await expect(page.getByRole('heading', { name: 'Maya Member' })).toBeVisible();

    await page.getByRole('button', { name: 'Open profile menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/login');

    await page.goto(`/login/email/verify#token=${await issueToken(member.id, member.email)}`);
    await expect.poll(() => new URL(page.url()).pathname).toBe('/tasks');
    await page.getByRole('link', { name: 'My Profile' }).click();
    await expect(page).toHaveURL('/profile');
    await expect(page.getByRole('heading', { name: 'Maya Member' })).toBeVisible();
    await expect(page.getByText('Your employee profile has not been linked yet.')).toHaveCount(0);

    const denied = await page.request.post(
      `/api/company/team/${owner.id}/employee-profile`,
      { data: { firstName: 'Denied', lastName: 'Member' } },
    );
    expect(denied.status()).toBe(403);
  } finally {
    await prisma.employee.deleteMany({ where: { companyId: company.id } });
    await prisma.user.deleteMany({ where: { id: { in: [owner.id, member.id] } } });
    await prisma.company.delete({ where: { id: company.id } });
  }
});
