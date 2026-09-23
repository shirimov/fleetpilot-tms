ALTER TABLE "FuelDeductionPolicy"
  ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "FuelDeductionPolicyRevision" (
  "id" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "before" JSONB NOT NULL,
  "after" JSONB NOT NULL,
  "reason" TEXT NOT NULL,
  "evidenceReferences" JSONB NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FuelDeductionPolicyRevision_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "FuelDeductionPolicyRevision" ADD CONSTRAINT "FuelDeductionPolicyRevision_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "FuelDeductionPolicy"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FuelDeductionPolicyRevision" ADD CONSTRAINT "FuelDeductionPolicyRevision_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "FuelDeductionPolicyRevision_policyId_revision_key" ON "FuelDeductionPolicyRevision"("policyId", "revision");
CREATE INDEX "FuelDeductionPolicyRevision_policyId_changedAt_idx" ON "FuelDeductionPolicyRevision"("policyId", "changedAt");
CREATE INDEX "FuelDeductionPolicyRevision_actorUserId_changedAt_idx" ON "FuelDeductionPolicyRevision"("actorUserId", "changedAt");

CREATE FUNCTION fuel_policy_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Fuel deduction policy revision history is immutable' USING ERRCODE = '23514';
END $$;

CREATE TRIGGER fuel_policy_revision_immutable
  BEFORE UPDATE OR DELETE ON "FuelDeductionPolicyRevision"
  FOR EACH ROW EXECUTE FUNCTION fuel_policy_revision_immutable();
