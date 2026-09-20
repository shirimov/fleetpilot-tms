import { prisma } from "@/lib/prisma";
import {
  ArchiveCaptureRunService,
  type CaptureContext,
} from "@/lib/finance/archive-capture-run";
export async function fixtureCaptureRun(c: CaptureContext) {
  const companies = await prisma.archiveCompany.findMany({
    where: {
      operatingGroupId: c.operatingGroupId,
      companyId: { in: c.companyIds },
      company: { memberships: { some: { userId: c.userId, role: "OWNER" } } },
    },
  });
  if (!companies.length) throw Error("Bind the fixture companies first");
  process.env.QUICKMANAGE_CAPTURE_ENABLED = "true";
  process.env.QUICKMANAGE_BROWSER_BRIDGE_ENABLED = "true";
  process.env.QUICKMANAGE_ARCHIVE_ENABLED = "true";
  process.env.QUICKMANAGE_ARCHIVE_OPERATING_GROUP_ID = c.operatingGroupId;
  process.env.QUICKMANAGE_ARCHIVE_ACCOUNT_KEY = companies[0].accountKey;
  const service = new ArchiveCaptureRunService();
  if (c.captureRunId) await service.transition(c.captureRunId, "CLOSED", c);
  const run = await service.create(
    companies.map((x) => x.providerCompanyId),
    "Synthetic test run",
    c,
  );
  await service.transition(run.id, "ACTIVE", c);
  c.captureRunId = run.id;
  return run.id;
}
