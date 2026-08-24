-- CreateEnum
CREATE TYPE "FinancialProgramType" AS ENUM ('ADMIN', 'SAFETY', 'RECRUITING', 'MAINTENANCE', 'SHOP', 'INSURANCE', 'TRAILER_RENTAL', 'OTHER');

-- CreateEnum
CREATE TYPE "AdminFeeAgreementScope" AS ENUM ('OWNER', 'TRUCK');

-- CreateEnum
CREATE TYPE "AdminFeeFrequency" AS ENUM ('WEEKLY');

-- AlterTable
ALTER TABLE "FinancialAllocation" ADD COLUMN     "programId" TEXT;

-- AlterTable
ALTER TABLE "FinancialCategory" ADD COLUMN     "parentCategoryId" TEXT;

-- CreateTable
CREATE TABLE "FinancialProgram" (
    "id" TEXT NOT NULL,
    "operatingGroupId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "FinancialProgramType" NOT NULL DEFAULT 'OTHER',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminFeeAgreement" (
    "id" TEXT NOT NULL,
    "operatingGroupId" TEXT NOT NULL,
    "scope" "AdminFeeAgreementScope" NOT NULL,
    "ownerPartyId" TEXT,
    "truckId" TEXT,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "frequency" "AdminFeeFrequency" NOT NULL DEFAULT 'WEEKLY',
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AdminFeeAgreement_pkey" PRIMARY KEY ("id")
);

-- Enforce exact positive money, valid date ranges, and mutually-exclusive owner/truck scope.
ALTER TABLE "AdminFeeAgreement"
  ADD CONSTRAINT "AdminFeeAgreement_amount_positive_check" CHECK ("amountMinor" > 0),
  ADD CONSTRAINT "AdminFeeAgreement_date_range_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  ADD CONSTRAINT "AdminFeeAgreement_scope_dimensions_check" CHECK (
    ("scope" = 'OWNER' AND "ownerPartyId" IS NOT NULL AND "truckId" IS NULL)
    OR
    ("scope" = 'TRUCK' AND "truckId" IS NOT NULL AND "ownerPartyId" IS NULL)
  );

-- CreateIndex
CREATE INDEX "FinancialProgram_operatingGroupId_type_isActive_idx" ON "FinancialProgram"("operatingGroupId", "type", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProgram_operatingGroupId_code_key" ON "FinancialProgram"("operatingGroupId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialProgram_operatingGroupId_name_key" ON "FinancialProgram"("operatingGroupId", "name");

-- CreateIndex
CREATE INDEX "AdminFeeAgreement_operatingGroupId_scope_isActive_idx" ON "AdminFeeAgreement"("operatingGroupId", "scope", "isActive");

-- CreateIndex
CREATE INDEX "AdminFeeAgreement_ownerPartyId_effectiveFrom_effectiveTo_idx" ON "AdminFeeAgreement"("ownerPartyId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "AdminFeeAgreement_truckId_effectiveFrom_effectiveTo_idx" ON "AdminFeeAgreement"("truckId", "effectiveFrom", "effectiveTo");

-- CreateIndex
CREATE INDEX "FinancialAllocation_programId_idx" ON "FinancialAllocation"("programId");

-- CreateIndex
CREATE INDEX "FinancialCategory_parentCategoryId_isActive_name_idx" ON "FinancialCategory"("parentCategoryId", "isActive", "name");

-- AddForeignKey
ALTER TABLE "FinancialCategory" ADD CONSTRAINT "FinancialCategory_parentCategoryId_fkey" FOREIGN KEY ("parentCategoryId") REFERENCES "FinancialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialProgram" ADD CONSTRAINT "FinancialProgram_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAllocation" ADD CONSTRAINT "FinancialAllocation_programId_fkey" FOREIGN KEY ("programId") REFERENCES "FinancialProgram"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminFeeAgreement" ADD CONSTRAINT "AdminFeeAgreement_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminFeeAgreement" ADD CONSTRAINT "AdminFeeAgreement_ownerPartyId_fkey" FOREIGN KEY ("ownerPartyId") REFERENCES "FinancialParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminFeeAgreement" ADD CONSTRAINT "AdminFeeAgreement_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdminFeeAgreement" ADD CONSTRAINT "AdminFeeAgreement_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
