import { createHash, createHmac, randomBytes } from 'node:crypto';
import type { PrismaClient, User } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { normalizeEmail } from './account-linking';

const TOKEN_LIFETIME_MS = 15 * 60 * 1000;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const EMAIL_RATE_LIMIT = 5;
const IP_RATE_LIMIT = 20;
export const EMAIL_AUTH_PROVIDER_ID = 'email-magic-link';

export function emailAuthIsEnabled() {
  return process.env.EMAIL_AUTH_ENABLED?.trim().toLowerCase() === 'true';
}

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function identifierHash(value: string) {
  const secret = process.env.AUTH_SECRET;
  if (!secret) throw new Error('Email authentication is not configured.');
  return createHmac('sha256', secret).update(value).digest('hex');
}

function emailAuthBaseUrl() {
  const configured = process.env.AUTH_URL ?? process.env.APP_URL;
  if (!configured) throw new Error('Email authentication URL is not configured.');
  const url = new URL(configured);
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('Email authentication URL must use HTTPS.');
  }
  return url.origin;
}

export type EmailDelivery = (input: {
  email: string;
  magicLink: string;
  expiresInMinutes: number;
}) => Promise<void>;

export const sendEmailMagicLink: EmailDelivery = async ({
  email,
  magicLink,
  expiresInMinutes,
}) => {
  const apiKey = process.env.EMAIL_AUTH_RESEND_API_KEY?.trim();
  const from = process.env.EMAIL_AUTH_FROM?.trim();
  if (!apiKey || !from) throw new Error('Email delivery is not configured.');

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [email],
      subject: 'Sign in to FleetPilot',
      html: `<p>Use the secure link below to sign in to FleetPilot.</p><p><a href="${magicLink}">Sign in to FleetPilot</a></p><p>This link expires in ${expiresInMinutes} minutes and can only be used once.</p>`,
      text: `Sign in to FleetPilot: ${magicLink}\n\nThis link expires in ${expiresInMinutes} minutes and can only be used once.`,
    }),
  });
  if (!response.ok) throw new Error('Email delivery failed.');
};

export class EmailAuthService {
  constructor(
    private readonly database: PrismaClient = prisma,
    private readonly deliver: EmailDelivery = sendEmailMagicLink,
  ) {}

  async request(emailInput: string, ipAddress: string, now = new Date()) {
    if (!emailAuthIsEnabled()) return;
    const email = normalizeEmail(emailInput);
    if (
      !email ||
      email.length > 320 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
      return;
    }
    const emailHash = identifierHash(email);
    const ipHash = identifierHash(ipAddress || 'unknown');
    const windowStart = new Date(now.getTime() - RATE_WINDOW_MS);

    const [, , , emailRequests, ipRequests] = await this.database.$transaction([
      this.database.emailSignInToken.deleteMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
            { consumedAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
          ],
        },
      }),
      this.database.emailSignInRequest.deleteMany({
        where: { createdAt: { lt: new Date(now.getTime() - 24 * 60 * 60 * 1000) } },
      }),
      this.database.emailSignInRequest.create({ data: { emailHash, ipHash, createdAt: now } }),
      this.database.emailSignInRequest.count({ where: { emailHash, createdAt: { gte: windowStart } } }),
      this.database.emailSignInRequest.count({ where: { ipHash, createdAt: { gte: windowStart } } }),
    ]);
    if (emailRequests > EMAIL_RATE_LIMIT || ipRequests > IP_RATE_LIMIT) return;

    const users = await this.database.user.findMany({
      where: { email: { equals: email, mode: 'insensitive' } },
      include: { memberships: { select: { id: true }, take: 1 } },
      take: 2,
    });
    if (users.length !== 1 || !users[0].isActive || users[0].memberships.length === 0) return;

    const user = users[0];
    const rawToken = randomBytes(32).toString('base64url');
    await this.database.emailSignInToken.create({
      data: {
        userId: user.id,
        email,
        tokenHash: tokenHash(rawToken),
        expiresAt: new Date(now.getTime() + TOKEN_LIFETIME_MS),
        createdAt: now,
      },
    });
    const magicLink = new URL('/login/email/verify', emailAuthBaseUrl());
    // URL fragments stay in the browser and are not sent in HTTP request lines,
    // reverse-proxy logs, or referrer headers.
    magicLink.hash = new URLSearchParams({ token: rawToken }).toString();
    await this.deliver({ email, magicLink: magicLink.toString(), expiresInMinutes: 15 });
  }

  async consume(rawToken: string, now = new Date()): Promise<User | null> {
    if (!rawToken || rawToken.length > 256) return null;
    return this.database.$transaction(async (transaction) => {
      const record = await transaction.emailSignInToken.findUnique({
        where: { tokenHash: tokenHash(rawToken) },
        include: { user: { include: { memberships: { select: { id: true }, take: 1 } } } },
      });
      if (!record || record.consumedAt || record.expiresAt <= now) return null;
      if (!record.user.isActive || record.user.memberships.length === 0) return null;
      if (normalizeEmail(record.user.email) !== record.email) return null;

      const consumed = await transaction.emailSignInToken.updateMany({
        where: { id: record.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return null;

      const existingAccount = await transaction.authAccount.findUnique({
        where: {
          provider_providerAccountId: {
            provider: EMAIL_AUTH_PROVIDER_ID,
            providerAccountId: record.email,
          },
        },
      });
      if (existingAccount && existingAccount.userId !== record.userId) return null;
      if (!existingAccount) {
        await transaction.authAccount.create({
          data: {
            userId: record.userId,
            provider: EMAIL_AUTH_PROVIDER_ID,
            providerAccountId: record.email,
          },
        });
      }
      return record.user;
    });
  }
}

export const emailAuthService = new EmailAuthService();
