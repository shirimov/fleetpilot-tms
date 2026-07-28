import 'dotenv/config';
import { Prisma } from '@prisma/client';
import { normalizeEmail } from '@/lib/auth/account-linking';
import { prisma } from '@/lib/prisma';

const email = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL ?? '');
const displayName = process.env.BOOTSTRAP_ADMIN_NAME?.trim();
const companyName = process.env.BOOTSTRAP_COMPANY_NAME?.trim();

if (process.env.BOOTSTRAP_CONFIRM !== 'bootstrap-fleetpilot-staging') {
  throw new Error(
    'Set BOOTSTRAP_CONFIRM=bootstrap-fleetpilot-staging for the one-time bootstrap.',
  );
}
if (!email || !displayName || !companyName) {
  throw new Error(
    'BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_NAME, and BOOTSTRAP_COMPANY_NAME are required.',
  );
}

const result = await prisma.$transaction(
  async (transaction) => {
    const user = await transaction.user.upsert({
      where: { email },
      update: { displayName, isActive: true },
      create: { email, displayName, isActive: true },
    });
    const existingMembership = await transaction.companyMembership.findFirst({
      where: { userId: user.id },
      include: { company: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    if (
      existingMembership &&
      existingMembership.company.name !== companyName
    ) {
      throw new Error(
        'Bootstrap user already belongs to a different company; review manually.',
      );
    }
    const matchingCompanies = await transaction.company.findMany({
      where: { name: companyName },
      orderBy: { id: 'asc' },
      take: 2,
    });
    if (matchingCompanies.length > 1) {
      throw new Error(
        'Multiple companies match BOOTSTRAP_COMPANY_NAME; review manually.',
      );
    }
    const company =
      existingMembership?.company ??
      matchingCompanies[0] ??
      (await transaction.company.create({ data: { name: companyName } }));
    await transaction.companyMembership.upsert({
      where: {
        userId_companyId: { userId: user.id, companyId: company.id },
      },
      update: { role: 'OWNER' },
      create: { userId: user.id, companyId: company.id, role: 'OWNER' },
    });
    await transaction.user.update({
      where: { id: user.id },
      data: { activeCompanyId: company.id },
    });
    return { userId: user.id, companyId: company.id };
  },
  { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
);

console.log(
  `Staging owner bootstrap complete for user ${result.userId} and company ${result.companyId}.`,
);
await prisma.$disconnect();
