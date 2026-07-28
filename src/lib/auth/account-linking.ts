import { Prisma, type PrismaClient, type User } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type OAuthAccountIdentity = {
  provider: string;
  providerAccountId: string;
  email: string;
  displayName: string;
  image?: string | null;
};

export type GitHubEmail = {
  email: string;
  primary: boolean;
  verified: boolean;
};

export class OAuthAccountLinkError extends Error {
  constructor(
    message = 'This email is already linked to another authentication account.',
  ) {
    super(message);
    this.name = 'OAuthAccountLinkError';
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase();
}

export function selectVerifiedPrimaryGitHubEmail(
  emails: GitHubEmail[],
): string | null {
  const verifiedPrimary = emails.find(
    ({ primary, verified }) => primary && verified,
  );
  return verifiedPrimary ? normalizeEmail(verifiedPrimary.email) : null;
}

export class AccountLinkingService {
  constructor(private readonly database: PrismaClient = prisma) {}

  async link(identity: OAuthAccountIdentity): Promise<User> {
    const email = normalizeEmail(identity.email);
    if (!email) throw new OAuthAccountLinkError('A verified email is required.');

    try {
      return await this.database.$transaction(
        async (transaction) => {
          const linkedAccount = await transaction.authAccount.findUnique({
            where: {
              provider_providerAccountId: {
                provider: identity.provider,
                providerAccountId: identity.providerAccountId,
              },
            },
            include: { user: true },
          });
          if (linkedAccount) return linkedAccount.user;

          const existingUser = await transaction.user.findUnique({
            where: { email },
            include: {
              authAccounts: { select: { id: true }, take: 1 },
            },
          });
          if (existingUser?.authAccounts.length) {
            throw new OAuthAccountLinkError();
          }

          const user =
            existingUser ??
            (await transaction.user.create({
              data: {
                email,
                displayName: identity.displayName.trim() || email,
                image: identity.image,
              },
            }));

          await transaction.authAccount.create({
            data: {
              userId: user.id,
              provider: identity.provider,
              providerAccountId: identity.providerAccountId,
            },
          });
          return user;
        },
        { isolationLevel: 'Serializable' },
      );
    } catch (error) {
      if (
        error instanceof OAuthAccountLinkError ||
        (error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002')
      ) {
        throw new OAuthAccountLinkError();
      }
      throw error;
    }
  }
}

export const accountLinkingService = new AccountLinkingService();
