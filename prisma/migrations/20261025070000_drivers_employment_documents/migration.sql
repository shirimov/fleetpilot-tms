-- CreateEnum
CREATE TYPE "DriverEmploymentStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'TERMINATED', 'ON_LEAVE');

-- CreateEnum
CREATE TYPE "DriverEmploymentType" AS ENUM ('COMPANY', 'OWNER_OPERATOR', 'LEASE_OPERATOR');

-- CreateEnum
CREATE TYPE "DriverDocumentType" AS ENUM ('CDL_FRONT', 'CDL_BACK', 'MEDICAL_CERTIFICATE', 'MVR', 'APPLICATION', 'EMPLOYMENT_AGREEMENT', 'ROAD_TEST', 'OTHER');

-- CreateEnum
CREATE TYPE "DriverQualificationOutcome" AS ENUM ('PENDING', 'REVIEWED', 'NEEDS_FOLLOW_UP');

-- AlterTable
ALTER TABLE "Driver" ADD COLUMN     "driverType" "DriverEmploymentType",
ADD COLUMN     "emergencyContactName" TEXT,
ADD COLUMN     "emergencyContactPhone" TEXT,
ADD COLUMN     "emergencyContactRelation" TEXT,
ADD COLUMN     "employmentStartDate" DATE,
ADD COLUMN     "employmentStatus" "DriverEmploymentStatus",
ADD COLUMN     "homeTerminal" TEXT,
ADD COLUMN     "teamId" TEXT,
ADD COLUMN     "terminationDate" DATE;

-- CreateTable
CREATE TABLE "DriverTeam" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverTeam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverDocument" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "type" "DriverDocumentType" NOT NULL,
    "slot" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverDocumentVersion" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "issuedAt" DATE,
    "expiresAt" DATE,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverQualificationReview" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "outcome" "DriverQualificationOutcome" NOT NULL,
    "notes" TEXT NOT NULL,
    "reviewerId" TEXT,
    "reviewerName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverQualificationReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverAudit" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "metadata" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverAudit_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DriverTeam_id_companyId_key" ON "DriverTeam"("id", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverTeam_companyId_name_key" ON "DriverTeam"("companyId", "name");

-- CreateIndex
CREATE INDEX "DriverDocument_companyId_driverId_idx" ON "DriverDocument"("companyId", "driverId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverDocument_driverId_slot_key" ON "DriverDocument"("driverId", "slot");

-- CreateIndex
CREATE INDEX "DriverDocumentVersion_documentId_createdAt_idx" ON "DriverDocumentVersion"("documentId", "createdAt");

-- CreateIndex
CREATE INDEX "DriverDocumentVersion_expiresAt_idx" ON "DriverDocumentVersion"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "DriverDocumentVersion_documentId_version_key" ON "DriverDocumentVersion"("documentId", "version");

-- CreateIndex
CREATE INDEX "DriverQualificationReview_companyId_driverId_createdAt_idx" ON "DriverQualificationReview"("companyId", "driverId", "createdAt");

-- CreateIndex
CREATE INDEX "DriverAudit_companyId_driverId_createdAt_idx" ON "DriverAudit"("companyId", "driverId", "createdAt");

-- CreateIndex
CREATE INDEX "Driver_companyId_employmentStatus_idx" ON "Driver"("companyId", "employmentStatus");

-- CreateIndex
CREATE INDEX "Driver_teamId_companyId_idx" ON "Driver"("teamId", "companyId");

-- CreateIndex
CREATE UNIQUE INDEX "Driver_id_companyId_key" ON "Driver"("id", "companyId");

-- AddForeignKey
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_teamId_companyId_fkey" FOREIGN KEY ("teamId", "companyId") REFERENCES "DriverTeam"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverTeam" ADD CONSTRAINT "DriverTeam_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverDocument" ADD CONSTRAINT "DriverDocument_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverDocument" ADD CONSTRAINT "DriverDocument_driverId_companyId_fkey" FOREIGN KEY ("driverId", "companyId") REFERENCES "Driver"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverDocumentVersion" ADD CONSTRAINT "DriverDocumentVersion_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverDocumentVersion" ADD CONSTRAINT "DriverDocumentVersion_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "DriverDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverQualificationReview" ADD CONSTRAINT "DriverQualificationReview_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverQualificationReview" ADD CONSTRAINT "DriverQualificationReview_driverId_companyId_fkey" FOREIGN KEY ("driverId", "companyId") REFERENCES "Driver"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverQualificationReview" ADD CONSTRAINT "DriverQualificationReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAudit" ADD CONSTRAINT "DriverAudit_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAudit" ADD CONSTRAINT "DriverAudit_driverId_companyId_fkey" FOREIGN KEY ("driverId", "companyId") REFERENCES "Driver"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAudit" ADD CONSTRAINT "DriverAudit_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Preserve chronological employment and document metadata even for future import paths.
ALTER TABLE "Driver" ADD CONSTRAINT "Driver_employment_dates_check"
CHECK ("employmentStartDate" IS NULL OR "terminationDate" IS NULL OR "terminationDate" >= "employmentStartDate");
ALTER TABLE "DriverDocumentVersion" ADD CONSTRAINT "DriverDocumentVersion_metadata_check"
CHECK ("version" > 0 AND "byteSize" BETWEEN 1 AND 10485760 AND
  ("issuedAt" IS NULL OR "expiresAt" IS NULL OR "expiresAt" >= "issuedAt"));
