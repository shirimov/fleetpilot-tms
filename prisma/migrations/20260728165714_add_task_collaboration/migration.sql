-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "TaskActivityAction" ADD VALUE 'CHECKLIST_ITEM_CREATED';
ALTER TYPE "TaskActivityAction" ADD VALUE 'CHECKLIST_ITEM_UPDATED';
ALTER TYPE "TaskActivityAction" ADD VALUE 'CHECKLIST_ITEM_COMPLETED';
ALTER TYPE "TaskActivityAction" ADD VALUE 'CHECKLIST_ITEM_REOPENED';
ALTER TYPE "TaskActivityAction" ADD VALUE 'CHECKLIST_ITEM_REORDERED';
ALTER TYPE "TaskActivityAction" ADD VALUE 'CHECKLIST_ITEM_DELETED';
ALTER TYPE "TaskActivityAction" ADD VALUE 'COMMENT_ADDED';
ALTER TYPE "TaskActivityAction" ADD VALUE 'COMMENT_EDITED';
ALTER TYPE "TaskActivityAction" ADD VALUE 'COMMENT_DELETED';

-- CreateTable
CREATE TABLE "TaskChecklistItem" (
    "id" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "isCompleted" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaskChecklistItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskChecklistItem_cardId_order_id_idx" ON "TaskChecklistItem"("cardId", "order", "id");

-- CreateIndex
CREATE INDEX "TaskChecklistItem_createdByUserId_idx" ON "TaskChecklistItem"("createdByUserId");

-- AddForeignKey
ALTER TABLE "TaskChecklistItem" ADD CONSTRAINT "TaskChecklistItem_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "TaskCard"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskChecklistItem" ADD CONSTRAINT "TaskChecklistItem_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
