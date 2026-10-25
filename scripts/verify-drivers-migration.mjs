import { mkdtemp, readdir, mkdir, cp, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
import pg from "pg";
const url = new URL(process.env.DATABASE_URL || "postgresql://invalid/");
if (
  url.hostname !== "127.0.0.1" ||
  url.port !== "15439" ||
  url.pathname !== "/fleetpilot_drivers_verify"
)
  throw new Error(
    "Migration verification requires the dedicated disposable database.",
  );
const root = process.cwd(),
  target = "20261025080000_drivers_production_readiness";
const temporary = await mkdtemp(path.join(os.tmpdir(), "drivers-migration-"));
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  const migrations = path.join(temporary, "migrations");
  await mkdir(migrations);
  for (const name of await readdir(path.join(root, "prisma/migrations"))) {
    if (name === "migration_lock.toml" || name < target)
      await cp(
        path.join(root, "prisma/migrations", name),
        path.join(migrations, name),
        { recursive: true },
      );
  }
  const config = path.join(temporary, "prisma.config.ts");
  await writeFile(
    config,
    `export default { schema: ${JSON.stringify(path.join(root, "prisma/schema.prisma"))}, migrations: {path: ${JSON.stringify(migrations)}}, datasource: {url: process.env.DATABASE_URL} };`,
  );
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
      "--config",
      config,
    ],
    { stdio: "inherit", env: process.env },
  );
  await client.connect();
  const prefix = "drivers-upgrade-test-";
  await client.query("BEGIN");
  await client.query(
    'INSERT INTO "Company" (id,name,"updatedAt") VALUES ($1,$2,NOW())',
    [prefix + "company", "Synthetic migration fixture"],
  );
  await client.query(
    'INSERT INTO "Truck" (id,"unitNumber","companyId","updatedAt") VALUES ($1,$2,$3,NOW())',
    [prefix + "truck", "UPGRADE-TEST", prefix + "company"],
  );
  await client.query(
    'INSERT INTO "Driver" (id,"firstName","lastName","payRate","truckId","companyId","updatedAt") VALUES ($1,$2,$3,25,$4,$5,NOW())',
    [
      prefix + "driver",
      "Legacy",
      "Synthetic",
      prefix + "truck",
      prefix + "company",
    ],
  );
  await client.query(
    'INSERT INTO "Load" (id,"loadNumber",origin,destination,rate,"companyId","driverId","truckId","updatedAt") VALUES ($1,$2,$3,$4,2000,$5,$6,$7,NOW())',
    [
      prefix + "load",
      prefix + "load-number",
      "Test A",
      "Test B",
      prefix + "company",
      prefix + "driver",
      prefix + "truck",
    ],
  );
  await client.query(
    'INSERT INTO "Settlement" (id,"weekEnding","truckId","driverId","loadId","grossRevenue","driverPay","netPay","updatedAt") VALUES ($1,NOW(),$2,$3,$4,2000,500,450,NOW())',
    [
      prefix + "settlement",
      prefix + "truck",
      prefix + "driver",
      prefix + "load",
    ],
  );
  const before = (
    await client.query('SELECT * FROM "Driver" WHERE id=$1', [
      prefix + "driver",
    ])
  ).rows[0];
  const settlement = (
    await client.query('SELECT * FROM "Settlement" WHERE id=$1', [
      prefix + "settlement",
    ])
  ).rows[0];
  const truck = (
    await client.query('SELECT * FROM "Truck" WHERE id=$1', [prefix + "truck"])
  ).rows[0];
  const load = (
    await client.query('SELECT * FROM "Load" WHERE id=$1', [prefix + "load"])
  ).rows[0];
  await client.query("COMMIT");
  execFileSync(
    process.execPath,
    [
      path.join(root, "node_modules/prisma/build/index.js"),
      "migrate",
      "deploy",
    ],
    { stdio: "inherit", env: process.env },
  );
  const after = (
    await client.query('SELECT * FROM "Driver" WHERE id=$1', [
      prefix + "driver",
    ])
  ).rows[0];
  for (const key of Object.keys(before))
    if (String(before[key]) !== String(after[key]))
      throw new Error("Migration changed legacy driver " + key);
  if (after.employmentStatus !== null || after.driverType !== null)
    throw new Error("Migration fabricated employment values.");
  const saved = (
    await client.query('SELECT * FROM "Settlement" WHERE id=$1', [
      prefix + "settlement",
    ])
  ).rows[0];
  if (JSON.stringify(saved) !== JSON.stringify(settlement))
    throw new Error("Migration changed historical settlement.");
  for (const [table, suffix, original] of [
    ["Truck", "truck", truck],
    ["Load", "load", load],
  ]) {
    const persisted = (
      await client.query(`SELECT * FROM "${table}" WHERE id=$1`, [
        prefix + suffix,
      ])
    ).rows[0];
    if (JSON.stringify(persisted) !== JSON.stringify(original))
      throw new Error("Migration changed historical " + table);
  }
  await client.query("BEGIN");
  for (const [table, suffix] of [
    ["Settlement", "settlement"],
    ["Load", "load"],
    ["Driver", "driver"],
    ["Truck", "truck"],
    ["Company", "company"],
  ])
    await client.query(`DELETE FROM "${table}" WHERE id=$1`, [prefix + suffix]);
  await client.query("COMMIT");
  console.log(
    "Drivers migration preservation passed: legacy driver, truck assignment, load and settlement unchanged; employment remains unknown.",
  );
} finally {
  await client.end().catch(() => {});
  await rm(temporary, { recursive: true, force: true });
}
