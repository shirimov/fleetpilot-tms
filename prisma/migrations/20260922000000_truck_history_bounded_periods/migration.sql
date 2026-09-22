-- Permit bounded-only confirmed history. No data is inserted or rewritten.
-- Existing exclusion, one-open, identity and immutability guards are retained.
CREATE OR REPLACE FUNCTION check_truck_history_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid text; current_company text; open_company text; open_start date;
BEGIN
  IF TG_TABLE_NAME = 'Truck' THEN tid := NEW.id; ELSE tid := NEW."truckId"; END IF;
  SELECT "companyId" INTO current_company FROM "Truck" WHERE id = tid FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "TruckCompanyAffiliation" a JOIN "TruckCompanyHistoryRevision" r ON r.id=a."revisionId" WHERE a."truckId"=tid AND r."truckId"<>tid) THEN
    RAISE EXCEPTION 'Affiliation revision must belong to the same Truck';
  END IF;
  IF EXISTS (SELECT 1 FROM "TruckCompanyHistoryRevision" r JOIN "TruckCompanyHistoryRevision" p ON p.id=r."previousRevisionId" WHERE r."truckId"=tid AND p."truckId"<>tid) THEN
    RAISE EXCEPTION 'History revision chain must belong to the same Truck';
  END IF;
  IF EXISTS (SELECT 1 FROM "TruckCompanyAffiliation" a JOIN "TruckCompanyHistoryRevision" n ON n."previousRevisionId"=a."revisionId" WHERE a."truckId"=tid AND a."supersededAt" IS NULL) THEN
    RAISE EXCEPTION 'Current affiliations must belong to the current revision';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM "TruckCompanyHistoryRevision" WHERE "truckId"=tid) THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM "TruckCompanyAffiliation" WHERE "truckId"=tid AND "supersededAt" IS NULL) THEN
    RAISE EXCEPTION 'A history revision requires confirmed periods';
  END IF;
  SELECT "companyId", "effectiveFrom" INTO open_company, open_start FROM "TruckCompanyAffiliation"
    WHERE "truckId"=tid AND "supersededAt" IS NULL AND "effectiveTo" IS NULL;
  IF open_company IS NOT NULL AND (open_company <> current_company OR open_start > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date) THEN
    RAISE EXCEPTION 'An open affiliation must agree with the current Truck Company and be effective';
  END IF;
  -- With bounded-only history, direct Company changes still require an evidenced
  -- destination open period in the same transaction. Legacy untracked Trucks
  -- remain valid; application edits continue to exclude companyId.
  IF TG_TABLE_NAME = 'Truck' AND TG_OP = 'UPDATE' THEN
    IF NEW."companyId" IS DISTINCT FROM OLD."companyId" AND open_company IS NULL THEN
      RAISE EXCEPTION 'Tracked Company changes require the evidenced movement workflow';
    END IF;
  END IF;
  RETURN NULL;
END $$;
