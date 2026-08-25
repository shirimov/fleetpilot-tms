ALTER TABLE "TaskCard" ADD COLUMN "createdByUserId" TEXT;

CREATE INDEX "TaskCard_createdByUserId_idx" ON "TaskCard"("createdByUserId");

ALTER TABLE "TaskCard" ADD CONSTRAINT "TaskCard_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
