-- Add a verified internal-user assignee while retaining TaskCard.assignedTo
-- for legacy display compatibility.
ALTER TABLE "TaskCard" ADD COLUMN "assigneeUserId" TEXT;

CREATE INDEX "TaskCard_assigneeUserId_idx" ON "TaskCard"("assigneeUserId");

ALTER TABLE "TaskCard" ADD CONSTRAINT "TaskCard_assigneeUserId_fkey"
FOREIGN KEY ("assigneeUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
