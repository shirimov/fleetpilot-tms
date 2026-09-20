-- AlterTable
ALTER TABLE "ArchiveVersion" ADD COLUMN     "captureRunId" TEXT;

-- AlterTable
ALTER TABLE "ArchiveConflict" ADD COLUMN     "captureRunId" TEXT;

-- AlterTable
ALTER TABLE "ArchiveInventory" ADD COLUMN     "captureRunId" TEXT;

-- CreateTable
CREATE TABLE "ArchiveCaptureRun" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'QUICKMANAGE',
    "operatingGroupId" TEXT NOT NULL,
    "accountKey" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "allowedProviderCompanyIds" TEXT[],
    "label" TEXT,
    "startedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ArchiveCaptureRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArchiveCaptureRun_operatingGroupId_accountKey_status_idx" ON "ArchiveCaptureRun"("operatingGroupId", "accountKey", "status");

-- CreateIndex
CREATE INDEX "ArchiveVersion_captureRunId_idx" ON "ArchiveVersion"("captureRunId");

-- CreateIndex
CREATE INDEX "ArchiveConflict_captureRunId_idx" ON "ArchiveConflict"("captureRunId");

-- CreateIndex
CREATE INDEX "ArchiveInventory_captureRunId_idx" ON "ArchiveInventory"("captureRunId");

-- AddForeignKey
ALTER TABLE "ArchiveVersion" ADD CONSTRAINT "ArchiveVersion_captureRunId_fkey" FOREIGN KEY ("captureRunId") REFERENCES "ArchiveCaptureRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveConflict" ADD CONSTRAINT "ArchiveConflict_captureRunId_fkey" FOREIGN KEY ("captureRunId") REFERENCES "ArchiveCaptureRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveInventory" ADD CONSTRAINT "ArchiveInventory_captureRunId_fkey" FOREIGN KEY ("captureRunId") REFERENCES "ArchiveCaptureRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveCaptureRun" ADD CONSTRAINT "ArchiveCaptureRun_operatingGroupId_fkey" FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArchiveCaptureRun" ADD CONSTRAINT "ArchiveCaptureRun_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Scope and provenance never change; activation/closure serialize with acquisition.
ALTER TABLE "ArchiveCaptureRun" ALTER COLUMN "allowedProviderCompanyIds" SET NOT NULL;
ALTER TABLE "ArchiveCaptureRun" ADD CONSTRAINT "ArchiveCaptureRun_valid" CHECK (
  provider = 'QUICKMANAGE' AND cardinality("allowedProviderCompanyIds") BETWEEN 1 AND 50
  AND status IN ('DRAFT','ACTIVE','COMPLETED','CLOSED','FAILED')
  AND ((status='DRAFT' AND "startedAt" IS NULL AND "closedAt" IS NULL)
    OR (status='ACTIVE' AND "startedAt" IS NOT NULL AND "closedAt" IS NULL)
    OR (status IN ('COMPLETED','CLOSED','FAILED') AND "closedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "ArchiveCaptureRun_one_active" ON "ArchiveCaptureRun"("operatingGroupId","accountKey",provider) WHERE status='ACTIVE';
CREATE FUNCTION archive_capture_run_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Capture run audit history is immutable'; END IF;
  IF (to_jsonb(NEW)-'status'-'startedAt'-'closedAt') IS DISTINCT FROM (to_jsonb(OLD)-'status'-'startedAt'-'closedAt')
    OR NOT ((OLD.status='DRAFT' AND NEW.status IN ('ACTIVE','CLOSED')) OR (OLD.status='ACTIVE' AND NEW.status IN ('COMPLETED','CLOSED','FAILED')))
    OR (OLD."startedAt" IS NOT NULL AND NEW."startedAt" IS DISTINCT FROM OLD."startedAt")
  THEN RAISE EXCEPTION 'Capture run scope/provenance is immutable; create another run'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER archive_capture_run_guard BEFORE UPDATE OR DELETE ON "ArchiveCaptureRun" FOR EACH ROW EXECUTE FUNCTION archive_capture_run_immutable();
