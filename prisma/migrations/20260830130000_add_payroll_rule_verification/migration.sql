-- CreateEnum
CREATE TYPE "PayrollRuleType" AS ENUM ('MILEAGE_SOURCE', 'DEADHEAD', 'TEAM_ALLOCATION', 'CONTRACTOR_PERCENTAGE_BASE', 'FUEL_DEDUCTION', 'TOLL_DEDUCTION', 'RECURRING_DEDUCTION', 'ESCROW', 'ADVANCE_REPAYMENT');

-- CreateEnum
CREATE TYPE "PayrollRuleVerificationStatus" AS ENUM ('UNVERIFIED', 'OBSERVED', 'ADMIN_VERIFIED', 'PRODUCTION_READY');

-- CreateEnum
CREATE TYPE "PayrollReconciliationStatus" AS ENUM ('OPEN', 'MATCHED', 'EXPLAINED_DIFFERENCE', 'UNEXPLAINED_DIFFERENCE', 'RULE_GAP', 'DATA_GAP');

-- CreateEnum
CREATE TYPE "PayrollDifferenceType" AS ENUM ('MILEAGE_DIFFERENCE', 'RATE_DIFFERENCE', 'TEAM_ALLOCATION_DIFFERENCE', 'MISSING_REIMBURSEMENT', 'MISSING_ADVANCE', 'MISSING_FUEL', 'MISSING_TOLL', 'MISSING_DEDUCTION', 'CONTRACTOR_BASE_DIFFERENCE', 'ROUNDING_DIFFERENCE', 'UNKNOWN');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PayrollTeamAllocationStrategy" ADD VALUE 'PRIMARY_SECONDARY';
ALTER TYPE "PayrollTeamAllocationStrategy" ADD VALUE 'CUSTOM_PERCENTAGE';
ALTER TYPE "PayrollTeamAllocationStrategy" ADD VALUE 'CUSTOM_MILES';

-- AlterTable
ALTER TABLE "PayrollExternalReference" ADD COLUMN     "advancesMinor" BIGINT,
ADD COLUMN     "escrowMinor" BIGINT,
ADD COLUMN     "milesThousandths" BIGINT,
ADD COLUMN     "rateMinorPerMile" BIGINT,
ADD COLUMN     "recurringMinor" BIGINT;

-- AlterTable
ALTER TABLE "PayrollPayContract" ADD COLUMN     "deadheadPolicy" TEXT NOT NULL DEFAULT 'UNKNOWN',
ADD COLUMN     "deadheadRateMinorPerMile" BIGINT,
ADD COLUMN     "mileagePolicy" TEXT NOT NULL DEFAULT 'LOAD_MILES',
ADD COLUMN     "roundingRule" TEXT NOT NULL DEFAULT 'HALF_UP_CENT',
ADD COLUMN     "teamAllocationPercent" INTEGER,
ADD COLUMN     "verificationStatus" "PayrollRuleVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED';

-- CreateTable
CREATE TABLE "PayrollRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "type" "PayrollRuleType" NOT NULL,
    "verificationStatus" "PayrollRuleVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "configuration" JSONB NOT NULL,
    "evidenceNotes" TEXT,
    "testedAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "verifiedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRecurringDeductionRule" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "participantType" "PayrollParticipantType" NOT NULL,
    "driverId" TEXT,
    "contractorPartyId" TEXT,
    "category" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "amountMinor" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "frequency" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "maximumMinor" BIGINT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "verificationStatus" "PayrollRuleVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRecurringDeductionRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollReconciliationCase" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "participantType" "PayrollParticipantType" NOT NULL,
    "driverId" TEXT,
    "contractorPartyId" TEXT,
    "status" "PayrollReconciliationStatus" NOT NULL DEFAULT 'OPEN',
    "calculatedSnapshot" JSONB NOT NULL,
    "externalSnapshot" JSONB NOT NULL,
    "componentDifferences" JSONB NOT NULL,
    "differenceTypes" "PayrollDifferenceType"[],
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollReconciliationCase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PayrollRule_companyId_verificationStatus_idx" ON "PayrollRule"("companyId", "verificationStatus");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRule_companyId_type_key" ON "PayrollRule"("companyId", "type");

