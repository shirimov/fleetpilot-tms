ALTER TABLE "PilotFuelingEvent"
ADD COLUMN "historicalInactiveReviewedAt" TIMESTAMP(3),
ADD COLUMN "historicalInactiveReviewedByUserId" TEXT,
ADD COLUMN "historicalInactiveReviewedCompanyId" TEXT,
ADD COLUMN "historicalInactiveReviewedTruckId" TEXT;

CREATE INDEX "PilotFuelingEvent_historicalInactiveReviewedTruckId_idx"
ON "PilotFuelingEvent"("historicalInactiveReviewedTruckId");
