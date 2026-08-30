-- Provider-neutral external account identity mapping.
-- The nullable batch columns keep pre-existing previews readable while making
-- new single-resource previews explicit.
CREATE TYPE "ExternalAccountIdentityStatus" AS ENUM ('VERIFIED', 'UNVERIFIED', 'MISMATCH');

ALTER TABLE "ExternalSyncBatch"
  ADD COLUMN "resourceType" "ExternalSyncResourceType",
  ADD COLUMN "fleetPilotRecordCount" INTEGER;

CREATE TABLE "ExternalProviderAccountMapping" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "externalAccountId" TEXT,
  "externalDisplayName" TEXT,
  "identityStatus" "ExternalAccountIdentityStatus" NOT NULL DEFAULT 'UNVERIFIED',
  "isEnabled" BOOLEAN NOT NULL DEFAULT false,
  "verifiedAt" TIMESTAMP(3),
  "verifiedByUserId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ExternalProviderAccountMapping_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalProviderAccountMapping_verified_identity_check" CHECK (
    "identityStatus" <> 'VERIFIED'
    OR (
      "isEnabled" = true
      AND NULLIF(BTRIM("externalAccountId"), '') IS NOT NULL
      AND NULLIF(BTRIM("externalDisplayName"), '') IS NOT NULL
      AND "verifiedAt" IS NOT NULL
      AND "verifiedByUserId" IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX "ExternalProviderAccountMapping_companyId_provider_key"
  ON "ExternalProviderAccountMapping"("companyId", "provider");
CREATE UNIQUE INDEX "ExternalProviderAccountMapping_provider_externalAccountId_key"
  ON "ExternalProviderAccountMapping"("provider", "externalAccountId");
CREATE INDEX "ExternalProviderAccountMapping_provider_identityStatus_isEnabled_idx"
  ON "ExternalProviderAccountMapping"("provider", "identityStatus", "isEnabled");
CREATE INDEX "ExternalProviderAccountMapping_verifiedByUserId_idx"
  ON "ExternalProviderAccountMapping"("verifiedByUserId");

ALTER TABLE "ExternalProviderAccountMapping"
  ADD CONSTRAINT "ExternalProviderAccountMapping_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalProviderAccountMapping"
  ADD CONSTRAINT "ExternalProviderAccountMapping_verifiedByUserId_fkey"
  FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
