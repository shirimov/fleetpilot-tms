-- CreateTable
CREATE TABLE "TruckInspection" (
    "id" TEXT NOT NULL,
    "truckId" TEXT NOT NULL,
    "inspectedBy" TEXT NOT NULL,
    "inspectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phase1" JSONB NOT NULL,
    "phase2" JSONB NOT NULL,
    "phase3" JSONB NOT NULL,
    "notes" TEXT,
    "passed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TruckInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverOrientation" (
    "id" TEXT NOT NULL,
    "driverId" TEXT NOT NULL,
    "completedBy" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checklist" JSONB NOT NULL,
    "signature" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DriverOrientation_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "TruckInspection" ADD CONSTRAINT "TruckInspection_truckId_fkey" FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverOrientation" ADD CONSTRAINT "DriverOrientation_driverId_fkey" FOREIGN KEY ("driverId") REFERENCES "Driver"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
