CREATE TYPE "PayrollPeriodStatus" AS ENUM ('OPEN', 'ARCHIVED');
CREATE TYPE "PayrollParticipantType" AS ENUM ('COMPANY_DRIVER', 'CONTRACTOR');
CREATE TYPE "PayrollContractType" AS ENUM ('PER_MILE', 'PERCENTAGE', 'FLAT', 'HOURLY', 'OTHER');
CREATE TYPE "PayrollPercentageBase" AS ENUM ('GROSS_REVENUE', 'LINEHAUL', 'TRIP_RATE', 'NET_AFTER_SPECIFIC_CHARGES', 'UNKNOWN');
CREATE TYPE "PayrollTeamAllocationStrategy" AS ENUM ('FULL_MILES_EACH', 'SPLIT_50_50', 'ROLE_BASED', 'CUSTOM_ALLOCATION', 'UNKNOWN');
CREATE TYPE "PayrollAdjustmentCategory" AS ENUM ('REIMBURSEMENT', 'CREDIT', 'ADVANCE', 'DEDUCTION', 'RECURRING_DEDUCTION', 'FUEL', 'TOLL', 'ESCROW', 'OTHER');
CREATE TYPE "PayrollAdjustmentDirection" AS ENUM ('CREDIT', 'DEBIT');

CREATE TABLE "PayrollPeriod" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "identifier" TEXT NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate" TIMESTAMP(3) NOT NULL,
  "status" "PayrollPeriodStatus" NOT NULL DEFAULT 'OPEN',
  "calculatedAt" TIMESTAMP(3),
  "externalProvider" TEXT,
  "externalPeriod" TEXT,
  "externalBatchId" TEXT,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollPeriod_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollPeriod_valid_dates_check" CHECK ("endDate" >= "startDate")
);

CREATE TABLE "PayrollPayContract" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "participantType" "PayrollParticipantType" NOT NULL,
  "driverId" TEXT,
  "contractorPartyId" TEXT,
  "type" "PayrollContractType" NOT NULL,
  "rateMinorPerMile" BIGINT,
  "percentageBasisPoints" INTEGER,
  "percentageBase" "PayrollPercentageBase",
  "includedChargeCategories" JSONB,
  "excludedChargeCategories" JSONB,
  "appliesToTeam" BOOLEAN NOT NULL DEFAULT false,
  "teamAllocationStrategy" "PayrollTeamAllocationStrategy",
  "effectiveFrom" TIMESTAMP(3) NOT NULL,
  "effectiveTo" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollPayContract_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollPayContract_participant_check" CHECK (
    ("participantType" = 'COMPANY_DRIVER' AND "driverId" IS NOT NULL AND "contractorPartyId" IS NULL) OR
    ("participantType" = 'CONTRACTOR' AND "driverId" IS NULL AND "contractorPartyId" IS NOT NULL)
  ),
  CONSTRAINT "PayrollPayContract_rate_check" CHECK (
    ("type" = 'PER_MILE' AND "rateMinorPerMile" IS NOT NULL AND "rateMinorPerMile" >= 0) OR
    ("type" <> 'PER_MILE' AND "rateMinorPerMile" IS NULL)
  ),
  CONSTRAINT "PayrollPayContract_percentage_check" CHECK (
    ("type" = 'PERCENTAGE' AND "percentageBasisPoints" BETWEEN 0 AND 10000 AND "percentageBase" IS NOT NULL) OR
    ("type" <> 'PERCENTAGE' AND "percentageBasisPoints" IS NULL AND "percentageBase" IS NULL)
  ),
  CONSTRAINT "PayrollPayContract_valid_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" >= "effectiveFrom")
);

