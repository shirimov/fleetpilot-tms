-- CreateEnum
CREATE TYPE "TaskActivityAction" AS ENUM ('PROJECT_CREATED', 'TASK_CREATED', 'TITLE_CHANGED', 'DESCRIPTION_CHANGED', 'STATUS_CHANGED', 'BOARD_CHANGED', 'PRIORITY_CHANGED', 'ASSIGNEE_CHANGED', 'DUE_DATE_CHANGED', 'ORDER_CHANGED', 'TASK_DELETED');

-- CreateEnum
CREATE TYPE "TaskActivityActorType" AS ENUM ('UNATTRIBUTED', 'EMPLOYEE', 'SYSTEM', 'INTEGRATION', 'AI');

-- CreateEnum
CREATE TYPE "TaskActivityEntityType" AS ENUM ('PROJECT', 'TASK_CARD');

-- CreateTable
CREATE TABLE "TaskActivity" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "cardId" TEXT,
    "entityType" "TaskActivityEntityType" NOT NULL,
    "entityId" TEXT NOT NULL,
    "entityTitle" TEXT,
    "action" "TaskActivityAction" NOT NULL,
    "actorType" "TaskActivityActorType" NOT NULL DEFAULT 'UNATTRIBUTED',
    "actorId" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaskActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TaskActivity_projectId_occurredAt_id_idx" ON "TaskActivity"("projectId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "TaskActivity_cardId_occurredAt_id_idx" ON "TaskActivity"("cardId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "TaskActivity_entityType_entityId_occurredAt_id_idx" ON "TaskActivity"("entityType", "entityId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "TaskActivity_sourceType_sourceId_idx" ON "TaskActivity"("sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "TaskActivity_occurredAt_id_idx" ON "TaskActivity"("occurredAt", "id");

-- CreateIndex
CREATE INDEX "TaskProject_companyId_idx" ON "TaskProject"("companyId");

-- AddForeignKey
ALTER TABLE "TaskActivity" ADD CONSTRAINT "TaskActivity_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "TaskProject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskActivity" ADD CONSTRAINT "TaskActivity_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "TaskCard"("id") ON DELETE SET NULL ON UPDATE CASCADE;
