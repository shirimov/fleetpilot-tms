-- CreateEnum
CREATE TYPE "FinancialSourceType" AS ENUM ('BANK_ACCOUNT', 'CREDIT_CARD', 'FUEL_CARD', 'TOLL_ACCOUNT', 'TMS_SETTLEMENT', 'CUSTOMER_SETTLEMENT', 'OWNER_SETTLEMENT', 'CASH', 'OTHER');

-- CreateEnum
CREATE TYPE "FinancialStatementType" AS ENUM ('BANK_STATEMENT', 'CREDIT_CARD_STATEMENT', 'FUEL_STATEMENT', 'TOLL_STATEMENT', 'TMS_SETTLEMENT', 'CUSTOMER_SETTLEMENT', 'OWNER_SETTLEMENT', 'REPAIR_INVOICE', 'INSURANCE_STATEMENT', 'OTHER');

-- CreateEnum
CREATE TYPE "FinancialImportStatus" AS ENUM ('UPLOADED', 'IMPORTING', 'IMPORTED', 'NEEDS_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "FinancialImportRecordStatus" AS ENUM ('UNREVIEWED', 'MATCHED', 'PARTIALLY_MATCHED', 'DUPLICATE_SUSPECTED', 'NEEDS_REVIEW');

-- CreateEnum
CREATE TYPE "FinancialDirection" AS ENUM ('INFLOW', 'OUTFLOW');

-- CreateEnum
CREATE TYPE "FinancialTransactionStatus" AS ENUM ('DRAFT', 'POSTED', 'VOIDED');

-- CreateEnum
CREATE TYPE "FinancialReconciliationStatus" AS ENUM ('UNREVIEWED', 'MATCHED', 'PARTIALLY_MATCHED', 'UNMATCHED', 'MISSING_EXPECTED', 'DUPLICATE_SUSPECTED', 'NEEDS_REVIEW', 'RECONCILED');

-- CreateEnum
CREATE TYPE "FinancialMatchMethod" AS ENUM ('EXACT', 'PARTIAL', 'SPLIT', 'MANUAL', 'SUGGESTED');

-- CreateEnum
CREATE TYPE "FinancialEvidenceRole" AS ENUM ('PRIMARY', 'CORROBORATING');

-- CreateEnum
CREATE TYPE "FinancialCategoryType" AS ENUM ('INCOME', 'DIRECT_EXPENSE', 'EQUIPMENT_FINANCING', 'OVERHEAD', 'OTHER');

-- CreateEnum
CREATE TYPE "FinancialPartyType" AS ENUM ('VENDOR', 'OWNER_OPERATOR', 'OTHER');

-- CreateEnum
CREATE TYPE "FinancialRecoveryStatus" AS ENUM ('NOT_APPLICABLE', 'EXPECTED', 'PARTIALLY_RECOVERED', 'RECOVERED', 'WAIVED');

-- CreateEnum
CREATE TYPE "FinancialExpectationStatus" AS ENUM ('OPEN', 'PARTIALLY_MATCHED', 'MATCHED', 'MISSING', 'CANCELLED');

-- CreateEnum
CREATE TYPE "FinancialDataStatus" AS ENUM ('RAW', 'NORMALIZED', 'REVIEWED', 'VERIFIED');

-- CreateTable
CREATE TABLE "OperatingGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatingGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperatingGroupCompany" (
    "operatingGroupId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatingGroupCompany_pkey" PRIMARY KEY ("operatingGroupId","companyId")
);

-- CreateTable
CREATE TABLE "OperatingGroupMembership" (
    "operatingGroupId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "CompanyMembershipRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OperatingGroupMembership_pkey" PRIMARY KEY ("operatingGroupId","userId")
);

-- CreateTable
CREATE TABLE "FinancialSource" (
    "id" TEXT NOT NULL,
    "operatingGroupId" TEXT NOT NULL,
    "companyId" TEXT,
    "name" TEXT NOT NULL,
    "type" "FinancialSourceType" NOT NULL,
    "institution" TEXT,
    "provider" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "lastFour" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialStatement" (
    "id" TEXT NOT NULL,
    "operatingGroupId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "type" "FinancialStatementType" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "statementDate" TIMESTAMP(3),
    "originalFilename" TEXT NOT NULL,
    "displayFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT NOT NULL,
    "importStatus" "FinancialImportStatus" NOT NULL DEFAULT 'UPLOADED',
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "sourceTotalMinor" BIGINT,
    "importedRowCount" INTEGER NOT NULL DEFAULT 0,
    "matchedRowCount" INTEGER NOT NULL DEFAULT 0,
    "unresolvedRowCount" INTEGER NOT NULL DEFAULT 0,
    "importedByUserId" TEXT NOT NULL,
    "importedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialStatement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialImportRecord" (
    "id" TEXT NOT NULL,
    "statementId" TEXT NOT NULL,
    "sourceRowIndex" INTEGER NOT NULL,
    "rawDescription" TEXT,
    "rawDate" TEXT,
    "rawAmount" TEXT,
    "rawReference" TEXT,
    "rawMetadata" JSONB,
    "candidateDate" TIMESTAMP(3),
    "candidateAmountMinor" BIGINT,
    "candidateDirection" "FinancialDirection",
    "candidateDescription" TEXT,
    "fingerprintSha256" TEXT NOT NULL,
    "status" "FinancialImportRecordStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialImportRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialCategory" (
    "id" TEXT NOT NULL,
    "operatingGroupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinancialCategoryType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isSystemDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialParty" (
    "id" TEXT NOT NULL,
    "operatingGroupId" TEXT NOT NULL,
    "companyId" TEXT,
    "type" "FinancialPartyType" NOT NULL,
    "name" TEXT NOT NULL,
    "externalReference" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialParty_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialTransaction" (
    "id" TEXT NOT NULL,
    "operatingGroupId" TEXT NOT NULL,
    "companyId" TEXT,
    "sourceId" TEXT,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "direction" "FinancialDirection" NOT NULL,
    "description" TEXT NOT NULL,
    "categoryId" TEXT,
    "vendorId" TEXT,
    "ownerId" TEXT,
    "customerId" TEXT,
    "status" "FinancialTransactionStatus" NOT NULL DEFAULT 'DRAFT',
    "reconciliationStatus" "FinancialReconciliationStatus" NOT NULL DEFAULT 'UNREVIEWED',
    "dataStatus" "FinancialDataStatus" NOT NULL DEFAULT 'NORMALIZED',
    "memo" TEXT,
    "reference" TEXT,
    "fingerprintSha256" TEXT,
    "recoverableFromOwner" BOOLEAN NOT NULL DEFAULT false,
    "expectedRecoveryMinor" BIGINT NOT NULL DEFAULT 0,
    "recoveredAmountMinor" BIGINT NOT NULL DEFAULT 0,
    "recoveryStatus" "FinancialRecoveryStatus" NOT NULL DEFAULT 'NOT_APPLICABLE',
    "createdByUserId" TEXT NOT NULL,
    "reviewedByUserId" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialTransactionEvidence" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "importRecordId" TEXT NOT NULL,
    "matchedAmountMinor" BIGINT NOT NULL,
    "method" "FinancialMatchMethod" NOT NULL,
    "role" "FinancialEvidenceRole" NOT NULL DEFAULT 'PRIMARY',
    "confidenceBasisPoints" INTEGER,
    "matchedByUserId" TEXT NOT NULL,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialTransactionEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAllocation" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "companyId" TEXT,
    "truckId" TEXT,
    "trailerId" TEXT,
    "driverId" TEXT,
    "employeeId" TEXT,
    "loadId" TEXT,
    "customerId" TEXT,
    "partyId" TEXT,
    "businessType" TEXT,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialExpectation" (
    "id" TEXT NOT NULL,
    "operatingGroupId" TEXT NOT NULL,
    "companyId" TEXT,
    "sourceId" TEXT,
    "customerId" TEXT,
    "partyId" TEXT,
    "loadId" TEXT,
    "truckId" TEXT,
    "expectedAmountMinor" BIGINT NOT NULL,
    "matchedAmountMinor" BIGINT NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "direction" "FinancialDirection" NOT NULL,
    "description" TEXT NOT NULL,
    "expectedDateStart" TIMESTAMP(3) NOT NULL,
    "expectedDateEnd" TIMESTAMP(3) NOT NULL,
    "reference" TEXT,
    "status" "FinancialExpectationStatus" NOT NULL DEFAULT 'OPEN',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialExpectation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialExpectationMatch" (
    "id" TEXT NOT NULL,
    "expectationId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "matchedAmountMinor" BIGINT NOT NULL,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialExpectationMatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAuditEvent" (
    "id" TEXT NOT NULL,
    "operatingGroupId" TEXT NOT NULL,
    "companyId" TEXT,
    "transactionId" TEXT,
    "action" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OperatingGroupCompany_companyId_key" ON "OperatingGroupCompany"("companyId");

-- CreateIndex
CREATE INDEX "OperatingGroupCompany_operatingGroupId_idx" ON "OperatingGroupCompany"("operatingGroupId");

-- CreateIndex
CREATE INDEX "OperatingGroupMembership_userId_role_idx" ON "OperatingGroupMembership"("userId", "role");

-- CreateIndex
CREATE INDEX "FinancialSource_operatingGroupId_type_isActive_idx" ON "FinancialSource"("operatingGroupId", "type", "isActive");

-- CreateIndex
CREATE INDEX "FinancialSource_companyId_idx" ON "FinancialSource"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialSource_operatingGroupId_name_key" ON "FinancialSource"("operatingGroupId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialStatement_storageKey_key" ON "FinancialStatement"("storageKey");

-- CreateIndex
CREATE INDEX "FinancialStatement_operatingGroupId_createdAt_idx" ON "FinancialStatement"("operatingGroupId", "createdAt");

-- CreateIndex
CREATE INDEX "FinancialStatement_sourceId_periodStart_periodEnd_idx" ON "FinancialStatement"("sourceId", "periodStart", "periodEnd");

-- CreateIndex
CREATE INDEX "FinancialStatement_importStatus_createdAt_idx" ON "FinancialStatement"("importStatus", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialStatement_operatingGroupId_checksumSha256_key" ON "FinancialStatement"("operatingGroupId", "checksumSha256");

-- CreateIndex
CREATE INDEX "FinancialImportRecord_statementId_status_idx" ON "FinancialImportRecord"("statementId", "status");

-- CreateIndex
CREATE INDEX "FinancialImportRecord_fingerprintSha256_idx" ON "FinancialImportRecord"("fingerprintSha256");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialImportRecord_statementId_sourceRowIndex_key" ON "FinancialImportRecord"("statementId", "sourceRowIndex");

-- CreateIndex
CREATE INDEX "FinancialCategory_operatingGroupId_type_isActive_idx" ON "FinancialCategory"("operatingGroupId", "type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialCategory_operatingGroupId_name_key" ON "FinancialCategory"("operatingGroupId", "name");

-- CreateIndex
CREATE INDEX "FinancialParty_companyId_type_idx" ON "FinancialParty"("companyId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialParty_operatingGroupId_type_name_key" ON "FinancialParty"("operatingGroupId", "type", "name");

-- CreateIndex
CREATE INDEX "FinancialTransaction_operatingGroupId_transactionDate_idx" ON "FinancialTransaction"("operatingGroupId", "transactionDate");

-- CreateIndex
CREATE INDEX "FinancialTransaction_companyId_transactionDate_idx" ON "FinancialTransaction"("companyId", "transactionDate");

-- CreateIndex
CREATE INDEX "FinancialTransaction_reconciliationStatus_transactionDate_idx" ON "FinancialTransaction"("reconciliationStatus", "transactionDate");

-- CreateIndex
CREATE INDEX "FinancialTransaction_categoryId_transactionDate_idx" ON "FinancialTransaction"("categoryId", "transactionDate");

-- CreateIndex
CREATE INDEX "FinancialTransaction_fingerprintSha256_idx" ON "FinancialTransaction"("fingerprintSha256");

-- CreateIndex
CREATE INDEX "FinancialTransactionEvidence_importRecordId_matchedAt_idx" ON "FinancialTransactionEvidence"("importRecordId", "matchedAt");

-- CreateIndex
CREATE INDEX "FinancialTransactionEvidence_transactionId_matchedAt_idx" ON "FinancialTransactionEvidence"("transactionId", "matchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialTransactionEvidence_transactionId_importRecordId_key" ON "FinancialTransactionEvidence"("transactionId", "importRecordId");

-- CreateIndex
CREATE INDEX "FinancialAllocation_transactionId_idx" ON "FinancialAllocation"("transactionId");

-- CreateIndex
CREATE INDEX "FinancialAllocation_categoryId_idx" ON "FinancialAllocation"("categoryId");

-- CreateIndex
CREATE INDEX "FinancialAllocation_companyId_idx" ON "FinancialAllocation"("companyId");

-- CreateIndex
CREATE INDEX "FinancialAllocation_truckId_idx" ON "FinancialAllocation"("truckId");

-- CreateIndex
CREATE INDEX "FinancialAllocation_trailerId_idx" ON "FinancialAllocation"("trailerId");

-- CreateIndex
CREATE INDEX "FinancialAllocation_driverId_idx" ON "FinancialAllocation"("driverId");

-- CreateIndex
CREATE INDEX "FinancialAllocation_employeeId_idx" ON "FinancialAllocation"("employeeId");

-- CreateIndex
CREATE INDEX "FinancialAllocation_loadId_idx" ON "FinancialAllocation"("loadId");

-- CreateIndex
CREATE INDEX "FinancialAllocation_customerId_idx" ON "FinancialAllocation"("customerId");

-- CreateIndex
CREATE INDEX "FinancialAllocation_partyId_idx" ON "FinancialAllocation"("partyId");

-- CreateIndex
CREATE INDEX "FinancialExpectation_operatingGroupId_status_expectedDateSt_idx" ON "FinancialExpectation"("operatingGroupId", "status", "expectedDateStart");

-- CreateIndex
CREATE INDEX "FinancialExpectation_companyId_expectedDateStart_idx" ON "FinancialExpectation"("companyId", "expectedDateStart");

-- CreateIndex
CREATE INDEX "FinancialExpectation_customerId_idx" ON "FinancialExpectation"("customerId");

-- CreateIndex
CREATE INDEX "FinancialExpectation_partyId_idx" ON "FinancialExpectation"("partyId");

-- CreateIndex
CREATE INDEX "FinancialExpectation_loadId_idx" ON "FinancialExpectation"("loadId");

-- CreateIndex
CREATE INDEX "FinancialExpectationMatch_transactionId_idx" ON "FinancialExpectationMatch"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialExpectationMatch_expectationId_transactionId_key" ON "FinancialExpectationMatch"("expectationId", "transactionId");

-- CreateIndex
CREATE INDEX "FinancialAuditEvent_operatingGroupId_occurredAt_id_idx" ON "FinancialAuditEvent"("operatingGroupId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "FinancialAuditEvent_transactionId_occurredAt_id_idx" ON "FinancialAuditEvent"("transactionId", "occurredAt", "id");

-- CreateIndex
CREATE INDEX "FinancialAuditEvent_actorUserId_occurredAt_id_idx" ON "FinancialAuditEvent"("actorUserId", "occurredAt", "id");

-- AddForeignKey
ALTER TABLE "OperatingGroupCompany" ADD CONSTRAINT "OperatingGroupCompany_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingGroupCompany" ADD CONSTRAINT "OperatingGroupCompany_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingGroupMembership" ADD CONSTRAINT "OperatingGroupMembership_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperatingGroupMembership" ADD CONSTRAINT "OperatingGroupMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialSource" ADD CONSTRAINT "FinancialSource_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialSource" ADD CONSTRAINT "FinancialSource_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialStatement" ADD CONSTRAINT "FinancialStatement_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialStatement" ADD CONSTRAINT "FinancialStatement_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "FinancialSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialStatement" ADD CONSTRAINT "FinancialStatement_importedByUserId_fkey" FOREIGN KEY ("importedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialImportRecord" ADD CONSTRAINT "FinancialImportRecord_statementId_fkey" FOREIGN KEY ("statementId") REFERENCES "FinancialStatement"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialCategory" ADD CONSTRAINT "FinancialCategory_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialParty" ADD CONSTRAINT "FinancialParty_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialParty" ADD CONSTRAINT "FinancialParty_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "FinancialSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "FinancialParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "FinancialParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransaction" ADD CONSTRAINT "FinancialTransaction_reviewedByUserId_fkey" FOREIGN KEY ("reviewedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransactionEvidence" ADD CONSTRAINT "FinancialTransactionEvidence_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinancialTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransactionEvidence" ADD CONSTRAINT "FinancialTransactionEvidence_importRecordId_fkey" FOREIGN KEY ("importRecordId") REFERENCES "FinancialImportRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialTransactionEvidence" ADD CONSTRAINT "FinancialTransactionEvidence_matchedByUserId_fkey" FOREIGN KEY ("matchedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAllocation" ADD CONSTRAINT "FinancialAllocation_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinancialTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAllocation" ADD CONSTRAINT "FinancialAllocation_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAllocation" ADD CONSTRAINT "FinancialAllocation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAllocation" ADD CONSTRAINT "FinancialAllocation_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAllocation" ADD CONSTRAINT "FinancialAllocation_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAllocation" ADD CONSTRAINT "FinancialAllocation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAllocation" ADD CONSTRAINT "FinancialAllocation_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAllocation" ADD CONSTRAINT "FinancialAllocation_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAllocation" ADD CONSTRAINT "FinancialAllocation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAllocation" ADD CONSTRAINT "FinancialAllocation_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "FinancialParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialExpectation" ADD CONSTRAINT "FinancialExpectation_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialExpectation" ADD CONSTRAINT "FinancialExpectation_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialExpectation" ADD CONSTRAINT "FinancialExpectation_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "FinancialSource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialExpectation" ADD CONSTRAINT "FinancialExpectation_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialExpectation" ADD CONSTRAINT "FinancialExpectation_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "FinancialParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialExpectation" ADD CONSTRAINT "FinancialExpectation_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialExpectation" ADD CONSTRAINT "FinancialExpectation_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialExpectation" ADD CONSTRAINT "FinancialExpectation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialExpectationMatch" ADD CONSTRAINT "FinancialExpectationMatch_expectationId_fkey" FOREIGN KEY ("expectationId") REFERENCES "FinancialExpectation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialExpectationMatch" ADD CONSTRAINT "FinancialExpectationMatch_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinancialTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "FinancialTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAuditEvent" ADD CONSTRAINT "FinancialAuditEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Money is stored as positive integer minor units; direction is explicit.
ALTER TABLE "FinancialStatement"
  ADD CONSTRAINT "FinancialStatement_period_check" CHECK ("periodEnd" >= "periodStart"),
  ADD CONSTRAINT "FinancialStatement_size_check" CHECK ("byteSize" > 0 AND "byteSize" <= 20971520),
  ADD CONSTRAINT "FinancialStatement_counts_check" CHECK ("importedRowCount" >= 0 AND "matchedRowCount" >= 0 AND "unresolvedRowCount" >= 0),
  ADD CONSTRAINT "FinancialStatement_sourceTotalMinor_check" CHECK ("sourceTotalMinor" IS NULL OR "sourceTotalMinor" >= 0);

ALTER TABLE "FinancialImportRecord"
  ADD CONSTRAINT "FinancialImportRecord_row_check" CHECK ("sourceRowIndex" >= 0),
  ADD CONSTRAINT "FinancialImportRecord_candidateAmountMinor_check" CHECK ("candidateAmountMinor" IS NULL OR "candidateAmountMinor" > 0);

ALTER TABLE "FinancialTransaction"
  ADD CONSTRAINT "FinancialTransaction_amountMinor_check" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "FinancialTransaction_recovery_check" CHECK (
    "expectedRecoveryMinor" >= 0 AND "recoveredAmountMinor" >= 0 AND
    "recoveredAmountMinor" <= "expectedRecoveryMinor" AND
    ("recoverableFromOwner" OR ("expectedRecoveryMinor" = 0 AND "recoveredAmountMinor" = 0))
  );

ALTER TABLE "FinancialTransactionEvidence"
  ADD CONSTRAINT "FinancialTransactionEvidence_amount_check" CHECK ("matchedAmountMinor" > 0),
  ADD CONSTRAINT "FinancialTransactionEvidence_confidence_check" CHECK ("confidenceBasisPoints" IS NULL OR "confidenceBasisPoints" BETWEEN 0 AND 10000);

ALTER TABLE "FinancialAllocation" ADD CONSTRAINT "FinancialAllocation_amount_check" CHECK ("amountMinor" > 0);

ALTER TABLE "FinancialExpectation"
  ADD CONSTRAINT "FinancialExpectation_amount_check" CHECK ("expectedAmountMinor" > 0 AND "matchedAmountMinor" >= 0 AND "matchedAmountMinor" <= "expectedAmountMinor"),
  ADD CONSTRAINT "FinancialExpectation_window_check" CHECK ("expectedDateEnd" >= "expectedDateStart");

ALTER TABLE "FinancialExpectationMatch" ADD CONSTRAINT "FinancialExpectationMatch_amount_check" CHECK ("matchedAmountMinor" > 0);
