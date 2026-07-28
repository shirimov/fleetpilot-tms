import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import { prisma } from '@/lib/prisma';

function normalizeEmail(email: string): string {
  return email.trim().toLocaleLowerCase();
}

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [GitHub],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, account }) {
      if (!account) return token;
      if (!token.email) {
        throw new Error('The authentication provider did not return an email.');
      }

      const email = normalizeEmail(token.email);
      const displayName = token.name?.trim() || email;
      const databaseUser = await prisma.$transaction(async (transaction) => {
        const linkedAccount = await transaction.authAccount.findUnique({
          where: {
            provider_providerAccountId: {
              provider: account.provider,
              providerAccountId: account.providerAccountId,
            },
          },
          include: { user: true },
        });
        if (linkedAccount) return linkedAccount.user;

        const user = await transaction.user.upsert({
          where: { email },
          create: {
            email,
            displayName,
            image: token.picture,
          },
          update: {
            image: token.picture,
          },
        });

        await transaction.authAccount.create({
          data: {
            userId: user.id,
            provider: account.provider,
            providerAccountId: account.providerAccountId,
          },
        });
        return user;
      });

      token.userId = databaseUser.id;
      return token;
    },
    async session({ session, token }) {
      if (session.user && typeof token.userId === 'string') {
        session.user.id = token.userId;
      }
      return session;
    },
  },
});
