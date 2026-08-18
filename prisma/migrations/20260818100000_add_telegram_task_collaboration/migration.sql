-- CreateEnum
CREATE TYPE "TelegramDeliveryStatus" AS ENUM (
  'PENDING',
  'PROCESSING',
  'DELIVERED',
  'RETRYING',
  'PERMANENT_FAILURE',
  'CANCELLED'
);

-- CreateEnum
CREATE TYPE "TelegramDeliveryType" AS ENUM (
  'ASSIGNMENT',
  'UPDATE_REQUEST',
  'COMMAND_RESPONSE',
  'CALLBACK_RESPONSE'
);

-- CreateEnum
CREATE TYPE "TelegramPendingActionType" AS ENUM (
  'ADD_UPDATE',
  'START_TASK',
  'COMPLETE_TASK',
  'OPEN_TASK'
);

-- CreateEnum
CREATE TYPE "TelegramUpdateRequestStatus" AS ENUM (
  'PENDING',
  'RESPONDED',
  'EXPIRED',
  'CANCELLED'
);

-- CreateTable
CREATE TABLE "TelegramUserLink" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "telegramUserId" BIGINT NOT NULL,
  "telegramChatId" BIGINT NOT NULL,
  "telegramUsername" TEXT,
  "verifiedAt" TIMESTAMP(3) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TelegramUserLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramLinkToken" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TelegramLinkToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramInboundUpdate" (
  "id" TEXT NOT NULL,
  "companyId" TEXT,
  "telegramUserId" BIGINT,
  "telegramChatId" BIGINT,
  "telegramUpdateId" BIGINT NOT NULL,
  "kind" TEXT NOT NULL,
  "processedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TelegramInboundUpdate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramDelivery" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "taskCardId" TEXT,
  "type" "TelegramDeliveryType" NOT NULL,
  "telegramChatId" BIGINT NOT NULL,
  "telegramMessageId" BIGINT,
  "payload" JSONB NOT NULL,
  "dedupeKey" TEXT,
  "status" "TelegramDeliveryStatus" NOT NULL DEFAULT 'PENDING',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deliveredAt" TIMESTAMP(3),
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TelegramDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramUpdateRequest" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "taskCardId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "assigneeUserId" TEXT NOT NULL,
  "status" "TelegramUpdateRequestStatus" NOT NULL DEFAULT 'PENDING',
  "telegramMessageId" BIGINT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "respondedAt" TIMESTAMP(3),
  "responseCommentId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TelegramUpdateRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramPendingAction" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "taskCardId" TEXT,
  "telegramChatId" BIGINT NOT NULL,
  "type" "TelegramPendingActionType" NOT NULL,
  "requestedByUserId" TEXT,
  "telegramMessageId" BIGINT,
  "telegramUpdateRequestId" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "invalidatedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "TelegramPendingAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TelegramUserLink_companyId_userId_key" ON "TelegramUserLink"("companyId", "userId");
CREATE UNIQUE INDEX "TelegramUserLink_telegramUserId_key" ON "TelegramUserLink"("telegramUserId");
CREATE UNIQUE INDEX "TelegramUserLink_telegramChatId_key" ON "TelegramUserLink"("telegramChatId");
CREATE INDEX "TelegramUserLink_companyId_enabled_idx" ON "TelegramUserLink"("companyId", "enabled");
CREATE INDEX "TelegramUserLink_userId_enabled_idx" ON "TelegramUserLink"("userId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramLinkToken_tokenHash_key" ON "TelegramLinkToken"("tokenHash");
CREATE INDEX "TelegramLinkToken_companyId_userId_expiresAt_idx" ON "TelegramLinkToken"("companyId", "userId", "expiresAt");
CREATE INDEX "TelegramLinkToken_userId_consumedAt_expiresAt_idx" ON "TelegramLinkToken"("userId", "consumedAt", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramInboundUpdate_telegramUpdateId_key" ON "TelegramInboundUpdate"("telegramUpdateId");
CREATE INDEX "TelegramInboundUpdate_companyId_createdAt_idx" ON "TelegramInboundUpdate"("companyId", "createdAt");
CREATE INDEX "TelegramInboundUpdate_telegramUserId_createdAt_idx" ON "TelegramInboundUpdate"("telegramUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramDelivery_dedupeKey_key" ON "TelegramDelivery"("dedupeKey");
CREATE INDEX "TelegramDelivery_companyId_status_nextAttemptAt_createdAt_idx" ON "TelegramDelivery"("companyId", "status", "nextAttemptAt", "createdAt");
CREATE INDEX "TelegramDelivery_userId_status_nextAttemptAt_idx" ON "TelegramDelivery"("userId", "status", "nextAttemptAt");
CREATE INDEX "TelegramDelivery_taskCardId_type_createdAt_idx" ON "TelegramDelivery"("taskCardId", "type", "createdAt");

-- CreateIndex
CREATE INDEX "TelegramUpdateRequest_companyId_assigneeUserId_status_createdAt_idx" ON "TelegramUpdateRequest"("companyId", "assigneeUserId", "status", "createdAt");
CREATE INDEX "TelegramUpdateRequest_taskCardId_status_createdAt_idx" ON "TelegramUpdateRequest"("taskCardId", "status", "createdAt");
CREATE INDEX "TelegramUpdateRequest_responseCommentId_idx" ON "TelegramUpdateRequest"("responseCommentId");

-- CreateIndex
CREATE INDEX "TelegramPendingAction_companyId_userId_type_expiresAt_idx" ON "TelegramPendingAction"("companyId", "userId", "type", "expiresAt");
CREATE INDEX "TelegramPendingAction_telegramChatId_type_expiresAt_idx" ON "TelegramPendingAction"("telegramChatId", "type", "expiresAt");
CREATE INDEX "TelegramPendingAction_taskCardId_type_expiresAt_idx" ON "TelegramPendingAction"("taskCardId", "type", "expiresAt");

-- AddForeignKey
ALTER TABLE "TelegramUserLink"
  ADD CONSTRAINT "TelegramUserLink_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramUserLink"
  ADD CONSTRAINT "TelegramUserLink_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramLinkToken"
  ADD CONSTRAINT "TelegramLinkToken_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramLinkToken"
  ADD CONSTRAINT "TelegramLinkToken_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramInboundUpdate"
  ADD CONSTRAINT "TelegramInboundUpdate_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramDelivery"
  ADD CONSTRAINT "TelegramDelivery_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramDelivery"
  ADD CONSTRAINT "TelegramDelivery_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramDelivery"
  ADD CONSTRAINT "TelegramDelivery_taskCardId_fkey"
  FOREIGN KEY ("taskCardId") REFERENCES "TaskCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramUpdateRequest"
  ADD CONSTRAINT "TelegramUpdateRequest_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramUpdateRequest"
  ADD CONSTRAINT "TelegramUpdateRequest_taskCardId_fkey"
  FOREIGN KEY ("taskCardId") REFERENCES "TaskCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramUpdateRequest"
  ADD CONSTRAINT "TelegramUpdateRequest_requestedByUserId_fkey"
  FOREIGN KEY ("requestedByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramUpdateRequest"
  ADD CONSTRAINT "TelegramUpdateRequest_assigneeUserId_fkey"
  FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramUpdateRequest"
  ADD CONSTRAINT "TelegramUpdateRequest_responseCommentId_fkey"
  FOREIGN KEY ("responseCommentId") REFERENCES "TaskComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramPendingAction"
  ADD CONSTRAINT "TelegramPendingAction_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramPendingAction"
  ADD CONSTRAINT "TelegramPendingAction_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramPendingAction"
  ADD CONSTRAINT "TelegramPendingAction_taskCardId_fkey"
  FOREIGN KEY ("taskCardId") REFERENCES "TaskCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TelegramPendingAction"
  ADD CONSTRAINT "TelegramPendingAction_telegramUpdateRequestId_fkey"
  FOREIGN KEY ("telegramUpdateRequestId") REFERENCES "TelegramUpdateRequest"("id") ON DELETE SET NULL ON UPDATE CASCADE;
