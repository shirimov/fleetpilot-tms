-- Canonical normalized keys preserve display unit numbers (including leading zeros)
-- while making duplicate prevention deterministic and concurrency-safe.
ALTER TABLE "Truck" ADD COLUMN "unitNumberNormalized" TEXT;
ALTER TABLE "Truck" ADD COLUMN "vinNormalized" TEXT;

UPDATE "Truck"
SET "unitNumberNormalized" = UPPER(REGEXP_REPLACE(TRIM("unitNumber"), '\\s+', ' ', 'g')),
    "vinNormalized" = NULLIF(UPPER(REGEXP_REPLACE(TRIM(COALESCE("vin", '')), '\\s+', '', 'g')), '');

CREATE FUNCTION "normalize_truck_identifiers"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW."unitNumber" := TRIM(NEW."unitNumber");
  NEW."unitNumberNormalized" := UPPER(REGEXP_REPLACE(NEW."unitNumber", '\s+', ' ', 'g'));
  IF NEW."unitNumberNormalized" = '' THEN
    RAISE EXCEPTION 'Truck unit number is required';
  END IF;
  NEW."vin" := NULLIF(TRIM(COALESCE(NEW."vin", '')), '');
  NEW."vinNormalized" := NULLIF(UPPER(REGEXP_REPLACE(COALESCE(NEW."vin", ''), '[\s-]+', '', 'g')), '');
  RETURN NEW;
END $$;

CREATE TRIGGER "Truck_normalize_identifiers"
  BEFORE INSERT OR UPDATE ON "Truck"
  FOR EACH ROW EXECUTE FUNCTION "normalize_truck_identifiers"();

ALTER TABLE "Truck" ALTER COLUMN "unitNumberNormalized" SET NOT NULL;

CREATE UNIQUE INDEX "Truck_companyId_unitNumberNormalized_key"
  ON "Truck"("companyId", "unitNumberNormalized");
CREATE UNIQUE INDEX "Truck_vinNormalized_key" ON "Truck"("vinNormalized");
CREATE INDEX "Truck_companyId_status_unitNumber_idx" ON "Truck"("companyId", "status", "unitNumber");
DROP INDEX "Truck_unitNumber_key";

CREATE TYPE "TruckImportStatus" AS ENUM ('PREVIEWED', 'COMMITTED');
CREATE TYPE "TruckImportRowDisposition" AS ENUM ('NEW', 'MATCHED', 'CONFLICT', 'REJECTED');

CREATE TABLE "TruckImportBatch" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "originalName" TEXT NOT NULL,
  "checksumSha256" TEXT NOT NULL,
  "status" "TruckImportStatus" NOT NULL DEFAULT 'PREVIEWED',
  "totalRows" INTEGER NOT NULL,
  "newRows" INTEGER NOT NULL,
  "matchedRows" INTEGER NOT NULL,
  "conflictRows" INTEGER NOT NULL,
  "rejectedRows" INTEGER NOT NULL,
  "committedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TruckImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TruckImportRow" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "rowNumber" INTEGER NOT NULL,
  "disposition" "TruckImportRowDisposition" NOT NULL,
  "unitNumber" TEXT,
  "unitNumberNormalized" TEXT,
  "vin" TEXT,
  "vinNormalized" TEXT,
  "status" "TruckStatus",
  "year" INTEGER,
  "make" TEXT,
  "model" TEXT,
  "existingTruckId" TEXT,
  "message" TEXT,
  "createdTruckId" TEXT,
  CONSTRAINT "TruckImportRow_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TruckImportBatch_companyId_checksumSha256_key" ON "TruckImportBatch"("companyId", "checksumSha256");
CREATE INDEX "TruckImportBatch_companyId_createdAt_idx" ON "TruckImportBatch"("companyId", "createdAt");
CREATE UNIQUE INDEX "TruckImportRow_batchId_rowNumber_key" ON "TruckImportRow"("batchId", "rowNumber");
CREATE INDEX "TruckImportRow_batchId_disposition_idx" ON "TruckImportRow"("batchId", "disposition");
CREATE INDEX "TruckImportRow_existingTruckId_idx" ON "TruckImportRow"("existingTruckId");

ALTER TABLE "TruckImportBatch" ADD CONSTRAINT "TruckImportBatch_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TruckImportBatch" ADD CONSTRAINT "TruckImportBatch_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TruckImportRow" ADD CONSTRAINT "TruckImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "TruckImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TruckImportRow" ADD CONSTRAINT "TruckImportRow_existingTruckId_fkey" FOREIGN KEY ("existingTruckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
