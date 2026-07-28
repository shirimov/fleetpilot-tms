-- CreateEnum
CREATE TYPE "TaskMentionSourceType" AS ENUM ('DESCRIPTION', 'COMMENT');

-- AlterEnum
ALTER TYPE "TaskActivityAction" ADD VALUE 'ATTACHMENT_ADDED';
ALTER TYPE "TaskActivityAction" ADD VALUE 'ATTACHMENT_REMOVED';
ALTER TYPE "TaskActivityAction" ADD VALUE 'MENTION_ADDED';
ALTER TYPE "TaskActivityAction" ADD VALUE 'MENTION_RESOLVED';

-- AlterTable
ALTER TABLE "TaskAttachment"
ADD COLUMN "byteSize" INTEGER,
ADD COLUMN "displayFilename" TEXT,
ADD COLUMN "originalFilename" TEXT,
ADD COLUMN "storageKey" TEXT,
ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN "uploaderUserId" TEXT;

-- CreateTable
CREATE TABLE "TaskMention" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "commentId" TEXT,
    "mentionedUserId" TEXT,
    "mentionedDisplayName" TEXT NOT NULL,
    "sourceType" "TaskMentionSourceType" NOT NULL,
    "createdByUserId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TaskMention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskMention_cardId_sourceType_createdAt_idx" ON "TaskMention"("cardId", "sourceType", "createdAt");
CREATE INDEX "TaskMention_commentId_idx" ON "TaskMention"("commentId");
CREATE INDEX "TaskMention_mentionedUserId_resolvedAt_idx" ON "TaskMention"("mentionedUserId", "resolvedAt");
CREATE UNIQUE INDEX "TaskAttachment_storageKey_key" ON "TaskAttachment"("storageKey");
CREATE INDEX "TaskAttachment_cardId_createdAt_id_idx" ON "TaskAttachment"("cardId", "createdAt", "id");
CREATE INDEX "TaskAttachment_uploaderUserId_idx" ON "TaskAttachment"("uploaderUserId");

-- AddForeignKey
ALTER TABLE "TaskAttachment" ADD CONSTRAINT "TaskAttachment_uploaderUserId_fkey" FOREIGN KEY ("uploaderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskMention" ADD CONSTRAINT "TaskMention_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "TaskCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskMention" ADD CONSTRAINT "TaskMention_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "TaskComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TaskMention" ADD CONSTRAINT "TaskMention_mentionedUserId_fkey" FOREIGN KEY ("mentionedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TaskMention" ADD CONSTRAINT "TaskMention_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
