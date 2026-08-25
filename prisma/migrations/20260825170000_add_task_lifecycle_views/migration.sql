ALTER TYPE "TaskActivityAction" ADD VALUE 'TASK_ARCHIVED';
ALTER TYPE "TaskActivityAction" ADD VALUE 'TASK_UNARCHIVED';

ALTER TABLE "TaskCard"
ADD COLUMN "isArchived" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "archivedByUserId" TEXT;

CREATE INDEX "TaskCard_archivedByUserId_idx" ON "TaskCard"("archivedByUserId");
CREATE INDEX "TaskCard_projectId_isArchived_status_completedAt_idx"
ON "TaskCard"("projectId", "isArchived", "status", "completedAt");

ALTER TABLE "TaskCard"
ADD CONSTRAINT "TaskCard_archivedByUserId_fkey"
FOREIGN KEY ("archivedByUserId") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
