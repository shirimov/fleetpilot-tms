-- Phase 6D adds audit-only real-case reconciliation metadata. Existing cases
-- remain explicitly OTHER/unknown until an administrator reviews them.
CREATE TYPE "PayrollRuleApplicability" AS ENUM ('APPLICABLE', 'NOT_APPLICABLE', 'REQUIRED_BUT_UNVERIFIED');
CREATE TYPE "PayrollCaseType" AS ENUM ('SOLO_DRIVER', 'DRIVER_WITH_DEDUCTIONS', 'CONTRACTOR', 'TEAM_DRIVER', 'COMPLEX_CONTRACTOR', 'OTHER');
CREATE TYPE "PayrollInputSource" AS ENUM ('CANONICAL_FLEETPILOT', 'MANUAL_AUDIT_INPUT', 'EXTERNAL_REFERENCE', 'DERIVED', 'UNAVAILABLE');

ALTER TABLE "PayrollExternalReference" ADD COLUMN "grossRevenueMinor" BIGINT;
ALTER TABLE "PayrollRule" ADD COLUMN "applicability" "PayrollRuleApplicability" NOT NULL DEFAULT 'REQUIRED_BUT_UNVERIFIED';
ALTER TABLE "PayrollReconciliationCase"
  ADD COLUMN "caseType" "PayrollCaseType" NOT NULL DEFAULT 'OTHER',
  ADD COLUMN "truckUnitReference" TEXT,
  ADD COLUMN "inputSources" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "exactMatch" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "evaluatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "PayrollRuleEvidence" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "ruleId" TEXT NOT NULL,
  "caseId" TEXT NOT NULL,
  "notes" TEXT,
  "createdByUserId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PayrollRuleEvidence_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "PayrollExternalReference" ADD CONSTRAINT "PayrollExternalReference_gross_nonnegative_check" CHECK ("grossRevenueMinor" IS NULL OR "grossRevenueMinor" >= 0);
ALTER TABLE "PayrollReconciliationCase" ADD CONSTRAINT "PayrollReconciliationCase_matched_exact_check" CHECK ("status" <> 'MATCHED' OR "exactMatch" = true);
CREATE UNIQUE INDEX "PayrollRuleEvidence_ruleId_caseId_key" ON "PayrollRuleEvidence"("ruleId", "caseId");
CREATE INDEX "PayrollRuleEvidence_companyId_ruleId_idx" ON "PayrollRuleEvidence"("companyId", "ruleId");
CREATE INDEX "PayrollRuleEvidence_companyId_caseId_idx" ON "PayrollRuleEvidence"("companyId", "caseId");
CREATE INDEX "PayrollReconciliationCase_companyId_caseType_exactMatch_idx" ON "PayrollReconciliationCase"("companyId", "caseType", "exactMatch");
ALTER TABLE "PayrollRuleEvidence" ADD CONSTRAINT "PayrollRuleEvidence_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollRuleEvidence" ADD CONSTRAINT "PayrollRuleEvidence_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "PayrollRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollRuleEvidence" ADD CONSTRAINT "PayrollRuleEvidence_caseId_fkey" FOREIGN KEY ("caseId") REFERENCES "PayrollReconciliationCase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayrollRuleEvidence" ADD CONSTRAINT "PayrollRuleEvidence_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
