-- Provider-neutral bank connection and transaction inbox foundation.
-- Existing Plaid data is retained and backfilled before the new identity indexes are created.

CREATE TYPE "BankConnectionProvider" AS ENUM ('PLAID', 'FILE_IMPORT', 'OTHER');
CREATE TYPE "BankConnectionStatus" AS ENUM ('ACTIVE', 'ERROR', 'REQUIRES_REAUTH', 'DISABLED', 'REVOKED');
CREATE TYPE "BankTransactionLifecycle" AS ENUM ('PENDING', 'POSTED', 'REMOVED');
CREATE TYPE "BankTransactionReviewStatus" AS ENUM ('UNREVIEWED', 'SUGGESTED', 'REVIEWED', 'NEEDS_REVIEW', 'IGNORED');
CREATE TYPE "BankClassificationScope" AS ENUM ('COMPANY_LEVEL', 'ENTITY_ALLOCATED');
CREATE TYPE "BankReconciliationStatus" AS ENUM ('NOT_APPLICABLE', 'UNMATCHED', 'PARTIALLY_MATCHED', 'MATCHED', 'DISCREPANCY');

ALTER TABLE "BankAccount" DROP CONSTRAINT "BankAccount_companyId_fkey";
ALTER TABLE "BankTransaction" DROP CONSTRAINT "BankTransaction_subAccountId_fkey";

ALTER TABLE "BankAccount"
  ADD COLUMN "accessTokenCiphertext" TEXT,
  ADD COLUMN "consentMetadata" JSONB,
  ADD COLUMN "disabledAt" TIMESTAMP(3),
  ADD COLUMN "externalConnectionId" TEXT,
  ADD COLUMN "lastSyncAttemptAt" TIMESTAMP(3),
  ADD COLUMN "lastSyncErrorCode" TEXT,
  ADD COLUMN "lastSyncErrorMessage" TEXT,
  ADD COLUMN "provider" "BankConnectionProvider" NOT NULL DEFAULT 'PLAID',
  ADD COLUMN "revokedAt" TIMESTAMP(3),
  ADD COLUMN "status" "BankConnectionStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "syncCursor" TEXT,
  ALTER COLUMN "plaidItemId" DROP NOT NULL,
  ALTER COLUMN "plaidAccessToken" DROP NOT NULL;

ALTER TABLE "BankSubAccount"
  ADD COLUMN "availableBalanceMinor" BIGINT,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN "currentBalanceMinor" BIGINT,
  ADD COLUMN "externalAccountId" TEXT,
  ADD COLUMN "institutionName" TEXT,
  ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
  ALTER COLUMN "plaidAccountId" DROP NOT NULL;

ALTER TABLE "BankTransaction"
  ADD COLUMN "amountMinor" BIGINT,
  ADD COLUMN "authorizedDate" DATE,
  ADD COLUMN "checkNumber" TEXT,
  ADD COLUMN "companyId" TEXT,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN "direction" "FinancialDirection",
  ADD COLUMN "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "lifecycle" "BankTransactionLifecycle" NOT NULL DEFAULT 'POSTED',
  ADD COLUMN "location" JSONB,
  ADD COLUMN "originalDescription" TEXT,
  ADD COLUMN "postedDate" DATE,
  ADD COLUMN "providerAmountText" TEXT,
  ADD COLUMN "providerCategory" JSONB,
  ADD COLUMN "providerPendingTransactionId" TEXT,
  ADD COLUMN "providerTransactionId" TEXT,
  ADD COLUMN "referenceNumber" TEXT,
  ADD COLUMN "removedAt" TIMESTAMP(3),
  ADD COLUMN "sourceHashSha256" TEXT,
  ADD COLUMN "sourceMetadata" JSONB,
  ALTER COLUMN "plaidTransactionId" DROP NOT NULL;

ALTER TABLE "FinancialAuditEvent" ADD COLUMN "bankTransactionId" TEXT;

