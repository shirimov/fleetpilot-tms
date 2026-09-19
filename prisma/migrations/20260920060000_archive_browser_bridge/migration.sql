-- Add explicit archive scope without adding historical companies to operational Accounting.
CREATE TABLE "ArchiveScopeGrant" (
 "operatingGroupId" TEXT NOT NULL REFERENCES "OperatingGroup"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "companyId" TEXT NOT NULL UNIQUE REFERENCES "Company"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "grantedByUserId" TEXT REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 reason TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("operatingGroupId","companyId")
);
INSERT INTO "ArchiveScopeGrant" ("operatingGroupId","companyId",reason)
 SELECT DISTINCT "operatingGroupId","companyId",'Existing archive binding migrated from operational scope' FROM "ArchiveCompany";
ALTER TABLE "ArchiveCompany" DROP CONSTRAINT archive_company_group_fk;
ALTER TABLE "ArchiveCompany" ADD CONSTRAINT archive_company_grant_fk FOREIGN KEY ("operatingGroupId","companyId") REFERENCES "ArchiveScopeGrant"("operatingGroupId","companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "ArchiveBrowserCatalog" (
 id TEXT PRIMARY KEY,
 "operatingGroupId" TEXT NOT NULL REFERENCES "OperatingGroup"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "accountKey" TEXT NOT NULL,
 fingerprint TEXT NOT NULL,
 companies JSONB NOT NULL,
 "submittedByUserId" TEXT NOT NULL REFERENCES "User"(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("operatingGroupId","accountKey",fingerprint)
);
CREATE TRIGGER archive_catalog_immutable BEFORE UPDATE OR DELETE ON "ArchiveBrowserCatalog" FOR EACH ROW EXECUTE FUNCTION archive_immutable();
CREATE TRIGGER archive_grant_immutable BEFORE UPDATE OR DELETE ON "ArchiveScopeGrant" FOR EACH ROW EXECUTE FUNCTION archive_immutable();
-- Lock canonical Company for both grant and operational membership writes: no cross-group race.
CREATE FUNCTION archive_membership_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM id FROM "Company" WHERE id=NEW."companyId" FOR UPDATE;
 IF EXISTS (SELECT 1 FROM "OperatingGroupCompany" WHERE "companyId"=NEW."companyId" AND "operatingGroupId"<>NEW."operatingGroupId")
 OR EXISTS (SELECT 1 FROM "ArchiveScopeGrant" WHERE "companyId"=NEW."companyId" AND "operatingGroupId"<>NEW."operatingGroupId") THEN
   RAISE EXCEPTION 'Archive/operational Company scope conflict' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER archive_grant_group_guard BEFORE INSERT ON "ArchiveScopeGrant" FOR EACH ROW EXECUTE FUNCTION archive_membership_guard();
CREATE TRIGGER archive_operational_group_guard BEFORE INSERT OR UPDATE ON "OperatingGroupCompany" FOR EACH ROW EXECUTE FUNCTION archive_membership_guard();
-- Inventory retry lookup is serialized by the same group lock used for captures.
CREATE INDEX archive_inventory_fingerprint_lookup ON "ArchiveInventory"("archiveCompanyId",pid,fingerprint);
