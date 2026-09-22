CREATE TYPE "FuelRecoveryResponsibility" AS ENUM ('COMPANY', 'RECIPIENT');
CREATE TYPE "FuelDiscountTreatment" AS ENUM ('FULL_PASS_THROUGH', 'COMPANY_RETENTION');

CREATE TABLE "FuelDeductionPolicy" (
  "id" TEXT NOT NULL,
  "operatingGroupId" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "truckId" TEXT,
  "providerRecipientId" TEXT,
  "responsibility" "FuelRecoveryResponsibility" NOT NULL,
  "discountTreatment" "FuelDiscountTreatment" NOT NULL,
  "companyRetentionBasisPoints" INTEGER NOT NULL DEFAULT 0,
  "effectiveFrom" DATE NOT NULL,
  "effectiveTo" DATE,
  "sourceReference" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "approvedByUserId" TEXT NOT NULL,
  "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FuelDeductionPolicy_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FuelDeductionPolicy_dates_check" CHECK ("effectiveTo" IS NULL OR "effectiveTo" > "effectiveFrom"),
  CONSTRAINT "FuelDeductionPolicy_retention_check" CHECK ("companyRetentionBasisPoints" BETWEEN 0 AND 10000),
  CONSTRAINT "FuelDeductionPolicy_treatment_check" CHECK (
    ("discountTreatment" = 'FULL_PASS_THROUGH' AND "companyRetentionBasisPoints" = 0)
    OR "discountTreatment" = 'COMPANY_RETENTION'
  )
);

ALTER TABLE "FuelDeductionPolicy" ADD CONSTRAINT "FuelDeductionPolicy_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FuelDeductionPolicy" ADD CONSTRAINT "FuelDeductionPolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FuelDeductionPolicy" ADD CONSTRAINT "FuelDeductionPolicy_group_company_fkey" FOREIGN KEY ("operatingGroupId", "companyId") REFERENCES "OperatingGroupCompany"("operatingGroupId", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FuelDeductionPolicy" ADD CONSTRAINT "FuelDeductionPolicy_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FuelDeductionPolicy" ADD CONSTRAINT "FuelDeductionPolicy_approvedByUserId_fkey" FOREIGN KEY ("approvedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "FuelDeductionPolicy_operatingGroupId_companyId_effectiveFrom_idx" ON "FuelDeductionPolicy"("operatingGroupId", "companyId", "effectiveFrom");
CREATE INDEX "FuelDeductionPolicy_truckId_effectiveFrom_idx" ON "FuelDeductionPolicy"("truckId", "effectiveFrom");
CREATE INDEX "FuelDeductionPolicy_providerRecipientId_effectiveFrom_idx" ON "FuelDeductionPolicy"("providerRecipientId", "effectiveFrom");

ALTER TABLE "FuelDeductionPolicy" ADD CONSTRAINT "FuelDeductionPolicy_no_overlapping_scope" EXCLUDE USING gist (
  "operatingGroupId" WITH =,
  "companyId" WITH =,
  COALESCE("truckId", '') WITH =,
  COALESCE("providerRecipientId", '') WITH =,
  daterange("effectiveFrom", "effectiveTo", '[)') WITH &&
);
