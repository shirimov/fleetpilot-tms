-- Additive safety roster. Legacy Driver/pay/settlements remain unchanged.
-- Unpublished migration: no backfill and no writes to financial/archive tables.
CREATE TABLE "DriverSourceCompanyBinding" (
 "id" TEXT PRIMARY KEY,
 "provider" TEXT NOT NULL CHECK ("provider" = 'QUICKMANAGE'),
 "accountKey" TEXT NOT NULL,
 "operatingGroupId" TEXT NOT NULL REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT,
 "providerCompanyId" TEXT NOT NULL,
 "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT,
 "sourceCompanyName" TEXT,
 "origin" TEXT NOT NULL CHECK ("origin" IN ('ARCHIVE','PROVISIONED')),
 "archiveCompanyId" TEXT REFERENCES "ArchiveCompany"("id") ON DELETE RESTRICT,
 "evidenceSha256" TEXT NOT NULL CHECK ("evidenceSha256" ~ '^[a-f0-9]{64}$'),
 "planSha256" TEXT CHECK ("planSha256" ~ '^[a-f0-9]{64}$'),
 "actorUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "provenance" JSONB NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "driver_source_company_identity_key" UNIQUE ("provider", "accountKey", "providerCompanyId"),
 CHECK (("origin"='ARCHIVE' AND "archiveCompanyId" IS NOT NULL AND "planSha256" IS NULL) OR ("origin"='PROVISIONED' AND "archiveCompanyId" IS NULL AND "planSha256" IS NOT NULL AND "sourceCompanyName" IS NOT NULL))
);
CREATE INDEX "DriverSourceCompanyBinding_companyId_idx" ON "DriverSourceCompanyBinding"("companyId");
CREATE INDEX "DriverSourceCompanyBinding_operatingGroupId_idx" ON "DriverSourceCompanyBinding"("operatingGroupId");
CREATE TABLE "DriverSourceCompanyBindingEvent" (
 "id" TEXT PRIMARY KEY,
 "bindingId" TEXT NOT NULL REFERENCES "DriverSourceCompanyBinding"("id") ON DELETE RESTRICT,
 "actorUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "evidenceSha256" TEXT NOT NULL CHECK ("evidenceSha256" ~ '^[a-f0-9]{64}$'),
 "planSha256" TEXT CHECK ("planSha256" ~ '^[a-f0-9]{64}$'),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "DriverSourceCompanyBindingEvent_bindingId_idx" ON "DriverSourceCompanyBindingEvent"("bindingId");
CREATE TABLE "DriverSourceProfile" (
 "id" TEXT PRIMARY KEY,
 "provider" TEXT NOT NULL CHECK ("provider" = 'QUICKMANAGE'),
 "accountKey" TEXT NOT NULL,
 "operatingGroupId" TEXT NOT NULL REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT,
 "providerCompanyId" TEXT NOT NULL,
 "providerDriverId" TEXT NOT NULL,
 "companyId" TEXT NOT NULL REFERENCES "Company"("id") ON DELETE RESTRICT,
 "driverId" TEXT UNIQUE REFERENCES "Driver"("id") ON DELETE RESTRICT,
 "firstName" TEXT, "middleName" TEXT, "lastName" TEXT, "fullName" TEXT,
 "lifecycleStatus" TEXT, "hireDateRaw" TEXT, "terminationDateRaw" TEXT, "rehireDateRaw" TEXT,
 "compensationType" TEXT NOT NULL CHECK ("compensationType" IN ('PC','PPM','FP','UNKNOWN')),
 "compensationAmount" TEXT,
 "source" JSONB NOT NULL,
 "sourceHash" TEXT NOT NULL CHECK ("sourceHash" ~ '^[a-f0-9]{64}$'),
 "evidenceSha256" TEXT NOT NULL CHECK ("evidenceSha256" ~ '^[a-f0-9]{64}$'),
 "mappingEvidence" TEXT NOT NULL REFERENCES "DriverSourceCompanyBinding"("id") ON DELETE RESTRICT,
 "actorUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "driver_source_identity_key" UNIQUE ("provider", "accountKey", "providerCompanyId", "providerDriverId")
);
CREATE INDEX "DriverSourceProfile_companyId_lifecycleStatus_id_idx" ON "DriverSourceProfile"("companyId","lifecycleStatus","id");
CREATE TABLE "DriverSourceImportEvent" (
 "id" TEXT PRIMARY KEY,
 "profileId" TEXT NOT NULL REFERENCES "DriverSourceProfile"("id") ON DELETE RESTRICT,
 "actorUserId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE RESTRICT,
 "evidenceSha256" TEXT NOT NULL,
 "sourceHash" TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "DriverSourceImportEvent_profileId_idx" ON "DriverSourceImportEvent"("profileId");
CREATE FUNCTION driver_source_mapping_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "DriverSourceCompanyBinding" a WHERE a.id=NEW."mappingEvidence" AND a.provider=NEW.provider AND a."accountKey"=NEW."accountKey" AND a."providerCompanyId"=NEW."providerCompanyId" AND a."companyId"=NEW."companyId" AND a."operatingGroupId"=NEW."operatingGroupId") THEN
  RAISE EXCEPTION 'Driver source mapping scope mismatch';
 END IF;
 IF NEW."driverId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "Driver" d WHERE d.id=NEW."driverId" AND d."companyId"=NEW."companyId") THEN
  RAISE EXCEPTION 'Driver source legacy binding company mismatch';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER driver_source_mapping_guard BEFORE INSERT ON "DriverSourceProfile" FOR EACH ROW EXECUTE FUNCTION driver_source_mapping_guard();
CREATE FUNCTION driver_source_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Driver source evidence is immutable; corrections require reviewed migration'; END;
$$;
CREATE TRIGGER driver_source_profile_immutable BEFORE UPDATE OR DELETE ON "DriverSourceProfile" FOR EACH ROW EXECUTE FUNCTION driver_source_immutable();
CREATE TRIGGER driver_source_event_immutable BEFORE UPDATE OR DELETE ON "DriverSourceImportEvent" FOR EACH ROW EXECUTE FUNCTION driver_source_immutable();
CREATE TRIGGER driver_source_company_binding_immutable BEFORE UPDATE OR DELETE ON "DriverSourceCompanyBinding" FOR EACH ROW EXECUTE FUNCTION driver_source_immutable();
CREATE TRIGGER driver_source_company_event_immutable BEFORE UPDATE OR DELETE ON "DriverSourceCompanyBindingEvent" FOR EACH ROW EXECUTE FUNCTION driver_source_immutable();
CREATE FUNCTION driver_source_company_scope_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM "OperatingGroupCompany" g WHERE g."companyId"=NEW."companyId" AND g."operatingGroupId"=NEW."operatingGroupId") THEN
  RAISE EXCEPTION 'Driver source company group mismatch';
 END IF;
 IF NOT EXISTS (SELECT 1 FROM "CompanyMembership" m JOIN "User" u ON u.id=m."userId" WHERE m."companyId"=NEW."companyId" AND m."userId"=NEW."actorUserId" AND m.role='OWNER' AND u."isActive"=true) THEN
  RAISE EXCEPTION 'Driver source company actor denied';
 END IF;
 IF NEW.origin='ARCHIVE' AND NOT EXISTS (SELECT 1 FROM "ArchiveCompany" a WHERE a.id=NEW."archiveCompanyId" AND a.provider=NEW.provider AND a."accountKey"=NEW."accountKey" AND a."providerCompanyId"=NEW."providerCompanyId" AND a."companyId"=NEW."companyId" AND a."operatingGroupId"=NEW."operatingGroupId") THEN
  RAISE EXCEPTION 'Driver source archive evidence mismatch';
 END IF;
 IF NEW.origin='PROVISIONED' AND NOT EXISTS (SELECT 1 FROM "OperatingGroupMembership" g WHERE g."userId"=NEW."actorUserId" AND g."operatingGroupId"=NEW."operatingGroupId" AND g.role='OWNER') THEN
  RAISE EXCEPTION 'Driver source provision group actor denied';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER driver_source_company_scope_guard BEFORE INSERT ON "DriverSourceCompanyBinding" FOR EACH ROW EXECUTE FUNCTION driver_source_company_scope_guard();