-- CreateIndex
CREATE INDEX "PayrollRecurringDeductionRule_companyId_participantType_isA_idx" ON "PayrollRecurringDeductionRule"("companyId", "participantType", "isActive", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PayrollRecurringDeductionRule_driverId_effectiveFrom_idx" ON "PayrollRecurringDeductionRule"("driverId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PayrollRecurringDeductionRule_contractorPartyId_effectiveFr_idx" ON "PayrollRecurringDeductionRule"("contractorPartyId", "effectiveFrom");

-- CreateIndex
CREATE INDEX "PayrollReconciliationCase_companyId_periodId_status_idx" ON "PayrollReconciliationCase"("companyId", "periodId", "status");

-- CreateIndex
CREATE INDEX "PayrollReconciliationCase_driverId_periodId_idx" ON "PayrollReconciliationCase"("driverId", "periodId");

-- CreateIndex
CREATE INDEX "PayrollReconciliationCase_contractorPartyId_periodId_idx" ON "PayrollReconciliationCase"("contractorPartyId", "periodId");

-- AddForeignKey
ALTER TABLE "PayrollRule" ADD CONSTRAINT "PayrollRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRule" ADD CONSTRAINT "PayrollRule_verifiedByUserId_fkey" FOREIGN KEY ("verifiedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRecurringDeductionRule" ADD CONSTRAINT "PayrollRecurringDeductionRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRecurringDeductionRule" ADD CONSTRAINT "PayrollRecurringDeductionRule_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRecurringDeductionRule" ADD CONSTRAINT "PayrollRecurringDeductionRule_contractorPartyId_fkey" FOREIGN KEY ("contractorPartyId") REFERENCES "FinancialParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollRecurringDeductionRule" ADD CONSTRAINT "PayrollRecurringDeductionRule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollReconciliationCase" ADD CONSTRAINT "PayrollReconciliationCase_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollReconciliationCase" ADD CONSTRAINT "PayrollReconciliationCase_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollReconciliationCase" ADD CONSTRAINT "PayrollReconciliationCase_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollReconciliationCase" ADD CONSTRAINT "PayrollReconciliationCase_contractorPartyId_fkey" FOREIGN KEY ("contractorPartyId") REFERENCES "FinancialParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollReconciliationCase" ADD CONSTRAINT "PayrollReconciliationCase_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Payroll preview rules fail closed at the database boundary.
ALTER TABLE "PayrollPayContract"
  ADD CONSTRAINT "PayrollPayContract_teamAllocationPercent_check" CHECK ("teamAllocationPercent" IS NULL OR ("teamAllocationPercent" >= 0 AND "teamAllocationPercent" <= 10000)),
  ADD CONSTRAINT "PayrollPayContract_deadheadRate_check" CHECK ("deadheadRateMinorPerMile" IS NULL OR "deadheadRateMinorPerMile" >= 0);

ALTER TABLE "PayrollExternalReference"
  ADD CONSTRAINT "PayrollExternalReference_component_nonnegative_check" CHECK (
    ("milesThousandths" IS NULL OR "milesThousandths" >= 0) AND
    ("rateMinorPerMile" IS NULL OR "rateMinorPerMile" >= 0) AND
    ("advancesMinor" IS NULL OR "advancesMinor" >= 0) AND
    ("recurringMinor" IS NULL OR "recurringMinor" >= 0) AND
    ("escrowMinor" IS NULL OR "escrowMinor" >= 0)
  );

ALTER TABLE "PayrollRecurringDeductionRule"
  ADD CONSTRAINT "PayrollRecurringDeductionRule_participant_check" CHECK (
    ("participantType" = 'COMPANY_DRIVER' AND "driverId" IS NOT NULL AND "contractorPartyId" IS NULL) OR
    ("participantType" = 'CONTRACTOR' AND "driverId" IS NULL AND "contractorPartyId" IS NOT NULL)
  ),
  ADD CONSTRAINT "PayrollRecurringDeductionRule_amount_check" CHECK ("amountMinor" > 0 AND ("maximumMinor" IS NULL OR "maximumMinor" >= 0)),
  ADD CONSTRAINT "PayrollRecurringDeductionRule_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom"),
  ADD CONSTRAINT "PayrollRecurringDeductionRule_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$');

ALTER TABLE "PayrollReconciliationCase"
  ADD CONSTRAINT "PayrollReconciliationCase_participant_check" CHECK (
    ("participantType" = 'COMPANY_DRIVER' AND "driverId" IS NOT NULL AND "contractorPartyId" IS NULL) OR
    ("participantType" = 'CONTRACTOR' AND "driverId" IS NULL AND "contractorPartyId" IS NOT NULL)
  );
