ALTER TYPE "ExternalSyncResourceType" ADD VALUE 'TRIP';

ALTER TABLE "ExternalSourceLink" ADD COLUMN "loadId" TEXT;

ALTER TABLE "ExternalSourceLink" DROP CONSTRAINT "ExternalSourceLink_exactly_one_entity_check";
ALTER TABLE "ExternalSourceLink" DROP CONSTRAINT "ExternalSourceLink_resource_entity_check";

ALTER TABLE "ExternalSourceLink" ADD CONSTRAINT "ExternalSourceLink_exactly_one_entity_check"
CHECK (num_nonnulls("truckId", "trailerId", "driverId", "customerId", "loadId") = 1);

ALTER TABLE "ExternalSourceLink" ADD CONSTRAINT "ExternalSourceLink_resource_entity_check" CHECK (
  ("resourceType" = 'TRUCK' AND "truckId" IS NOT NULL) OR
  ("resourceType" = 'TRAILER' AND "trailerId" IS NOT NULL) OR
  ("resourceType" = 'DRIVER' AND "driverId" IS NOT NULL) OR
  ("resourceType" = 'CUSTOMER' AND "customerId" IS NOT NULL) OR
  ("resourceType" = 'TRIP' AND "loadId" IS NOT NULL)
);

CREATE UNIQUE INDEX "ExternalSourceLink_companyId_provider_resourceType_loadId_key"
ON "ExternalSourceLink"("companyId", "provider", "resourceType", "loadId");

ALTER TABLE "ExternalSourceLink" ADD CONSTRAINT "ExternalSourceLink_loadId_fkey"
FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
