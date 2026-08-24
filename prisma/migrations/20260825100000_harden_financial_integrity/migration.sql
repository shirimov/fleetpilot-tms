-- Extend financial direction and recovery lifecycle without rewriting existing values.
ALTER TYPE "FinancialDirection" ADD VALUE 'TRANSFER';
ALTER TYPE "FinancialRecoveryStatus" ADD VALUE 'OPEN';
ALTER TYPE "FinancialRecoveryStatus" ADD VALUE 'PARTIAL';

-- Transfers are represented by one canonical transaction with distinct source and destination accounts.
ALTER TABLE "FinancialTransaction"
  ADD COLUMN "destinationSourceId" TEXT,
  ADD COLUMN "waivedAmountMinor" BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN "recoveryNotes" TEXT,
  ADD COLUMN "lastRecoveryAt" TIMESTAMP(3),
  ADD COLUMN "waivedAt" TIMESTAMP(3),
  ADD COLUMN "waivedByUserId" TEXT;

CREATE INDEX "FinancialTransaction_destinationSourceId_transactionDate_idx"
  ON "FinancialTransaction"("destinationSourceId", "transactionDate");

ALTER TABLE "FinancialTransaction"
  ADD CONSTRAINT "FinancialTransaction_destinationSourceId_fkey"
    FOREIGN KEY ("destinationSourceId") REFERENCES "FinancialSource"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FinancialTransaction_waivedByUserId_fkey"
    FOREIGN KEY ("waivedByUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "FinancialTransaction_transfer_check" CHECK (
    ("direction" = 'TRANSFER' AND "sourceId" IS NOT NULL AND "destinationSourceId" IS NOT NULL AND "sourceId" <> "destinationSourceId")
    OR
    ("direction" <> 'TRANSFER' AND "destinationSourceId" IS NULL)
  ),
  ADD CONSTRAINT "FinancialTransaction_waiver_check" CHECK (
    "waivedAmountMinor" >= 0 AND
    "recoveredAmountMinor" + "waivedAmountMinor" <= "expectedRecoveryMinor" AND
    ("recoveryStatus" <> 'WAIVED' OR "waivedAmountMinor" > 0)
  );
