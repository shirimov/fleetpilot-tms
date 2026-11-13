ALTER TYPE "PilotInvoiceStatus" ADD VALUE IF NOT EXISTS 'SOURCE_ACCEPTED';

ALTER TABLE "PilotProviderInvoice"
  ADD COLUMN "sourceFormat" TEXT NOT NULL DEFAULT 'LEGACY_XLS',
  ADD COLUMN "providerAccountReference" TEXT,
  ADD COLUMN "billingPeriodExplicit" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "observedStart" DATE,
  ADD COLUMN "observedEnd" DATE;

UPDATE "PilotProviderInvoice"
SET "observedStart" = "periodStart", "observedEnd" = "periodEnd"
WHERE "observedStart" IS NULL OR "observedEnd" IS NULL;

ALTER TABLE "PilotInvoiceAdjustment"
  ADD COLUMN "appliedToEvent" BOOLEAN NOT NULL DEFAULT false;