UPDATE "BankAccount"
SET "externalConnectionId" = "plaidItemId"
WHERE "externalConnectionId" IS NULL AND "plaidItemId" IS NOT NULL;

UPDATE "BankSubAccount"
SET "externalAccountId" = "plaidAccountId",
    "currentBalanceMinor" = CASE WHEN "currentBalance" IS NULL THEN NULL ELSE ROUND("currentBalance"::numeric * 100)::bigint END,
    "availableBalanceMinor" = CASE WHEN "availableBalance" IS NULL THEN NULL ELSE ROUND("availableBalance"::numeric * 100)::bigint END
WHERE "externalAccountId" IS NULL;

UPDATE "BankTransaction" AS transaction
SET "companyId" = account."companyId",
    "providerTransactionId" = transaction."plaidTransactionId",
    "amountMinor" = ROUND(ABS(transaction."amount")::numeric * 100)::bigint,
    "providerAmountText" = transaction."amount"::text,
    "direction" = CASE WHEN transaction."amount" < 0 THEN 'INFLOW'::"FinancialDirection" ELSE 'OUTFLOW'::"FinancialDirection" END,
    "originalDescription" = transaction."name",
    "postedDate" = transaction."date"::date,
    "lifecycle" = CASE WHEN transaction."pending" THEN 'PENDING'::"BankTransactionLifecycle" ELSE 'POSTED'::"BankTransactionLifecycle" END
FROM "BankAccount" AS account
WHERE transaction."bankAccountId" = account."id";

