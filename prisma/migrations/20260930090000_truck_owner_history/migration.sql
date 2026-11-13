-- No owner rows are inferred or backfilled. This migration only adds infrastructure.
CREATE TABLE "TruckOwnerHistoryRevision" (
  "id" TEXT PRIMARY KEY,
  "truckId" TEXT NOT NULL REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "operatingGroupId" TEXT NOT NULL REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "actorUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "previousRevisionId" TEXT UNIQUE REFERENCES "TruckOwnerHistoryRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "sourceReference" TEXT NOT NULL CHECK (length(trim("sourceReference")) BETWEEN 1 AND 2000),
  "reason" TEXT NOT NULL CHECK (length(trim("reason")) BETWEEN 1 AND 2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  -- Database-owned assembly window; never a caller-supplied seal/token.
  "creationTransactionId" BIGINT NOT NULL DEFAULT txid_current(),
  CONSTRAINT "owner_revision_not_self" CHECK ("previousRevisionId" IS DISTINCT FROM "id")
);
CREATE INDEX "TruckOwnerHistoryRevision_truckId_createdAt_idx" ON "TruckOwnerHistoryRevision"("truckId", "createdAt");
CREATE INDEX "TruckOwnerHistoryRevision_operatingGroupId_idx" ON "TruckOwnerHistoryRevision"("operatingGroupId");
CREATE UNIQUE INDEX "owner_history_one_root" ON "TruckOwnerHistoryRevision"("truckId") WHERE "previousRevisionId" IS NULL;
CREATE TABLE "TruckOwnerPeriod" (
  "id" TEXT PRIMARY KEY,
  "truckId" TEXT NOT NULL REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "ownerPartyId" TEXT NOT NULL REFERENCES "FinancialParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "providerRecipientId" TEXT NOT NULL CHECK (length(trim("providerRecipientId")) BETWEEN 1 AND 200),
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "revisionId" TEXT NOT NULL REFERENCES "TruckOwnerHistoryRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "supersededAt" TIMESTAMP(3),
  CONSTRAINT "owner_period_valid_range" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom")
);
CREATE INDEX "TruckOwnerPeriod_truckId_supersededAt_effectiveFrom_idx" ON "TruckOwnerPeriod"("truckId", "supersededAt", "effectiveFrom");
CREATE INDEX "TruckOwnerPeriod_ownerPartyId_effectiveFrom_idx" ON "TruckOwnerPeriod"("ownerPartyId", "effectiveFrom");
CREATE INDEX "TruckOwnerPeriod_companyId_providerRecipientId_idx" ON "TruckOwnerPeriod"("companyId", "providerRecipientId");
-- btree_gist is installed by the operating-history migration.
ALTER TABLE "TruckOwnerPeriod" ADD CONSTRAINT "owner_period_no_overlap" EXCLUDE USING gist ("truckId" WITH =, daterange("effectiveFrom", "effectiveTo", '[)') WITH &&) WHERE ("supersededAt" IS NULL) DEFERRABLE INITIALLY DEFERRED;
-- Each revision is a complete, non-overlapping snapshot, including retired ones.
ALTER TABLE "TruckOwnerPeriod" ADD CONSTRAINT "owner_snapshot_no_overlap" EXCLUDE USING gist ("revisionId" WITH =, daterange("effectiveFrom", "effectiveTo", '[)') WITH &&);

CREATE FUNCTION assemble_truck_owner_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM id FROM "Truck" WHERE id = NEW."truckId" FOR UPDATE;
  IF TG_TABLE_NAME = 'TruckOwnerHistoryRevision' THEN
    -- Immutable existing predecessor + one root + unique successor makes cycles
    -- impossible by induction. A forward reference is deliberately not a protocol.
    IF NEW."previousRevisionId" IS NOT NULL AND
      (NEW."previousRevisionId" = NEW.id OR NOT EXISTS (
        SELECT 1 FROM "TruckOwnerHistoryRevision" p WHERE p.id = NEW."previousRevisionId"
          AND p."truckId" = NEW."truckId" AND p."operatingGroupId" = NEW."operatingGroupId"
      )) THEN RAISE EXCEPTION 'Owner revision requires an existing same-Truck/group predecessor'; END IF;
    NEW."creationTransactionId" := txid_current();
  ELSE
    IF NOT EXISTS (SELECT 1 FROM "TruckOwnerHistoryRevision" r
      WHERE r.id = NEW."revisionId" AND r."truckId" = NEW."truckId"
        AND r."creationTransactionId" = txid_current()) THEN
      RAISE EXCEPTION 'Owner snapshot can only be assembled in its creating transaction';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER owner_revision_assembly BEFORE INSERT ON "TruckOwnerHistoryRevision" FOR EACH ROW EXECUTE FUNCTION assemble_truck_owner_history();
CREATE TRIGGER owner_period_assembly BEFORE INSERT ON "TruckOwnerPeriod" FOR EACH ROW EXECUTE FUNCTION assemble_truck_owner_history();

CREATE FUNCTION guard_truck_owner_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'TruckOwnerHistoryRevision' OR TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Truck owner history is append-only';
  END IF;
  PERFORM id FROM "Truck" WHERE id = OLD."truckId" FOR UPDATE;
  IF OLD."supersededAt" IS NOT NULL OR NEW."supersededAt" IS NULL OR
    (to_jsonb(OLD) - 'supersededAt') IS DISTINCT FROM (to_jsonb(NEW) - 'supersededAt') THEN
    RAISE EXCEPTION 'Only superseding an owner period is allowed';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER owner_revision_immutable BEFORE UPDATE OR DELETE ON "TruckOwnerHistoryRevision" FOR EACH ROW EXECUTE FUNCTION guard_truck_owner_history();
CREATE TRIGGER owner_period_immutable BEFORE UPDATE OR DELETE ON "TruckOwnerPeriod" FOR EACH ROW EXECUTE FUNCTION guard_truck_owner_history();
CREATE FUNCTION check_truck_owner_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE tid text;
BEGIN
  tid := NEW."truckId";
  PERFORM id FROM "Truck" WHERE id = tid FOR UPDATE;
  IF EXISTS (SELECT 1 FROM "TruckOwnerHistoryRevision" r JOIN "TruckOwnerHistoryRevision" p ON p.id=r."previousRevisionId" WHERE r."truckId"=tid AND (p."truckId"<>tid OR p."operatingGroupId"<>r."operatingGroupId")) THEN
    RAISE EXCEPTION 'Owner revision chain scope mismatch';
  END IF;
  -- Deferred final-state checks permit retirement before or after successor
  -- insertion, but never commit a partial/empty snapshot or standalone retirement.
  IF EXISTS (SELECT 1 FROM "TruckOwnerHistoryRevision" r WHERE r."truckId" = tid
    AND NOT EXISTS (SELECT 1 FROM "TruckOwnerPeriod" p WHERE p."revisionId" = r.id)) THEN
    RAISE EXCEPTION 'Owner revision requires a complete nonempty snapshot';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "TruckOwnerPeriod" p JOIN "TruckOwnerHistoryRevision" r ON r.id=p."revisionId"
    JOIN "FinancialParty" o ON o.id=p."ownerPartyId"
    WHERE p."truckId"=tid AND (r."truckId"<>tid OR o."operatingGroupId"<>r."operatingGroupId" OR o.type<>'OWNER_OPERATOR'
      OR (o."companyId" IS NOT NULL AND o."companyId"<>p."companyId")
      OR NOT EXISTS (SELECT 1 FROM "OperatingGroupCompany" c WHERE c."companyId"=p."companyId" AND c."operatingGroupId"=r."operatingGroupId")
      OR ((p."supersededAt" IS NOT NULL) IS DISTINCT FROM EXISTS (SELECT 1 FROM "TruckOwnerHistoryRevision" n WHERE n."previousRevisionId"=r.id)))
  ) THEN RAISE EXCEPTION 'Owner period scope or revision mismatch'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER owner_revision_consistent AFTER INSERT ON "TruckOwnerHistoryRevision" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_truck_owner_history();
CREATE CONSTRAINT TRIGGER owner_period_consistent AFTER INSERT OR UPDATE ON "TruckOwnerPeriod" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_truck_owner_history();
