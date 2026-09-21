-- CreateTable
CREATE TABLE "TruckCompanyAffiliation" (
    "id" TEXT NOT NULL,
    "truckId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "revisionId" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),

    CONSTRAINT "TruckCompanyAffiliation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TruckCompanyHistoryRevision" (
    "id" TEXT NOT NULL,
    "truckId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "previousRevisionId" TEXT,
    "action" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "vinSnapshot" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TruckCompanyHistoryRevision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TruckCompanyAffiliation_truckId_supersededAt_effectiveFrom_idx" ON "TruckCompanyAffiliation"("truckId", "supersededAt", "effectiveFrom");

-- CreateIndex
CREATE INDEX "TruckCompanyAffiliation_companyId_effectiveFrom_idx" ON "TruckCompanyAffiliation"("companyId", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "TruckCompanyHistoryRevision_previousRevisionId_key" ON "TruckCompanyHistoryRevision"("previousRevisionId");

-- CreateIndex
CREATE INDEX "TruckCompanyHistoryRevision_truckId_createdAt_idx" ON "TruckCompanyHistoryRevision"("truckId", "createdAt");

-- AddForeignKey
ALTER TABLE "TruckCompanyAffiliation" ADD CONSTRAINT "TruckCompanyAffiliation_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckCompanyAffiliation" ADD CONSTRAINT "TruckCompanyAffiliation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckCompanyAffiliation" ADD CONSTRAINT "TruckCompanyAffiliation_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "TruckCompanyHistoryRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckCompanyHistoryRevision" ADD CONSTRAINT "TruckCompanyHistoryRevision_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckCompanyHistoryRevision" ADD CONSTRAINT "TruckCompanyHistoryRevision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TruckCompanyHistoryRevision" ADD CONSTRAINT "TruckCompanyHistoryRevision_previousRevisionId_fkey" FOREIGN KEY ("previousRevisionId") REFERENCES "TruckCompanyHistoryRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- No history is inferred or inserted. Prevent normalized raw-VIN bypasses, too.
CREATE UNIQUE INDEX "Truck_physical_vin_key" ON "Truck" (nullif(upper(regexp_replace(vin, '[[:space:]-]+', '', 'g')), ''));
CREATE EXTENSION IF NOT EXISTS btree_gist;
ALTER TABLE "TruckCompanyAffiliation" ADD CONSTRAINT "affiliation_valid_range" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom");
ALTER TABLE "TruckCompanyAffiliation" ADD CONSTRAINT "affiliation_no_overlap" EXCLUDE USING gist ("truckId" WITH =, daterange("effectiveFrom", "effectiveTo", '[)') WITH &&) WHERE ("supersededAt" IS NULL);
CREATE UNIQUE INDEX "affiliation_one_open" ON "TruckCompanyAffiliation"("truckId") WHERE "effectiveTo" IS NULL AND "supersededAt" IS NULL;

CREATE FUNCTION guard_truck_history_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'TruckCompanyHistoryRevision' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Truck operating history is append-only';
  END IF;
  IF OLD."supersededAt" IS NOT NULL OR NEW."supersededAt" IS NULL OR
     (to_jsonb(OLD) - 'supersededAt') IS DISTINCT FROM (to_jsonb(NEW) - 'supersededAt') THEN
    RAISE EXCEPTION 'Only superseding an affiliation is allowed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER history_revision_immutable BEFORE UPDATE OR DELETE ON "TruckCompanyHistoryRevision" FOR EACH ROW EXECUTE FUNCTION guard_truck_history_immutable();
CREATE TRIGGER history_period_immutable BEFORE UPDATE OR DELETE ON "TruckCompanyAffiliation" FOR EACH ROW EXECUTE FUNCTION guard_truck_history_immutable();

CREATE FUNCTION check_truck_history_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid text; current_company text; open_company text; open_start date;
BEGIN
  IF TG_TABLE_NAME = 'Truck' THEN tid := NEW.id; ELSE tid := NEW."truckId"; END IF;
  SELECT "companyId" INTO current_company FROM "Truck" WHERE id = tid FOR UPDATE;
  IF NOT EXISTS (SELECT 1 FROM "TruckCompanyHistoryRevision" WHERE "truckId"=tid) THEN RETURN NULL; END IF;
  SELECT "companyId", "effectiveFrom" INTO open_company, open_start FROM "TruckCompanyAffiliation"
    WHERE "truckId"=tid AND "supersededAt" IS NULL AND "effectiveTo" IS NULL;
  IF open_company IS NULL OR open_company <> current_company OR open_start > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION 'Current Truck Company must agree with one confirmed current open affiliation';
  END IF;
  IF EXISTS (SELECT 1 FROM "TruckCompanyAffiliation" a JOIN "TruckCompanyHistoryRevision" r ON r.id=a."revisionId" WHERE a."truckId"=tid AND r."truckId"<>tid) THEN
    RAISE EXCEPTION 'Affiliation revision must belong to the same Truck';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER truck_history_current AFTER INSERT OR UPDATE ON "Truck" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_truck_history_consistency();
CREATE CONSTRAINT TRIGGER affiliation_current AFTER INSERT OR UPDATE ON "TruckCompanyAffiliation" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_truck_history_consistency();
CREATE CONSTRAINT TRIGGER history_revision_current AFTER INSERT ON "TruckCompanyHistoryRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_truck_history_consistency();
-- Operational unit uniqueness also covers legacy writers that omit normalized fields.
CREATE UNIQUE INDEX "Truck_current_unit_key" ON "Truck" ("companyId", upper(regexp_replace(trim("unitNumber"), '[[:space:]]+', ' ', 'g')));
CREATE FUNCTION guard_tracked_truck_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "TruckCompanyHistoryRevision" WHERE "truckId"=OLD.id) AND
    (NEW.id IS DISTINCT FROM OLD.id OR NEW."vinNormalized" IS DISTINCT FROM OLD."vinNormalized" OR NEW.vin IS DISTINCT FROM OLD.vin) THEN
    RAISE EXCEPTION 'Tracked physical Truck identity requires a separate reviewed correction';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER tracked_truck_identity BEFORE UPDATE ON "Truck" FOR EACH ROW EXECUTE FUNCTION guard_tracked_truck_identity();

-- One revision chain per physical Truck; head selection uses linkage, never clock ordering.
CREATE UNIQUE INDEX "history_one_root" ON "TruckCompanyHistoryRevision"("truckId") WHERE "previousRevisionId" IS NULL;
