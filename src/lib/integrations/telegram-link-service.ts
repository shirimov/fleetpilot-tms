import { createHash, randomBytes } from 'node:crypto';
import {
  Prisma,
  type CompanyMembershipRole,
  type PrismaClient,
} from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { AuthorizationDeniedError } from '@/lib/auth/auth-errors';
import { getTelegramConfig } from './telegram-config';

const LINK_TOKEN_TTL_MS = 15 * 60 * 1000;

function tokenHash(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

function canManageTelegramLink(
  actorRole: CompanyMembershipRole,
  actorUserId: string,
  targetUserId: string,
) {
  return actorUserId === targetUserId || actorRole === 'ADMIN' || actorRole === 'OWNER';
}

export class TelegramLinkService {
  constructor(private readonly database: PrismaClient = prisma) {}

  private requireConfiguredBotUsername() {
    const config = getTelegramConfig();
    if (!config) throw new Error('Telegram integration is unavailable.');
    return config.botUsername;
  }

  async createLinkInvitation(input: {
    actorUserId: string;
    actorRole: CompanyMembershipRole;
    companyId: string;
    userId: string;
  }) {
    if (!canManageTelegramLink(input.actorRole, input.actorUserId, input.userId)) {
      throw new AuthorizationDeniedError();
    }
    const botUsername = this.requireConfiguredBotUsername();

    const membership = await this.database.companyMembership.findUnique({
      where: {
        userId_companyId: { userId: input.userId, companyId: input.companyId },
      },
      include: { user: { select: { id: true, isActive: true } } },
    });
    if (!membership || !membership.user.isActive) {
      throw new Error('Only active company members can connect Telegram.');
    }

    const rawToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);

    await this.database.$transaction(async (transaction) => {
      await transaction.telegramLinkToken.updateMany({
        where: {
          companyId: input.companyId,
          userId: input.userId,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { consumedAt: new Date() },
      });
      await transaction.telegramLinkToken.create({
        data: {
          companyId: input.companyId,
          userId: input.userId,
          tokenHash: tokenHash(rawToken),
          expiresAt,
        },
      });
    });

    return {
      deepLink: `https://t.me/${botUsername}?start=${rawToken}`,
      expiresAt,
    };
  }

  async consumeLinkToken(input: {
    token: string;
    telegramUserId: bigint;
    telegramChatId: bigint;
    telegramUsername: string | null;
  }) {
    const now = new Date();

    try {
      return await this.database.$transaction(async (transaction) => {
        const token = await transaction.telegramLinkToken.findUnique({
          where: { tokenHash: tokenHash(input.token) },
          include: {
            user: {
              select: { id: true, isActive: true, displayName: true },
            },
            company: { select: { id: true, name: true } },
          },
        });
        if (!token || token.consumedAt || token.expiresAt <= now) {
          throw new Error('This Telegram link is invalid or expired.');
        }

        const membership = await transaction.companyMembership.findUnique({
          where: {
            userId_companyId: {
              userId: token.userId,
              companyId: token.companyId,
            },
          },
          select: { id: true },
        });
        if (!token.user.isActive || !membership) {
          throw new Error('This Telegram link is no longer valid for the user.');
        }

        const claimed = await transaction.telegramLinkToken.updateMany({
          where: {
            id: token.id,
            consumedAt: null,
            expiresAt: { gt: now },
          },
          data: { consumedAt: now },
        });
        if (claimed.count !== 1) {
          throw new Error('This Telegram link is invalid or expired.');
        }

        await transaction.telegramLinkToken.updateMany({
          where: {
            companyId: token.companyId,
            userId: token.userId,
            consumedAt: null,
            expiresAt: { gt: now },
          },
          data: { consumedAt: now },
        });

        const link = await transaction.telegramUserLink.upsert({
          where: {
            companyId_userId: {
              companyId: token.companyId,
              userId: token.userId,
            },
          },
          update: {
            telegramUserId: input.telegramUserId,
            telegramChatId: input.telegramChatId,
            telegramUsername: input.telegramUsername,
            verifiedAt: now,
            enabled: true,
          },
          create: {
            companyId: token.companyId,
            userId: token.userId,
            telegramUserId: input.telegramUserId,
            telegramChatId: input.telegramChatId,
            telegramUsername: input.telegramUsername,
            verifiedAt: now,
            enabled: true,
          },
        });

        return {
          link,
          companyName: token.company.name,
          userDisplayName: token.user.displayName,
        };
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new Error(
          'This Telegram account is already linked to a different FleetPilot user.',
        );
      }
      throw error;
    }
  }

  async disconnectLink(input: {
    actorUserId: string;
    actorRole: CompanyMembershipRole;
    companyId: string;
    userId: string;
  }) {
    if (!canManageTelegramLink(input.actorRole, input.actorUserId, input.userId)) {
      throw new AuthorizationDeniedError();
    }

    return this.database.$transaction(async (transaction) => {
      const link = await transaction.telegramUserLink.findUnique({
        where: {
          companyId_userId: { companyId: input.companyId, userId: input.userId },
        },
      });
      if (!link) return { disconnected: false };

      const now = new Date();
      await transaction.telegramUserLink.update({
        where: { id: link.id },
        data: { enabled: false },
      });
      await transaction.telegramPendingAction.updateMany({
        where: {
          companyId: input.companyId,
          userId: input.userId,
          consumedAt: null,
          invalidatedAt: null,
        },
        data: { invalidatedAt: now },
      });
      await transaction.telegramDelivery.updateMany({
        where: {
          companyId: input.companyId,
          userId: input.userId,
          status: { in: ['PENDING', 'PROCESSING', 'RETRYING'] },
          deliveredAt: null,
        },
        data: { status: 'CANCELLED', lastError: 'Telegram link disconnected.' },
      });
      await transaction.telegramUpdateRequest.updateMany({
        where: {
          companyId: input.companyId,
          assigneeUserId: input.userId,
          status: 'PENDING',
          respondedAt: null,
        },
        data: { status: 'CANCELLED' },
      });
      await transaction.telegramLinkToken.updateMany({
        where: {
          companyId: input.companyId,
          userId: input.userId,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });

      return { disconnected: true };
    });
  }
}

export const telegramLinkService = new TelegramLinkService();