CREATE TABLE "BankTransactionExternalId" (
  "id" TEXT NOT NULL,
  "bankAccountId" TEXT NOT NULL,
  "bankTransactionId" TEXT NOT NULL,
  "externalId" TEXT NOT NULL,
  "isCurrent" BOOLEAN NOT NULL DEFAULT true,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankTransactionExternalId_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankTransactionClassification" (
  "id" TEXT NOT NULL,
  "bankTransactionId" TEXT NOT NULL,
  "categoryId" TEXT,
  "scope" "BankClassificationScope" NOT NULL DEFAULT 'COMPANY_LEVEL',
  "reviewStatus" "BankTransactionReviewStatus" NOT NULL DEFAULT 'UNREVIEWED',
  "reconciliationStatus" "BankReconciliationStatus" NOT NULL DEFAULT 'UNMATCHED',
  "notes" TEXT,
  "suggestionReason" TEXT,
  "reviewedByUserId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankTransactionClassification_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BankTransactionAllocation" (
  "id" TEXT NOT NULL,
  "bankTransactionId" TEXT NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "categoryId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "truckId" TEXT,
  "trailerId" TEXT,
  "driverId" TEXT,
  "partyId" TEXT,
  "memo" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BankTransactionAllocation_pkey" PRIMARY KEY ("id")
);

INSERT INTO "BankTransactionExternalId" ("id", "bankAccountId", "bankTransactionId", "externalId")
SELECT 'legacy-bank-id-' || md5("id"), "bankAccountId", "id", "plaidTransactionId"
FROM "BankTransaction"
WHERE "plaidTransactionId" IS NOT NULL;

INSERT INTO "BankTransactionClassification" ("id", "bankTransactionId")
SELECT 'legacy-bank-class-' || md5("id"), "id" FROM "BankTransaction";

ALTER TABLE "BankTransactionClassification" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "BankTransactionAllocation" ALTER COLUMN "updatedAt" DROP DEFAULT;

CREATE INDEX "BankTransactionExternalId_bankTransactionId_isCurrent_idx" ON "BankTransactionExternalId"("bankTransactionId", "isCurrent");
CREATE UNIQUE INDEX "BankTransactionExternalId_bankAccountId_externalId_key" ON "BankTransactionExternalId"("bankAccountId", "externalId");
CREATE UNIQUE INDEX "BankTransactionClassification_bankTransactionId_key" ON "BankTransactionClassification"("bankTransactionId");
CREATE INDEX "BankTransactionClassification_reviewStatus_updatedAt_idx" ON "BankTransactionClassification"("reviewStatus", "updatedAt");
CREATE INDEX "BankTransactionClassification_categoryId_reviewStatus_idx" ON "BankTransactionClassification"("categoryId", "reviewStatus");
CREATE INDEX "BankTxClass_reconciliation_updated_idx" ON "BankTransactionClassification"("reconciliationStatus", "updatedAt");
CREATE INDEX "BankTransactionAllocation_bankTransactionId_idx" ON "BankTransactionAllocation"("bankTransactionId");
CREATE INDEX "BankTransactionAllocation_categoryId_idx" ON "BankTransactionAllocation"("categoryId");
CREATE INDEX "BankTransactionAllocation_companyId_idx" ON "BankTransactionAllocation"("companyId");
CREATE INDEX "BankTransactionAllocation_truckId_idx" ON "BankTransactionAllocation"("truckId");
CREATE INDEX "BankTransactionAllocation_trailerId_idx" ON "BankTransactionAllocation"("trailerId");
CREATE INDEX "BankTransactionAllocation_driverId_idx" ON "BankTransactionAllocation"("driverId");
CREATE INDEX "BankTransactionAllocation_partyId_idx" ON "BankTransactionAllocation"("partyId");
CREATE INDEX "BankAccount_companyId_status_idx" ON "BankAccount"("companyId", "status");
CREATE UNIQUE INDEX "BankAccount_companyId_provider_externalConnectionId_key" ON "BankAccount"("companyId", "provider", "externalConnectionId");
CREATE INDEX "BankSubAccount_bankAccountId_isActive_idx" ON "BankSubAccount"("bankAccountId", "isActive");
CREATE UNIQUE INDEX "BankSubAccount_bankAccountId_externalAccountId_key" ON "BankSubAccount"("bankAccountId", "externalAccountId");
CREATE INDEX "BankTransaction_companyId_date_id_idx" ON "BankTransaction"("companyId", "date", "id");
CREATE INDEX "BankTransaction_subAccountId_date_id_idx" ON "BankTransaction"("subAccountId", "date", "id");
CREATE INDEX "BankTransaction_lifecycle_date_id_idx" ON "BankTransaction"("lifecycle", "date", "id");
CREATE INDEX "BankTransaction_sourceHashSha256_idx" ON "BankTransaction"("sourceHashSha256");
CREATE UNIQUE INDEX "BankTransaction_bankAccountId_providerTransactionId_key" ON "BankTransaction"("bankAccountId", "providerTransactionId");
CREATE INDEX "FinancialAuditEvent_bankTransactionId_occurredAt_id_idx" ON "FinancialAuditEvent"("bankTransactionId", "occurredAt", "id");

ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransaction" ADD CONSTRAINT "BankTransaction_subAccountId_fkey" FOREIGN KEY ("subAccountId") REFERENCES "BankSubAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransactionExternalId" ADD CONSTRAINT "BankTransactionExternalId_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransactionExternalId" ADD CONSTRAINT "BankTransactionExternalId_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransactionClassification" ADD CONSTRAINT "BankTransactionClassification_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransactionClassification" ADD CONSTRAINT "BankTransactionClassification_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransactionClassification" ADD CONSTRAINT "BankTransactionClassification_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransactionAllocation" ADD CONSTRAINT "BankTransactionAllocation_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransactionAllocation" ADD CONSTRAINT "BankTransactionAllocation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransactionAllocation" ADD CONSTRAINT "BankTransactionAllocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransactionAllocation" ADD CONSTRAINT "BankTransactionAllocation_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransactionAllocation" ADD CONSTRAINT "BankTransactionAllocation_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransactionAllocation" ADD CONSTRAINT "BankTransactionAllocation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankTransactionAllocation" ADD CONSTRAINT "BankTransactionAllocation_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "FinancialParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_bankTransactionId_fkey" FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
