-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "TrailerEquipmentType" AS ENUM ('DRY_VAN', 'REEFER', 'FLATBED', 'STEP_DECK', 'POWER_ONLY', 'OTHER');

-- CreateEnum
CREATE TYPE "TrailerStatus" AS ENUM ('AVAILABLE', 'ASSIGNED', 'IN_TRANSIT', 'MAINTENANCE', 'OUT_OF_SERVICE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "LoadStopType" AS ENUM ('PICKUP', 'DELIVERY');

-- CreateEnum
CREATE TYPE "DispatchDocumentType" AS ENUM ('RATE_CONFIRMATION', 'BOL', 'POD', 'RECEIPT', 'TRAILER_REGISTRATION', 'TRAILER_INSURANCE', 'TRAILER_INSPECTION', 'OTHER');

-- CreateEnum
CREATE TYPE "LoadActivityAction" AS ENUM ('LOAD_CREATED', 'LOAD_UPDATED', 'STATUS_CHANGED', 'ASSIGNMENT_CHANGED', 'STOP_CREATED', 'STOP_UPDATED', 'STOP_DELETED', 'DOCUMENT_ADDED', 'DOCUMENT_REMOVED');

-- Extend the existing enum without rewriting legacy values.
ALTER TYPE "LoadStatus" ADD VALUE 'DRAFT';
ALTER TYPE "LoadStatus" ADD VALUE 'PLANNED';
ALTER TYPE "LoadStatus" ADD VALUE 'ASSIGNED';
ALTER TYPE "LoadStatus" ADD VALUE 'DISPATCHED';
ALTER TYPE "LoadStatus" ADD VALUE 'PICKED_UP';
ALTER TYPE "LoadStatus" ADD VALUE 'POD_UPLOADED';
ALTER TYPE "LoadStatus" ADD VALUE 'INVOICED';
ALTER TYPE "LoadStatus" ADD VALUE 'PAID';

-- Relax the legacy required truck relation so drafts can be unassigned.
ALTER TABLE "Load" DROP CONSTRAINT "Load_truckId_fkey";

ALTER TABLE "Load"
ADD COLUMN "customerId" TEXT,
ADD COLUMN "invoiceNumber" TEXT,
ADD COLUMN "notes" TEXT,
ADD COLUMN "trailerId" TEXT,
ALTER COLUMN "status" SET DEFAULT 'DRAFT',
ALTER COLUMN "truckId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Customer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "mcNumber" TEXT,
    "dotNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Customer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CustomerContact" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "CustomerContact_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Trailer" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "unitNumber" TEXT NOT NULL,
    "equipmentType" "TrailerEquipmentType" NOT NULL DEFAULT 'DRY_VAN',
    "status" "TrailerStatus" NOT NULL DEFAULT 'AVAILABLE',
    "vin" TEXT,
    "plate" TEXT,
    "state" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Trailer_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoadStop" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "type" "LoadStopType" NOT NULL,
    "order" INTEGER NOT NULL,
    "facilityName" TEXT NOT NULL,
    "addressLine1" TEXT,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT,
    "postalCode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'US',
    "contactId" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "appointmentStart" TIMESTAMP(3),
    "appointmentEnd" TIMESTAMP(3),
    "arrivedAt" TIMESTAMP(3),
    "departedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LoadStop_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoadDocument" (
    "id" TEXT NOT NULL,
    "loadId" TEXT NOT NULL,
    "type" "DispatchDocumentType" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "displayFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "uploaderUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoadDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TrailerDocument" (
    "id" TEXT NOT NULL,
    "trailerId" TEXT NOT NULL,
    "type" "DispatchDocumentType" NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "displayFilename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "uploaderUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TrailerDocument_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoadActivity" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "loadId" TEXT,
    "loadNumber" TEXT NOT NULL,
    "action" "LoadActivityAction" NOT NULL,
    "actorUserId" TEXT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Customer_companyId_status_name_idx" ON "Customer"("companyId", "status", "name");
CREATE UNIQUE INDEX "Customer_companyId_name_key" ON "Customer"("companyId", "name");
CREATE INDEX "CustomerContact_customerId_name_idx" ON "CustomerContact"("customerId", "name");
CREATE INDEX "Trailer_companyId_status_equipmentType_idx" ON "Trailer"("companyId", "status", "equipmentType");
CREATE UNIQUE INDEX "Trailer_companyId_unitNumber_key" ON "Trailer"("companyId", "unitNumber");
CREATE INDEX "LoadStop_loadId_type_order_idx" ON "LoadStop"("loadId", "type", "order");
CREATE INDEX "LoadStop_contactId_idx" ON "LoadStop"("contactId");
CREATE UNIQUE INDEX "LoadStop_loadId_order_key" ON "LoadStop"("loadId", "order");
CREATE UNIQUE INDEX "LoadDocument_storageKey_key" ON "LoadDocument"("storageKey");
CREATE INDEX "LoadDocument_loadId_type_createdAt_idx" ON "LoadDocument"("loadId", "type", "createdAt");
CREATE INDEX "LoadDocument_uploaderUserId_idx" ON "LoadDocument"("uploaderUserId");
CREATE UNIQUE INDEX "TrailerDocument_storageKey_key" ON "TrailerDocument"("storageKey");
CREATE INDEX "TrailerDocument_trailerId_type_createdAt_idx" ON "TrailerDocument"("trailerId", "type", "createdAt");
CREATE INDEX "TrailerDocument_uploaderUserId_idx" ON "TrailerDocument"("uploaderUserId");
CREATE INDEX "LoadActivity_companyId_occurredAt_id_idx" ON "LoadActivity"("companyId", "occurredAt", "id");
CREATE INDEX "LoadActivity_loadId_occurredAt_id_idx" ON "LoadActivity"("loadId", "occurredAt", "id");
CREATE INDEX "LoadActivity_actorUserId_occurredAt_id_idx" ON "LoadActivity"("actorUserId", "occurredAt", "id");
CREATE INDEX "Load_companyId_status_pickupDate_idx" ON "Load"("companyId", "status", "pickupDate");
CREATE INDEX "Load_companyId_truckId_pickupDate_deliveryDate_idx" ON "Load"("companyId", "truckId", "pickupDate", "deliveryDate");
CREATE INDEX "Load_companyId_driverId_pickupDate_deliveryDate_idx" ON "Load"("companyId", "driverId", "pickupDate", "deliveryDate");
CREATE INDEX "Load_companyId_trailerId_pickupDate_deliveryDate_idx" ON "Load"("companyId", "trailerId", "pickupDate", "deliveryDate");
CREATE INDEX "Load_customerId_idx" ON "Load"("customerId");

-- AddForeignKey
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CustomerContact" ADD CONSTRAINT "CustomerContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Trailer" ADD CONSTRAINT "Trailer_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Load" ADD CONSTRAINT "Load_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Load" ADD CONSTRAINT "Load_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Load" ADD CONSTRAINT "Load_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LoadStop" ADD CONSTRAINT "LoadStop_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoadStop" ADD CONSTRAINT "LoadStop_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CustomerContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LoadDocument" ADD CONSTRAINT "LoadDocument_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoadDocument" ADD CONSTRAINT "LoadDocument_uploaderUserId_fkey" FOREIGN KEY ("uploaderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "TrailerDocument" ADD CONSTRAINT "TrailerDocument_trailerId_fkey" FOREIGN KEY ("trailerId") REFERENCES "Trailer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrailerDocument" ADD CONSTRAINT "TrailerDocument_uploaderUserId_fkey" FOREIGN KEY ("uploaderUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LoadActivity" ADD CONSTRAINT "LoadActivity_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LoadActivity" ADD CONSTRAINT "LoadActivity_loadId_fkey" FOREIGN KEY ("loadId") REFERENCES "Load"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LoadActivity" ADD CONSTRAINT "LoadActivity_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
