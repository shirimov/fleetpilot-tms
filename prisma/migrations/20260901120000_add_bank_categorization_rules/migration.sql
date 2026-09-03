-- Add explainable, company-scoped bank categorization rules. Rules only create
-- suggestions; they never mark a transaction reviewed or post accounting data.
CREATE TABLE "BankCategorizationRule" (
    "id" TEXT NOT NULL,
    "operatingGroupId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isEnabled" BOOLEAN NOT NULL DEFAULT true,
    "merchantNormalized" TEXT,
    "descriptionContainsNormalized" TEXT,
    "direction" "FinancialDirection",
    "bankAccountId" TEXT,
    "minimumAmountMinor" BIGINT,
    "maximumAmountMinor" BIGINT,
    "categoryId" TEXT NOT NULL,
    "scope" "BankClassificationScope" NOT NULL DEFAULT 'COMPANY_LEVEL',
    "truckId" TEXT,
    "trailerId" TEXT,
    "driverId" TEXT,
    "partyId" TEXT,
    "matchCount" INTEGER NOT NULL DEFAULT 0,
    "createdByUserId" TEXT NOT NULL,
    "updatedByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BankCategorizationRule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BankCategorizationRule_companyId_isEnabled_merchantNormalized_idx" ON "BankCategorizationRule"("companyId", "isEnabled", "merchantNormalized");
CREATE INDEX "BankCategorizationRule_companyId_isEnabled_direction_idx" ON "BankCategorizationRule"("companyId", "isEnabled", "direction");
CREATE INDEX "BankCategorizationRule_operatingGroupId_updatedAt_idx" ON "BankCategorizationRule"("operatingGroupId", "updatedAt");
CREATE INDEX "BankCategorizationRule_categoryId_idx" ON "BankCategorizationRule"("categoryId");
CREATE INDEX "BankCategorizationRule_bankAccountId_idx" ON "BankCategorizationRule"("bankAccountId");
CREATE INDEX "BankCategorizationRule_truckId_idx" ON "BankCategorizationRule"("truckId");
CREATE INDEX "BankCategorizationRule_trailerId_idx" ON "BankCategorizationRule"("trailerId");
CREATE INDEX "BankCategorizationRule_driverId_idx" ON "BankCategorizationRule"("driverId");
CREATE INDEX "BankCategorizationRule_partyId_idx" ON "BankCategorizationRule"("partyId");

ALTER TABLE "BankCategorizationRule" ADD CONSTRAINT "BankCategorizationRule_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankCategorizationRule" ADD CONSTRAINT "BankCategorizationRule_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankCategorizationRule" ADD CONSTRAINT "BankCategorizationRule_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankCategorizationRule" ADD CONSTRAINT "BankCategorizationRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "FinancialCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankCategorizationRule" ADD CONSTRAINT "BankCategorizationRule_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankCategorizationRule" ADD CONSTRAINT "BankCategorizationRule_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankCategorizationRule" ADD CONSTRAINT "BankCategorizationRule_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankCategorizationRule" ADD CONSTRAINT "BankCategorizationRule_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "FinancialParty"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankCategorizationRule" ADD CONSTRAINT "BankCategorizationRule_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankCategorizationRule" ADD CONSTRAINT "BankCategorizationRule_updatedByUserId_fkey" FOREIGN KEY ("updatedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
