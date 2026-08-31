-- Additive Plaid Link/webhook foundation. No bank or accounting data is removed.
CREATE TYPE "BankWebhookEventStatus" AS ENUM ('QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED', 'IGNORED');

ALTER TABLE "BankAccount" ADD COLUMN "createdByUserId" TEXT;

CREATE TABLE "BankProviderWebhookEvent" (
    "id" TEXT NOT NULL,
    "bankAccountId" TEXT NOT NULL,
    "provider" "BankConnectionProvider" NOT NULL,
    "eventHashSha256" TEXT NOT NULL,
    "webhookType" TEXT NOT NULL,
    "webhookCode" TEXT NOT NULL,
    "status" "BankWebhookEventStatus" NOT NULL DEFAULT 'QUEUED',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BankProviderWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BankAccount_createdByUserId_idx" ON "BankAccount"("createdByUserId");
CREATE UNIQUE INDEX "BankProviderWebhookEvent_provider_eventHashSha256_key" ON "BankProviderWebhookEvent"("provider", "eventHashSha256");
CREATE INDEX "BankProviderWebhookEvent_bankAccountId_status_receivedAt_idx" ON "BankProviderWebhookEvent"("bankAccountId", "status", "receivedAt");

ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "BankProviderWebhookEvent" ADD CONSTRAINT "BankProviderWebhookEvent_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "BankAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
