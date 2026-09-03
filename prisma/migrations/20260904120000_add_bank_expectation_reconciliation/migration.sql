-- Add a durable settlement bridge from expected money to canonical bank
-- transactions. Existing expectation-to-financial-transaction matches remain
-- unchanged; this table creates no economic transaction.
CREATE TABLE "FinancialExpectationBankMatch" (
    "id" TEXT NOT NULL,
    "operatingGroupId" TEXT NOT NULL,
    "expectationId" TEXT NOT NULL,
    "bankTransactionId" TEXT NOT NULL,
    "matchedAmountMinor" BIGINT NOT NULL,
    "matchedByUserId" TEXT NOT NULL,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinancialExpectationBankMatch_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "FinancialExpectationBankMatch_amount_check" CHECK ("matchedAmountMinor" > 0)
);

CREATE UNIQUE INDEX "FinancialExpectationBankMatch_expectationId_bankTransactionId_key"
ON "FinancialExpectationBankMatch"("expectationId", "bankTransactionId");

CREATE INDEX "FinancialExpectationBankMatch_operatingGroupId_matchedAt_id_idx"
ON "FinancialExpectationBankMatch"("operatingGroupId", "matchedAt", "id");

CREATE INDEX "FinancialExpectationBankMatch_bankTransactionId_matchedAt_id_idx"
ON "FinancialExpectationBankMatch"("bankTransactionId", "matchedAt", "id");

CREATE INDEX "FinancialExpectationBankMatch_matchedByUserId_matchedAt_id_idx"
ON "FinancialExpectationBankMatch"("matchedByUserId", "matchedAt", "id");

ALTER TABLE "FinancialExpectationBankMatch"
ADD CONSTRAINT "FinancialExpectationBankMatch_operatingGroupId_fkey"
FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialExpectationBankMatch"
ADD CONSTRAINT "FinancialExpectationBankMatch_expectationId_fkey"
FOREIGN KEY ("expectationId") REFERENCES "FinancialExpectation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialExpectationBankMatch"
ADD CONSTRAINT "FinancialExpectationBankMatch_bankTransactionId_fkey"
FOREIGN KEY ("bankTransactionId") REFERENCES "BankTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "FinancialExpectationBankMatch"
ADD CONSTRAINT "FinancialExpectationBankMatch_matchedByUserId_fkey"
FOREIGN KEY ("matchedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
