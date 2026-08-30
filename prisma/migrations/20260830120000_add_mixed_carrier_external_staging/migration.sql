CREATE TYPE "ExternalSyncBatchScope" AS ENUM ('COMPANY', 'ACCOUNT');

ALTER TYPE "ExternalSyncDisposition" ADD VALUE 'UNRESOLVED_COMPANY';
ALTER TYPE "ExternalSyncBatchStatus" ADD VALUE 'PARTIALLY_APPLIED';

ALTER TABLE "ExternalSyncBatch"
  ALTER COLUMN "companyId" DROP NOT NULL,
  ADD COLUMN "scope" "ExternalSyncBatchScope" NOT NULL DEFAULT 'COMPANY',
  ADD COLUMN "sourceAdapter" TEXT NOT NULL DEFAULT 'QUICKMANAGE_OFFICIAL_API',
  ADD COLUMN "unresolvedCompanyRows" INTEGER NOT NULL DEFAULT 0,
  ADD CONSTRAINT "ExternalSyncBatch_scope_company_check" CHECK (
    ("scope" = 'COMPANY' AND "companyId" IS NOT NULL) OR
    ("scope" = 'ACCOUNT' AND "companyId" IS NULL)
  );

ALTER TABLE "ExternalProviderAccountMapping" ADD COLUMN "notes" TEXT;
DROP INDEX "ExternalProviderAccountMapping_companyId_provider_key";
CREATE UNIQUE INDEX "ExternalProviderAccountMapping_companyId_provider_externalAccountId_key"
  ON "ExternalProviderAccountMapping"("companyId", "provider", "externalAccountId");

ALTER TABLE "ExternalSyncRow"
  ADD COLUMN "sourceAdapter" TEXT NOT NULL DEFAULT 'QUICKMANAGE_OFFICIAL_API',
  ADD COLUMN "externalCarrierId" TEXT,
  ADD COLUMN "externalCarrierName" TEXT,
  ADD COLUMN "resolvedCompanyId" TEXT,
  ADD COLUMN "mappingVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

ALTER TABLE "ExternalSyncRow" ADD CONSTRAINT "ExternalSyncRow_resolvedCompanyId_fkey"
  FOREIGN KEY ("resolvedCompanyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "ExternalSyncRow_batchId_externalCarrierId_idx" ON "ExternalSyncRow"("batchId", "externalCarrierId");
CREATE INDEX "ExternalSyncRow_resolvedCompanyId_disposition_idx" ON "ExternalSyncRow"("resolvedCompanyId", "disposition");