CREATE TABLE "PayrollAdjustment" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "participantType" "PayrollParticipantType" NOT NULL,
  "driverId" TEXT,
  "contractorPartyId" TEXT,
  "loadId" TEXT,
  "category" "PayrollAdjustmentCategory" NOT NULL,
  "direction" "PayrollAdjustmentDirection" NOT NULL,
  "amountMinor" BIGINT NOT NULL,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "description" TEXT NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'MANUAL_PREVIEW',
  "effectiveDate" TIMESTAMP(3) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollAdjustment_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollAdjustment_participant_check" CHECK (
    ("participantType" = 'COMPANY_DRIVER' AND "driverId" IS NOT NULL AND "contractorPartyId" IS NULL) OR
    ("participantType" = 'CONTRACTOR' AND "driverId" IS NULL AND "contractorPartyId" IS NOT NULL)
  ),
  CONSTRAINT "PayrollAdjustment_positive_amount_check" CHECK ("amountMinor" > 0),
  CONSTRAINT "PayrollAdjustment_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE TABLE "PayrollExternalReference" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "periodId" TEXT NOT NULL,
  "participantType" "PayrollParticipantType" NOT NULL,
  "driverId" TEXT,
  "contractorPartyId" TEXT,
  "provider" TEXT NOT NULL,
  "externalStatementRef" TEXT,
  "externalPeriod" TEXT,
  "earningMinor" BIGINT,
  "reimbursementMinor" BIGINT,
  "fuelMinor" BIGINT,
  "tollMinor" BIGINT,
  "deductionsMinor" BIGINT,
  "payoutMinor" BIGINT,
  "currency" TEXT NOT NULL DEFAULT 'USD',
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PayrollExternalReference_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PayrollExternalReference_participant_check" CHECK (
    ("participantType" = 'COMPANY_DRIVER' AND "driverId" IS NOT NULL AND "contractorPartyId" IS NULL) OR
    ("participantType" = 'CONTRACTOR' AND "driverId" IS NULL AND "contractorPartyId" IS NOT NULL)
  ),
  CONSTRAINT "PayrollExternalReference_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$')
);

CREATE UNIQUE INDEX "PayrollPeriod_companyId_identifier_key" ON "PayrollPeriod"("companyId", "identifier");
CREATE INDEX "PayrollPeriod_companyId_startDate_endDate_idx" ON "PayrollPeriod"("companyId", "startDate", "endDate");
CREATE INDEX "PayrollPeriod_companyId_status_idx" ON "PayrollPeriod"("companyId", "status");
CREATE INDEX "PayrollPayContract_companyId_participantType_isActive_effectiveFrom_idx" ON "PayrollPayContract"("companyId", "participantType", "isActive", "effectiveFrom");
CREATE INDEX "PayrollPayContract_driverId_effectiveFrom_idx" ON "PayrollPayContract"("driverId", "effectiveFrom");
CREATE INDEX "PayrollPayContract_contractorPartyId_effectiveFrom_idx" ON "PayrollPayContract"("contractorPartyId", "effectiveFrom");
CREATE UNIQUE INDEX "PayrollPayContract_active_driver_effective_key" ON "PayrollPayContract"("companyId", "driverId", "effectiveFrom") WHERE "driverId" IS NOT NULL;
CREATE UNIQUE INDEX "PayrollPayContract_active_contractor_effective_key" ON "PayrollPayContract"("companyId", "contractorPartyId", "effectiveFrom") WHERE "contractorPartyId" IS NOT NULL;
CREATE INDEX "PayrollAdjustment_companyId_periodId_participantType_idx" ON "PayrollAdjustment"("companyId", "periodId", "participantType");
CREATE INDEX "PayrollAdjustment_driverId_periodId_idx" ON "PayrollAdjustment"("driverId", "periodId");
CREATE INDEX "PayrollAdjustment_contractorPartyId_periodId_idx" ON "PayrollAdjustment"("contractorPartyId", "periodId");
CREATE UNIQUE INDEX "PayrollExternalReference_periodId_driverId_provider_key" ON "PayrollExternalReference"("periodId", "driverId", "provider");
CREATE UNIQUE INDEX "PayrollExternalReference_periodId_contractorPartyId_provider_key" ON "PayrollExternalReference"("periodId", "contractorPartyId", "provider");
CREATE INDEX "PayrollExternalReference_companyId_periodId_participantType_idx" ON "PayrollExternalReference"("companyId", "periodId", "participantType");

ALTER TABLE "PayrollPeriod" ADD CONSTRAINT "PayrollPeriod_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollPayContract" ADD CONSTRAINT "PayrollPayContract_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollPayContract" ADD CONSTRAINT "PayrollPayContract_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollPayContract" ADD CONSTRAINT "PayrollPayContract_contractorPartyId_fkey" FOREIGN KEY ("contractorPartyId") REFERENCES "FinancialParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_contractorPartyId_fkey" FOREIGN KEY ("contractorPartyId") REFERENCES "FinancialParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollAdjustment" ADD CONSTRAINT "PayrollAdjustment_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollExternalReference" ADD CONSTRAINT "PayrollExternalReference_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollExternalReference" ADD CONSTRAINT "PayrollExternalReference_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "PayrollPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollExternalReference" ADD CONSTRAINT "PayrollExternalReference_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollExternalReference" ADD CONSTRAINT "PayrollExternalReference_contractorPartyId_fkey" FOREIGN KEY ("contractorPartyId") REFERENCES "FinancialParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollExternalReference" ADD CONSTRAINT "PayrollExternalReference_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
