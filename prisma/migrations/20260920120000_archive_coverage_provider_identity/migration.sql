-- Provider UUID/version is identity within the bound Company, PID and recipient.
-- Timestamps are freshness metadata, not identity. No sealed evidence is updated.
CREATE OR REPLACE VIEW "ArchiveCoverage" AS
SELECT i.id, i."archiveCompanyId", i.pid, i."observedAt", i."expectedCount"::bigint AS expected,
 (SELECT count(*) FROM "ArchiveInventoryItem" e WHERE e."inventoryId"=i.id AND EXISTS (
   SELECT 1 FROM "ArchiveStatement" s JOIN "ArchiveVersion" v ON v."statementId"=s.id
   WHERE s."archiveCompanyId"=i."archiveCompanyId" AND s."providerStatementId"=e."providerStatementId"
     AND v."providerVersion"=e."providerVersion" AND v.sealed AND v.pid=i.pid AND v."recipientId"=e."recipientId" AND v."recipientType"=e."recipientType"
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
