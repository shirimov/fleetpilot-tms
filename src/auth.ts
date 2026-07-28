import NextAuth from 'next-auth';
import GitHub from 'next-auth/providers/github';
import {
  accountLinkingService,
  selectVerifiedPrimaryGitHubEmail,
  type GitHubEmail,
} from '@/lib/auth/account-linking';

export const { auth, handlers, signIn, signOut } = NextAuth({
  providers: [
    GitHub({
      userinfo: {
        url: 'https://api.github.com/user',
        async request({
          tokens,
        }: {
          tokens: { access_token?: string };
        }) {
          if (!tokens.access_token) {
            throw new Error('GitHub did not return an access token.');
          }
          const headers = {
            Authorization: `Bearer ${tokens.access_token}`,
            'User-Agent': 'fleetpilot-auth',
          };
          const [profileResponse, emailResponse] = await Promise.all([
            fetch('https://api.github.com/user', { headers }),
            fetch('https://api.github.com/user/emails', { headers }),
          ]);
          if (!profileResponse.ok || !emailResponse.ok) {
            throw new Error('GitHub profile verification failed.');
          }
          const profile = (await profileResponse.json()) as Record<
            string,
            unknown
          >;
          const emails = (await emailResponse.json()) as GitHubEmail[];
          const verifiedEmail = selectVerifiedPrimaryGitHubEmail(emails);
          if (!verifiedEmail) {
            throw new Error('A verified primary GitHub email is required.');
          }
          return { ...profile, email: verifiedEmail };
        },
      },
    }),
  ],
  session: { strategy: 'jwt' },
  callbacks: {
    async jwt({ token, account }) {
      if (!account) return token;
      if (!token.email) {
        throw new Error('The authentication provider did not return an email.');
      }

      const databaseUser = await accountLinkingService.link({
        provider: account.provider,
        providerAccountId: account.providerAccountId,
        email: token.email,
        displayName: token.name?.trim() || token.email,
        image: token.picture,
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
