ALTER TABLE "FuelReconciliationManualMatch"
  ADD COLUMN "acceptedChargeMinor" BIGINT,
  ADD COLUMN "acceptedChargeThrough" DATE,
  ADD CONSTRAINT "FuelReconciliationManualMatch_charge_complete" CHECK (
    ("acceptedChargeMinor" IS NULL AND "acceptedChargeThrough" IS NULL)
    OR ("acceptedChargeMinor" IS NOT NULL AND "acceptedChargeMinor" >= 0 AND "acceptedChargeThrough" IS NOT NULL)
  );

CREATE OR REPLACE FUNCTION fuel_reconciliation_manual_match_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Fuel reconciliation match audit is immutable' USING ERRCODE = '23514';
  END IF;
  IF OLD."acceptedChargeMinor" IS DISTINCT FROM NEW."acceptedChargeMinor"
    OR OLD."acceptedChargeThrough" IS DISTINCT FROM NEW."acceptedChargeThrough"
    OR OLD."operatingGroupId" <> NEW."operatingGroupId"
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

