CREATE TYPE "ExternalSyncBatchStatus" AS ENUM ('PREVIEWED', 'APPLIED');
CREATE TYPE "ExternalSyncResourceType" AS ENUM ('TRUCK', 'TRAILER', 'DRIVER', 'CUSTOMER');
CREATE TYPE "ExternalSyncDisposition" AS ENUM ('NEW', 'MATCHED', 'UNCHANGED', 'CONFLICT', 'INVALID');

CREATE TABLE "ExternalSyncBatch" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "ExternalSyncBatchStatus" NOT NULL DEFAULT 'PREVIEWED',
    "totalRows" INTEGER NOT NULL,
    "newRows" INTEGER NOT NULL,
    "matchedRows" INTEGER NOT NULL,
    "unchangedRows" INTEGER NOT NULL,
    "conflictRows" INTEGER NOT NULL,
    "invalidRows" INTEGER NOT NULL,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExternalSyncBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ExternalSourceLink" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "resourceType" "ExternalSyncResourceType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "truckId" TEXT,
    "trailerId" TEXT,
    "driverId" TEXT,
    "customerId" TEXT,
    "sourceCreatedAt" TIMESTAMP(3),
    "sourceUpdatedAt" TIMESTAMP(3),
    "firstSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ExternalSourceLink_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ExternalSourceLink_exactly_one_entity_check" CHECK (num_nonnulls("truckId", "trailerId", "driverId", "customerId") = 1),
    CONSTRAINT "ExternalSourceLink_resource_entity_check" CHECK (
      ("resourceType" = 'TRUCK' AND "truckId" IS NOT NULL) OR
      ("resourceType" = 'TRAILER' AND "trailerId" IS NOT NULL) OR
      ("resourceType" = 'DRIVER' AND "driverId" IS NOT NULL) OR
      ("resourceType" = 'CUSTOMER' AND "customerId" IS NOT NULL)
    )
);

CREATE TABLE "ExternalSyncRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "resourceType" "ExternalSyncResourceType" NOT NULL,
    "externalId" TEXT NOT NULL,
    "disposition" "ExternalSyncDisposition" NOT NULL,
    "fleetPilotEntityId" TEXT,
    "sourceHashSha256" TEXT NOT NULL,
    "candidate" JSONB NOT NULL,
    "message" TEXT,
    "externalSourceLinkId" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExternalSyncRow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ExternalSyncBatch_companyId_provider_createdAt_idx" ON "ExternalSyncBatch"("companyId", "provider", "createdAt");
CREATE INDEX "ExternalSyncBatch_actorUserId_createdAt_idx" ON "ExternalSyncBatch"("actorUserId", "createdAt");
CREATE UNIQUE INDEX "ExternalSourceLink_companyId_provider_resourceType_externalId_key" ON "ExternalSourceLink"("companyId", "provider", "resourceType", "externalId");
CREATE UNIQUE INDEX "ExternalSourceLink_companyId_provider_resourceType_truckId_key" ON "ExternalSourceLink"("companyId", "provider", "resourceType", "truckId");
CREATE UNIQUE INDEX "ExternalSourceLink_companyId_provider_resourceType_trailerId_key" ON "ExternalSourceLink"("companyId", "provider", "resourceType", "trailerId");
CREATE UNIQUE INDEX "ExternalSourceLink_companyId_provider_resourceType_driverId_key" ON "ExternalSourceLink"("companyId", "provider", "resourceType", "driverId");
CREATE UNIQUE INDEX "ExternalSourceLink_companyId_provider_resourceType_customerId_key" ON "ExternalSourceLink"("companyId", "provider", "resourceType", "customerId");
CREATE INDEX "ExternalSourceLink_companyId_resourceType_lastSyncedAt_idx" ON "ExternalSourceLink"("companyId", "resourceType", "lastSyncedAt");
CREATE UNIQUE INDEX "ExternalSyncRow_batchId_resourceType_externalId_key" ON "ExternalSyncRow"("batchId", "resourceType", "externalId");
CREATE INDEX "ExternalSyncRow_batchId_disposition_resourceType_idx" ON "ExternalSyncRow"("batchId", "disposition", "resourceType");
CREATE INDEX "ExternalSyncRow_externalSourceLinkId_idx" ON "ExternalSyncRow"("externalSourceLinkId");

ALTER TABLE "ExternalSyncBatch" ADD CONSTRAINT "ExternalSyncBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalSyncBatch" ADD CONSTRAINT "ExternalSyncBatch_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalSourceLink" ADD CONSTRAINT "ExternalSourceLink_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalSourceLink" ADD CONSTRAINT "ExternalSourceLink_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalSourceLink" ADD CONSTRAINT "ExternalSourceLink_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalSourceLink" ADD CONSTRAINT "ExternalSourceLink_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalSourceLink" ADD CONSTRAINT "ExternalSourceLink_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalSyncRow" ADD CONSTRAINT "ExternalSyncRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ExternalSyncBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ExternalSyncRow" ADD CONSTRAINT "ExternalSyncRow_externalSourceLinkId_fkey" FOREIGN KEY ("externalSourceLinkId") REFERENCES "ExternalSourceLink"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
