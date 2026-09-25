CREATE TABLE "FuelReconciliationManualMatch" (
  "id" TEXT NOT NULL,
  "operatingGroupId" TEXT NOT NULL,
  "pilotEventId" TEXT NOT NULL,
  "archiveLineId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "unmatchedByUserId" TEXT,
  "unmatchReason" TEXT,
  "unmatchedAt" TIMESTAMP(3),
  CONSTRAINT "FuelReconciliationManualMatch_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FuelReconciliationManualMatch_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FuelReconciliationManualMatch_pilotEventId_fkey" FOREIGN KEY ("pilotEventId") REFERENCES "PilotFuelingEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FuelReconciliationManualMatch_archiveLineId_fkey" FOREIGN KEY ("archiveLineId") REFERENCES "ArchiveLine"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FuelReconciliationManualMatch_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FuelReconciliationManualMatch_unmatchedByUserId_fkey" FOREIGN KEY ("unmatchedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "FuelReconciliationManualMatch_unmatch_complete" CHECK (
    ("unmatchedAt" IS NULL AND "unmatchedByUserId" IS NULL AND "unmatchReason" IS NULL)
    OR ("unmatchedAt" IS NOT NULL AND "unmatchedByUserId" IS NOT NULL AND length(btrim("unmatchReason")) >= 10)
  )
);

CREATE INDEX "FuelReconciliationManualMatch_operatingGroupId_createdAt_id_idx" ON "FuelReconciliationManualMatch"("operatingGroupId", "createdAt", "id");
CREATE INDEX "FuelReconciliationManualMatch_pilotEventId_unmatchedAt_idx" ON "FuelReconciliationManualMatch"("pilotEventId", "unmatchedAt");
CREATE INDEX "FuelReconciliationManualMatch_archiveLineId_unmatchedAt_idx" ON "FuelReconciliationManualMatch"("archiveLineId", "unmatchedAt");
CREATE UNIQUE INDEX "FuelReconciliationManualMatch_active_pilot_key" ON "FuelReconciliationManualMatch"("pilotEventId") WHERE "unmatchedAt" IS NULL;
CREATE UNIQUE INDEX "FuelReconciliationManualMatch_active_archive_line_key" ON "FuelReconciliationManualMatch"("archiveLineId") WHERE "unmatchedAt" IS NULL;

CREATE FUNCTION fuel_reconciliation_manual_match_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Fuel reconciliation match audit is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."operatingGroupId" <> NEW."operatingGroupId"
    OR OLD."pilotEventId" <> NEW."pilotEventId"
    OR OLD."archiveLineId" <> NEW."archiveLineId"
    OR OLD."reason" <> NEW."reason"
    OR OLD."createdByUserId" <> NEW."createdByUserId"
    OR OLD."createdAt" <> NEW."createdAt"
    OR OLD."unmatchedAt" IS NOT NULL
    OR NEW."unmatchedAt" IS NULL
    OR NEW."unmatchedByUserId" IS NULL
    OR length(btrim(NEW."unmatchReason")) < 10
  THEN
    RAISE EXCEPTION 'Fuel reconciliation match identity and audit are immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER fuel_reconciliation_manual_match_immutable
  BEFORE UPDATE OR DELETE ON "FuelReconciliationManualMatch"
  FOR EACH ROW EXECUTE FUNCTION fuel_reconciliation_manual_match_guard();
