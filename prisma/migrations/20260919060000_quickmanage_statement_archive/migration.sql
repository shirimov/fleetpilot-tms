-- CreateTable
CREATE TABLE "ArchiveCompany" (
    "id" TEXT NOT NULL,
    "operatingGroupId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'QUICKMANAGE',
    "accountKey" TEXT NOT NULL,
    "providerCompanyId" TEXT NOT NULL,
    "providerCompanyName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveCompany_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveStatement" (
    "id" TEXT NOT NULL,
    "archiveCompanyId" TEXT NOT NULL,
    "providerStatementId" TEXT NOT NULL,
    "latestProviderVersion" INTEGER NOT NULL,
    "acceptedProviderVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PARSED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArchiveStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveVersion" (
    "sealed" BOOLEAN NOT NULL DEFAULT false,
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "providerVersion" INTEGER NOT NULL,
    "documentId" TEXT NOT NULL,
    "detailStorageKey" TEXT NOT NULL,
    "detailChecksum" TEXT NOT NULL,
    "pdfChecksum" TEXT NOT NULL,
    "bundleChecksum" TEXT NOT NULL,
    "pid" TEXT NOT NULL,
    "statementNumber" TEXT,
    "recipientId" TEXT NOT NULL,
    "recipientName" TEXT,
    "recipientType" TEXT NOT NULL,
    "recipientStatus" TEXT,
    "role" TEXT,
    "contract" TEXT,
    "sourceStatus" TEXT,
    "workStart" TIMESTAMP(3) NOT NULL,
    "workEnd" TIMESTAMP(3) NOT NULL,
    "grossMinor" BIGINT,
    "deductionsMinor" BIGINT,
    "netPayMinor" BIGINT,
    "payoutMinor" BIGINT,
    "earningMinor" BIGINT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "header" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "providerCreatedAt" TIMESTAMP(3),
    "providerUpdatedAt" TIMESTAMP(3),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedByUserId" TEXT NOT NULL,

    CONSTRAINT "ArchiveVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveLine" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceArray" TEXT NOT NULL,
    "sourceOrder" INTEGER NOT NULL,
    "providerLineId" TEXT,
    "description" TEXT,
    "sourceType" TEXT,
    "amountMinor" BIGINT,
    "rawAmount" TEXT,
    "sourceDate" TEXT,
    "reference" TEXT,
    "sourceUnit" TEXT,
    "included" BOOLEAN,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "ArchiveLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveTruck" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "providerTruckId" TEXT,
    "unit" TEXT,
    "vin" TEXT,
    "truckId" TEXT,
    "mappingStatus" TEXT NOT NULL,

    CONSTRAINT "ArchiveTruck_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveConflict" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "providerVersion" INTEGER NOT NULL,
    "documentId" TEXT NOT NULL,
    "detailStorageKey" TEXT NOT NULL,
    "detailChecksum" TEXT NOT NULL,
    "pdfChecksum" TEXT NOT NULL,
    "bundleChecksum" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedByUserId" TEXT NOT NULL,

    CONSTRAINT "ArchiveConflict_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveInventory" (
    "sealed" BOOLEAN NOT NULL DEFAULT false,
    "id" TEXT NOT NULL,
    "archiveCompanyId" TEXT NOT NULL,
    "pid" TEXT NOT NULL,
    "expectedCount" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "capturedByUserId" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "ArchiveInventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveInventoryItem" (
    "id" TEXT NOT NULL,
    "inventoryId" TEXT NOT NULL,
    "providerStatementId" TEXT NOT NULL,
    "providerVersion" INTEGER NOT NULL,
    "recipientId" TEXT NOT NULL,
    "recipientName" TEXT,
    "recipientType" TEXT NOT NULL,
    "providerUpdatedAt" TEXT,
    "metadata" JSONB NOT NULL,

    CONSTRAINT "ArchiveInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArchiveCaptureJob" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseToken" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArchiveCaptureJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveCompany_sourceId_key" ON "ArchiveCompany"("sourceId");

-- CreateIndex
CREATE INDEX "ArchiveCompany_operatingGroupId_companyId_idx" ON "ArchiveCompany"("operatingGroupId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveCompany_operatingGroupId_accountKey_providerCompanyI_key" ON "ArchiveCompany"("operatingGroupId", "accountKey", "providerCompanyId");

-- CreateIndex
CREATE INDEX "ArchiveStatement_archiveCompanyId_status_idx" ON "ArchiveStatement"("archiveCompanyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveStatement_archiveCompanyId_providerStatementId_key" ON "ArchiveStatement"("archiveCompanyId", "providerStatementId");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveVersion_detailStorageKey_key" ON "ArchiveVersion"("detailStorageKey");

-- CreateIndex
CREATE INDEX "ArchiveVersion_pid_capturedAt_idx" ON "ArchiveVersion"("pid", "capturedAt");

-- CreateIndex
CREATE INDEX "ArchiveVersion_recipientId_pid_idx" ON "ArchiveVersion"("recipientId", "pid");

-- CreateIndex
CREATE INDEX "ArchiveVersion_recipientType_recipientStatus_idx" ON "ArchiveVersion"("recipientType", "recipientStatus");

-- CreateIndex
CREATE INDEX "ArchiveVersion_workStart_workEnd_idx" ON "ArchiveVersion"("workStart", "workEnd");

-- CreateIndex
CREATE INDEX "ArchiveVersion_documentId_idx" ON "ArchiveVersion"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveVersion_statementId_providerVersion_key" ON "ArchiveVersion"("statementId", "providerVersion");

-- CreateIndex
CREATE INDEX "ArchiveLine_versionId_kind_idx" ON "ArchiveLine"("versionId", "kind");

-- CreateIndex
CREATE INDEX "ArchiveLine_providerLineId_idx" ON "ArchiveLine"("providerLineId");

-- CreateIndex
CREATE INDEX "ArchiveLine_sourceUnit_sourceDate_idx" ON "ArchiveLine"("sourceUnit", "sourceDate");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveLine_versionId_sourceArray_sourceOrder_key" ON "ArchiveLine"("versionId", "sourceArray", "sourceOrder");

-- CreateIndex
CREATE INDEX "ArchiveTruck_truckId_versionId_idx" ON "ArchiveTruck"("truckId", "versionId");

-- CreateIndex
CREATE INDEX "ArchiveTruck_unit_idx" ON "ArchiveTruck"("unit");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveTruck_versionId_sourceKey_key" ON "ArchiveTruck"("versionId", "sourceKey");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveConflict_detailStorageKey_key" ON "ArchiveConflict"("detailStorageKey");

-- CreateIndex
CREATE INDEX "ArchiveConflict_documentId_idx" ON "ArchiveConflict"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveConflict_statementId_providerVersion_bundleChecksum_key" ON "ArchiveConflict"("statementId", "providerVersion", "bundleChecksum");

-- CreateIndex
CREATE INDEX "ArchiveInventory_archiveCompanyId_pid_observedAt_idx" ON "ArchiveInventory"("archiveCompanyId", "pid", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveInventoryItem_inventoryId_providerStatementId_key" ON "ArchiveInventoryItem"("inventoryId", "providerStatementId");

-- CreateIndex
CREATE UNIQUE INDEX "ArchiveCaptureJob_itemId_key" ON "ArchiveCaptureJob"("itemId");

-- CreateIndex
CREATE INDEX "ArchiveCaptureJob_status_leaseExpiresAt_idx" ON "ArchiveCaptureJob"("status", "leaseExpiresAt");

-- AddForeignKey
ALTER TABLE "ArchiveCompany" ADD CONSTRAINT "ArchiveCompany_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveCompany" ADD CONSTRAINT "ArchiveCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveCompany" ADD CONSTRAINT "ArchiveCompany_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "FinancialSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveStatement" ADD CONSTRAINT "ArchiveStatement_archiveCompanyId_fkey" FOREIGN KEY ("archiveCompanyId") REFERENCES "ArchiveCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveVersion" ADD CONSTRAINT "ArchiveVersion_capturedByUserId_fkey" FOREIGN KEY ("capturedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveVersion" ADD CONSTRAINT "ArchiveVersion_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "ArchiveStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveVersion" ADD CONSTRAINT "ArchiveVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveLine" ADD CONSTRAINT "ArchiveLine_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ArchiveVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveTruck" ADD CONSTRAINT "ArchiveTruck_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ArchiveVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveTruck" ADD CONSTRAINT "ArchiveTruck_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveConflict" ADD CONSTRAINT "ArchiveConflict_capturedByUserId_fkey" FOREIGN KEY ("capturedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveConflict" ADD CONSTRAINT "ArchiveConflict_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "ArchiveStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveConflict" ADD CONSTRAINT "ArchiveConflict_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "FinancialStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveInventory" ADD CONSTRAINT "ArchiveInventory_capturedByUserId_fkey" FOREIGN KEY ("capturedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveInventory" ADD CONSTRAINT "ArchiveInventory_archiveCompanyId_fkey" FOREIGN KEY ("archiveCompanyId") REFERENCES "ArchiveCompany"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveInventoryItem" ADD CONSTRAINT "ArchiveInventoryItem_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "ArchiveInventory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveCaptureJob" ADD CONSTRAINT "ArchiveCaptureJob_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ArchiveInventoryItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Append-only evidence; only the creating transaction can seal a new aggregate.
CREATE FUNCTION archive_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Archive evidence is immutable' USING ERRCODE = '23514';
END $$;
CREATE FUNCTION archive_seal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NOT OLD.sealed AND NEW.sealed AND
    (to_jsonb(OLD) - 'sealed') = (to_jsonb(NEW) - 'sealed') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Archive snapshot is immutable' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER archive_version_immutable BEFORE UPDATE OR DELETE ON "ArchiveVersion" FOR EACH ROW EXECUTE FUNCTION archive_seal();
CREATE TRIGGER archive_inventory_immutable BEFORE UPDATE OR DELETE ON "ArchiveInventory" FOR EACH ROW EXECUTE FUNCTION archive_seal();
CREATE TRIGGER archive_line_immutable BEFORE UPDATE OR DELETE ON "ArchiveLine" FOR EACH ROW EXECUTE FUNCTION archive_immutable();
CREATE TRIGGER archive_truck_immutable BEFORE UPDATE OR DELETE ON "ArchiveTruck" FOR EACH ROW EXECUTE FUNCTION archive_immutable();
CREATE TRIGGER archive_conflict_immutable BEFORE UPDATE OR DELETE ON "ArchiveConflict" FOR EACH ROW EXECUTE FUNCTION archive_immutable();
CREATE TRIGGER archive_item_immutable BEFORE UPDATE OR DELETE ON "ArchiveInventoryItem" FOR EACH ROW EXECUTE FUNCTION archive_immutable();
CREATE TRIGGER archive_company_immutable BEFORE UPDATE OR DELETE ON "ArchiveCompany" FOR EACH ROW EXECUTE FUNCTION archive_immutable();
CREATE FUNCTION archive_child_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE closed boolean;
BEGIN
  IF TG_TABLE_NAME = 'ArchiveInventoryItem' THEN SELECT sealed INTO closed FROM "ArchiveInventory" WHERE id = NEW."inventoryId";
  ELSE SELECT sealed INTO closed FROM "ArchiveVersion" WHERE id = NEW."versionId"; END IF;
  IF closed THEN RAISE EXCEPTION 'Cannot append to sealed archive evidence' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER archive_line_insert BEFORE INSERT ON "ArchiveLine" FOR EACH ROW EXECUTE FUNCTION archive_child_insert();
CREATE TRIGGER archive_truck_insert BEFORE INSERT ON "ArchiveTruck" FOR EACH ROW EXECUTE FUNCTION archive_child_insert();
CREATE TRIGGER archive_item_insert BEFORE INSERT ON "ArchiveInventoryItem" FOR EACH ROW EXECUTE FUNCTION archive_child_insert();
CREATE FUNCTION archive_document_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ArchiveVersion" WHERE "documentId"=OLD.id) OR EXISTS (SELECT 1 FROM "ArchiveConflict" WHERE "documentId"=OLD.id) THEN
    RAISE EXCEPTION 'Referenced archive document is immutable' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; ELSE RETURN NEW; END IF;
END $$;
CREATE TRIGGER archive_document_immutable BEFORE UPDATE OR DELETE ON "FinancialStatement" FOR EACH ROW EXECUTE FUNCTION archive_document_immutable();
CREATE FUNCTION archive_statement_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(OLD) - ARRAY['latestProviderVersion','acceptedProviderVersion','status']) <> (to_jsonb(NEW) - ARRAY['latestProviderVersion','acceptedProviderVersion','status']) THEN
    RAISE EXCEPTION 'Archive identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER archive_statement_identity BEFORE UPDATE ON "ArchiveStatement" FOR EACH ROW EXECUTE FUNCTION archive_statement_identity();
ALTER TABLE "ArchiveCompany" ADD CONSTRAINT archive_company_group_fk FOREIGN KEY ("operatingGroupId","companyId") REFERENCES "OperatingGroupCompany"("operatingGroupId","companyId") ON DELETE RESTRICT;
ALTER TABLE "ArchiveCompany" ADD CONSTRAINT archive_provider_check CHECK (provider = 'QUICKMANAGE');
ALTER TABLE "ArchiveStatement" ADD CONSTRAINT archive_status_check CHECK (status IN ('PARSED','NEEDS_REVIEW','SOURCE_CHANGED'));
ALTER TABLE "ArchiveCaptureJob" ADD CONSTRAINT archive_job_status_check CHECK (status IN ('DISCOVERED','CAPTURING','PARSED','NEEDS_REVIEW','FAILED'));
ALTER TABLE "ArchiveVersion" ADD CONSTRAINT archive_period_check CHECK ("workEnd">="workStart" AND "providerVersion">=0);
ALTER TABLE "ArchiveInventory" ADD CONSTRAINT archive_count_check CHECK ("expectedCount">=0);

-- Counts compare source identities AND exact expected versions/recipient/PID. Equal counts alone never suffice.
CREATE VIEW "ArchiveCoverage" AS
SELECT i.id, i."archiveCompanyId", i.pid, i."observedAt", i."expectedCount"::bigint AS expected,
 (SELECT count(*) FROM "ArchiveInventoryItem" e WHERE e."inventoryId"=i.id AND EXISTS (
   SELECT 1 FROM "ArchiveStatement" s JOIN "ArchiveVersion" v ON v."statementId"=s.id
   WHERE s."archiveCompanyId"=i."archiveCompanyId" AND s."providerStatementId"=e."providerStatementId"
     AND v."providerVersion"=e."providerVersion" AND v.sealed AND v.pid=i.pid AND v."recipientId"=e."recipientId" AND (e."providerUpdatedAt" IS NULL OR v."providerUpdatedAt"=e."providerUpdatedAt"::timestamptz)
 )) AS captured,
 (SELECT count(*) FROM "ArchiveInventoryItem" e WHERE e."inventoryId"=i.id AND EXISTS (
   SELECT 1 FROM "ArchiveStatement" s WHERE s."archiveCompanyId"=i."archiveCompanyId" AND s."providerStatementId"=e."providerStatementId"
     AND (s.status <> 'PARSED' OR s."latestProviderVersion" <> e."providerVersion" OR s."acceptedProviderVersion" <> s."latestProviderVersion")
 )) AS conflicts,
 (SELECT count(*) FROM "ArchiveStatement" s WHERE s."archiveCompanyId"=i."archiveCompanyId"
   AND EXISTS (SELECT 1 FROM "ArchiveVersion" v WHERE v."statementId"=s.id AND v.pid=i.pid AND v.sealed)
   AND NOT EXISTS (SELECT 1 FROM "ArchiveInventoryItem" e WHERE e."inventoryId"=i.id AND e."providerStatementId"=s."providerStatementId")
 ) AS unexpected,
 (SELECT count(*) FROM "ArchiveInventoryItem" e JOIN "ArchiveCaptureJob" j ON j."itemId"=e.id
   WHERE e."inventoryId"=i.id AND (j.status IN ('FAILED','NEEDS_REVIEW') OR (j.status='CAPTURING' AND j."leaseExpiresAt"<now()))) AS failed
FROM "ArchiveInventory" i WHERE i.sealed;

CREATE FUNCTION archive_require_sealed() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE closed boolean; actual integer;
BEGIN
  IF TG_TABLE_NAME='ArchiveVersion' THEN SELECT sealed INTO closed FROM "ArchiveVersion" WHERE id=NEW.id;
  ELSE SELECT sealed INTO closed FROM "ArchiveInventory" WHERE id=NEW.id;
    SELECT count(*) INTO actual FROM "ArchiveInventoryItem" WHERE "inventoryId"=NEW.id;
    IF actual<>NEW."expectedCount" THEN RAISE EXCEPTION 'Inventory count mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  IF NOT closed THEN RAISE EXCEPTION 'Archive aggregate must be sealed before commit' USING ERRCODE='23514'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER archive_version_sealed AFTER INSERT ON "ArchiveVersion" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION archive_require_sealed();
CREATE CONSTRAINT TRIGGER archive_inventory_sealed AFTER INSERT ON "ArchiveInventory" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION archive_require_sealed();
CREATE FUNCTION archive_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE expected_group text; expected_company text;
BEGIN
  IF TG_TABLE_NAME='ArchiveCompany' THEN
    IF NOT EXISTS (SELECT 1 FROM "FinancialSource" WHERE id=NEW."sourceId" AND "operatingGroupId"=NEW."operatingGroupId" AND "companyId"=NEW."companyId") THEN RAISE EXCEPTION 'Archive source scope mismatch' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='ArchiveTruck' THEN
    SELECT c."companyId" INTO expected_company FROM "ArchiveVersion" v JOIN "ArchiveStatement" s ON s.id=v."statementId" JOIN "ArchiveCompany" c ON c.id=s."archiveCompanyId" WHERE v.id=NEW."versionId";
    IF NEW."truckId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Truck" WHERE id=NEW."truckId" AND "companyId"=expected_company) THEN RAISE EXCEPTION 'Archive Truck scope mismatch' USING ERRCODE='23514'; END IF;
  ELSE
    SELECT c."operatingGroupId" INTO expected_group FROM "ArchiveStatement" s JOIN "ArchiveCompany" c ON c.id=s."archiveCompanyId" WHERE s.id=NEW."statementId";
    IF NOT EXISTS (SELECT 1 FROM "FinancialStatement" WHERE id=NEW."documentId" AND "operatingGroupId"=expected_group) THEN RAISE EXCEPTION 'Archive document scope mismatch' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER archive_company_scope BEFORE INSERT ON "ArchiveCompany" FOR EACH ROW EXECUTE FUNCTION archive_scope_guard();
CREATE TRIGGER archive_version_scope BEFORE INSERT ON "ArchiveVersion" FOR EACH ROW EXECUTE FUNCTION archive_scope_guard();
CREATE TRIGGER archive_conflict_scope BEFORE INSERT ON "ArchiveConflict" FOR EACH ROW EXECUTE FUNCTION archive_scope_guard();
CREATE TRIGGER archive_truck_scope BEFORE INSERT ON "ArchiveTruck" FOR EACH ROW EXECUTE FUNCTION archive_scope_guard();
CREATE FUNCTION archive_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ArchiveCompany" WHERE "sourceId"=OLD.id) AND (NEW."operatingGroupId"<>OLD."operatingGroupId" OR NEW."companyId" IS DISTINCT FROM OLD."companyId" OR NEW.provider IS DISTINCT FROM OLD.provider OR NEW.type<>OLD.type) THEN RAISE EXCEPTION 'Archive source binding is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER archive_source_guard BEFORE UPDATE ON "FinancialSource" FOR EACH ROW EXECUTE FUNCTION archive_source_guard();

CREATE UNIQUE INDEX "ArchiveCompany_accountKey_providerCompanyId_key" ON "ArchiveCompany"("accountKey","providerCompanyId");
