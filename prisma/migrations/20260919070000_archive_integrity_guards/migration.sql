-- Preserve UTC instant comparisons regardless of a database session's timezone.
CREATE OR REPLACE VIEW "ArchiveCoverage" AS
SELECT i.id, i."archiveCompanyId", i.pid, i."observedAt", i."expectedCount"::bigint AS expected,
 (SELECT count(*) FROM "ArchiveInventoryItem" e WHERE e."inventoryId"=i.id AND EXISTS (
   SELECT 1 FROM "ArchiveStatement" s JOIN "ArchiveVersion" v ON v."statementId"=s.id
   WHERE s."archiveCompanyId"=i."archiveCompanyId" AND s."providerStatementId"=e."providerStatementId"
     AND v."providerVersion"=e."providerVersion" AND v.sealed AND v.pid=i.pid AND v."recipientId"=e."recipientId" AND (e."providerUpdatedAt" IS NULL OR v."providerUpdatedAt"=(e."providerUpdatedAt"::timestamptz AT TIME ZONE 'UTC'))
 )) AS captured,
 (SELECT count(*) FROM "ArchiveInventoryItem" e WHERE e."inventoryId"=i.id AND EXISTS (
   SELECT 1 FROM "ArchiveStatement" s WHERE s."archiveCompanyId"=i."archiveCompanyId" AND s."providerStatementId"=e."providerStatementId"
     AND (s.status <> 'PARSED' OR s."latestProviderVersion" <> e."providerVersion" OR s."acceptedProviderVersion" <> s."latestProviderVersion")
 )) AS conflicts,
 (SELECT count(*) FROM "ArchiveStatement" s WHERE s."archiveCompanyId"=i."archiveCompanyId"
   AND EXISTS (SELECT 1 FROM "ArchiveVersion" v WHERE v."statementId"=s.id AND v.pid=i.pid AND v.sealed)
   AND NOT EXISTS (SELECT 1 FROM "ArchiveInventoryItem" e WHERE e."inventoryId"=i.id AND e."providerStatementId"=s."providerStatementId")
 ) AS unexpected,
 (SELECT count(*) FROM "ArchiveInventoryItem" e JOIN "ArchiveCaptureJob" j ON j."itemId"=e.id
   WHERE e."inventoryId"=i.id AND (j.status IN ('FAILED','NEEDS_REVIEW') OR (j.status='CAPTURING' AND j."leaseExpiresAt"<now()))) AS failed
FROM "ArchiveInventory" i WHERE i.sealed;

-- An unseen parent must fail closed rather than pass a NULL sealed check and
-- later become visible during foreign-key validation after another transaction commits.
CREATE OR REPLACE FUNCTION archive_child_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE closed boolean;
BEGIN
  IF TG_TABLE_NAME = 'ArchiveInventoryItem' THEN SELECT sealed INTO closed FROM "ArchiveInventory" WHERE id = NEW."inventoryId";
  ELSE SELECT sealed INTO closed FROM "ArchiveVersion" WHERE id = NEW."versionId"; END IF;
  IF closed IS DISTINCT FROM false THEN RAISE EXCEPTION 'Cannot append to sealed or unavailable archive evidence' USING ERRCODE = '23514'; END IF;
  RETURN NEW;
END $$;
