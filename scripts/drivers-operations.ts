import { prisma } from "../src/lib/prisma";
import {
  configureReminderPolicy,
  runDriverReminders,
} from "../src/lib/drivers/reminder-service";
import {
  backupDriverDocuments,
  restoreDriverDocuments,
  inspectDriverStorage,
} from "../src/lib/drivers/document-recovery";
import { scanDocument } from "../src/lib/drivers/document-scanner";

async function main() {
  if (process.env.DRIVERS_OPERATIONS_ENABLED !== "true")
    throw new Error("Drivers operations are disabled.");
  const [command, companyId, location, destination] = process.argv.slice(2);
  if (!companyId || !/^[a-zA-Z0-9_-]{1,100}$/.test(companyId))
    throw new Error("Explicit company ID required.");
  switch (command) {
    case "configure-policy":
      return configureReminderPolicy(
        companyId,
        JSON.parse(process.env.DRIVERS_REMINDER_POLICY_JSON || "null"),
      ).then(() => ({ configured: true }));
    case "reminders":
      return runDriverReminders(companyId);
    case "backup":
      if (!location) throw new Error("New absolute backup directory required.");
      return backupDriverDocuments(companyId, location);
    case "restore":
      if (!location || !destination)
        throw new Error("Backup source and new recovery destination required.");
      return restoreDriverDocuments(location, destination, companyId);
    case "health": {
      const storage = await inspectDriverStorage(companyId);
      const scan = await scanDocument(
        Buffer.from("%PDF-1.4\nDrivers scanner health probe\n%%EOF"),
      );
      if (
        storage.missing ||
        storage.corrupt ||
        (process.env.NODE_ENV === "production" && scan.status !== "CLEAN")
      )
        throw new Error("Drivers health check failed.");
      return { ...storage, scanner: scan.status };
    }
    default:
      throw new Error(
        "Use configure-policy, reminders, backup, restore or health.",
      );
  }
}
main()
  .then((result) => console.log(JSON.stringify(result)))
  .catch(() => {
    console.error(
      "Drivers operation failed; inspect private service diagnostics. No credentials or document contents are logged.",
    );
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
