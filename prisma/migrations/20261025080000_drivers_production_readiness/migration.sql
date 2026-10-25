-- AlterTable
ALTER TABLE "DriverDocumentVersion" ADD COLUMN     "scanEngine" TEXT,
ADD COLUMN     "scanStatus" TEXT NOT NULL DEFAULT 'UNSCANNED',
ADD COLUMN     "scannedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "DriverDocumentScan" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "quarantineKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "engine" TEXT NOT NULL,
    "scannedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverDocumentScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverReminderPolicy" (
    "companyId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "requiredTypes" "DriverDocumentType"[],
    "trackedTypes" "DriverDocumentType"[],
    "mvrReviewDays" INTEGER,
    "lastSuccessAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverReminderPolicy_pkey" PRIMARY KEY ("companyId")
);

-- CreateTable
CREATE TABLE "DriverReminder" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "documentType" "DriverDocumentType" NOT NULL,
    "versionId" TEXT,
    "dueAt" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverReminder_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriverDocumentScan_quarantineKey_key" ON "DriverDocumentScan"("quarantineKey");

-- CreateIndex
CREATE INDEX "DriverDocumentScan_companyId_driverId_createdAt_idx" ON "DriverDocumentScan"("companyId", "driverId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DriverReminder_dedupeKey_key" ON "DriverReminder"("dedupeKey");

-- CreateIndex
CREATE INDEX "DriverReminder_companyId_createdAt_id_idx" ON "DriverReminder"("companyId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "DriverReminder_driverId_idx" ON "DriverReminder"("driverId");

-- AddForeignKey
ALTER TABLE "DriverDocumentScan" ADD CONSTRAINT "DriverDocumentScan_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverDocumentScan" ADD CONSTRAINT "DriverDocumentScan_driverId_companyId_fkey" FOREIGN KEY ("driverId", "companyId") REFERENCES "Driver"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverReminderPolicy" ADD CONSTRAINT "DriverReminderPolicy_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverReminder" ADD CONSTRAINT "DriverReminder_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverReminder" ADD CONSTRAINT "DriverReminder_driverId_companyId_fkey" FOREIGN KEY ("driverId", "companyId") REFERENCES "Driver"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverReminder" ADD CONSTRAINT "DriverReminder_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "DriverDocumentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "DriverDocumentVersion" ADD CONSTRAINT "DriverDocumentVersion_scan_check"
CHECK ("scanStatus" IN ('UNSCANNED','CLEAN','INFECTED','ERROR') AND
  ("scanStatus" <> 'CLEAN' OR ("scannedAt" IS NOT NULL AND "scanEngine" IS NOT NULL)));
ALTER TABLE "DriverDocumentScan" ADD CONSTRAINT "DriverDocumentScan_status_check"
CHECK ("status" IN ('UNSCANNED','CLEAN','INFECTED','ERROR') AND "byteSize" BETWEEN 1 AND 10485760);
ALTER TABLE "DriverReminderPolicy" ADD CONSTRAINT "DriverReminderPolicy_settings_check"
CHECK ("revision" > 0 AND ("mvrReviewDays" IS NULL OR "mvrReviewDays" BETWEEN 1 AND 3650));
ALTER TABLE "DriverReminder" ADD CONSTRAINT "DriverReminder_kind_check"
CHECK ("kind" IN ('MISSING','DAYS_90','DAYS_60','DAYS_30','EXPIRED'));
