CREATE TABLE "HistoricalTruckMapping" (
    "id" TEXT NOT NULL,
    "operatingGroupId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerTruckId" TEXT NOT NULL,
    "truckId" TEXT NOT NULL,
    "evidenceReferences" JSONB NOT NULL,
    "sourceReference" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "HistoricalTruckMapping_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HistoricalTruckMapping_operatingGroupId_provider_providerTruckId_key"
ON "HistoricalTruckMapping"("operatingGroupId", "provider", "providerTruckId");
CREATE INDEX "HistoricalTruckMapping_truckId_createdAt_idx" ON "HistoricalTruckMapping"("truckId", "createdAt");
CREATE INDEX "HistoricalTruckMapping_createdByUserId_createdAt_idx" ON "HistoricalTruckMapping"("createdByUserId", "createdAt");

ALTER TABLE "HistoricalTruckMapping" ADD CONSTRAINT "HistoricalTruckMapping_operatingGroupId_fkey"
FOREIGN KEY ("operatingGroupId") REFERENCES "OperatingGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HistoricalTruckMapping" ADD CONSTRAINT "HistoricalTruckMapping_truckId_fkey"
FOREIGN KEY ("truckId") REFERENCES "Truck"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "HistoricalTruckMapping" ADD CONSTRAINT "HistoricalTruckMapping_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION historical_truck_mapping_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Historical Truck mappings are immutable' USING ERRCODE = '23514';
END $$;

CREATE TRIGGER historical_truck_mapping_immutable
  BEFORE UPDATE OR DELETE ON "HistoricalTruckMapping"
  FOR EACH ROW EXECUTE FUNCTION historical_truck_mapping_immutable();
