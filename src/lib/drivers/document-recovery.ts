import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  open,
  readdir,
  realpath,
} from "node:fs/promises";
import path from "node:path";
import type { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { driverStorage, quarantineStorage } from "./document-storage";
import {
  decryptEnvelope,
  encryptEnvelope,
  privateNamespace,
  storageKeys,
} from "./secure-storage";

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const validKey =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Manifest = {
  format: 1;
  companyId: string;
  createdAt: string;
  documents: unknown[];
  versions: unknown[];
  scans: unknown[];
  files: {
    namespace: "driver-documents" | "driver-quarantine";
    key: string;
    digest: string;
    backupDigest: string;
  }[];
};
function backupKey() {
  const value = process.env.DRIVERS_BACKUP_KEY;
  if (!value || !/^[a-fA-F0-9]{64}$/.test(value))
    throw new Error("A separate 256-bit backup key is required.");
  return Buffer.from(value, "hex");
}
async function readPrivate(filename: string, maxSize = 16 * 1024 * 1024) {
  const file = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > maxSize || (stat.mode & 0o077) !== 0)
      throw new Error("Unsafe recovery file.");
    return await file.readFile();
  } finally {
    await file.close();
  }
}
async function writePrivate(filename: string, bytes: Uint8Array) {
  const file = await open(filename, "wx", 0o600);
  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }
}
async function newPrivateDirectory(directory: string) {
  if (!path.isAbsolute(directory))
    throw new Error("Recovery directory must be absolute.");
  const parent = await realpath(path.dirname(directory));
  const publicRoot = await realpath(path.join(process.cwd(), "public"));
  if (parent === publicRoot || parent.startsWith(publicRoot + path.sep))
    throw new Error("Recovery directory cannot be public.");
  const target = path.join(parent, path.basename(directory));
  await mkdir(target, { mode: 0o700 }); // Never overwrite or reuse a destination.
  const parentDirectory = await open(parent, "r");
  try {
    await parentDirectory.sync();
  } finally {
    await parentDirectory.close();
  }
  return target;
}
export async function backupDriverDocuments(
  companyId: string,
  destination: string,
  database: PrismaClient = prisma,
) {
  const key = backupKey(),
    target = await newPrivateDirectory(destination);
  const snapshot = await database.$transaction(
    async (tx) => ({
      documents: await tx.driverDocument.findMany({ where: { companyId } }),
      versions: await tx.driverDocumentVersion.findMany({
        where: { document: { companyId } },
      }),
      scans: await tx.driverDocumentScan.findMany({ where: { companyId } }),
    }),
    { isolationLevel: "RepeatableRead" },
  );
  const manifest: Manifest = {
    format: 1,
    companyId,
    createdAt: new Date().toISOString(),
    ...snapshot,
    files: [],
  };
  const references = new Map<
    string,
    {
      namespace: Manifest["files"][number]["namespace"];
      key: string;
      sha256: string;
      byteSize: number;
    }
  >();
  for (const version of snapshot.versions)
    references.set("driver-documents/" + version.storageKey, {
      namespace: "driver-documents",
      key: version.storageKey,
      sha256: version.sha256,
      byteSize: version.byteSize,
    });
  for (const scan of snapshot.scans)
    references.set("driver-quarantine/" + scan.quarantineKey, {
      namespace: "driver-quarantine",
      key: scan.quarantineKey,
      sha256: scan.sha256,
      byteSize: scan.byteSize,
    });
  for (const reference of references.values()) {
    if (!validKey.test(reference.key))
      throw new Error("Invalid recovery reference.");
    const bytes = await readPrivate(
      path.join(await privateNamespace(reference.namespace), reference.key),
    );
    const plaintext =
      bytes.subarray(0, 7).toString() === "FPDRV1:"
        ? decryptEnvelope(bytes, storageKeys().keys, reference.namespace)
        : bytes;
    if (
      plaintext.length !== reference.byteSize ||
      digest(plaintext) !== reference.sha256
    )
      throw new Error(
        "Referenced document integrity failure; backup remains incomplete.",
      );
    const sealed = encryptEnvelope(
      bytes,
      key,
      "backup",
      reference.namespace + "/" + reference.key,
    );
    await writePrivate(
      path.join(target, reference.namespace + "-" + reference.key),
      sealed,
    );
    manifest.files.push({
      ...reference,
      digest: digest(bytes),
      backupDigest: digest(sealed),
    });
  }
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  // Always produce a manifest the bounded recovery reader can accept.
  if (manifestBytes.length > 127 * 1024 * 1024)
    throw new Error(
      "Document backup metadata exceeds the supported set size; no completion marker written.",
    );
  const encryptedManifest = encryptEnvelope(
    manifestBytes,
    key,
    "backup",
    "manifest",
  );
  await writePrivate(path.join(target, "manifest.enc"), encryptedManifest);
  await writePrivate(
    path.join(target, "complete"),
    Buffer.from(digest(encryptedManifest)),
  );
  const directory = await open(target, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  return { files: manifest.files.length, versions: snapshot.versions.length };
}
export async function restoreDriverDocuments(
  source: string,
  destination: string,
  expectedCompanyId: string,
) {
  const stat = await lstat(source);
  if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0)
    throw new Error("Unsafe backup directory.");
  const key = backupKey(),
    encrypted = await readPrivate(
      path.join(source, "manifest.enc"),
      128 * 1024 * 1024,
    );
  if (
    (await readPrivate(path.join(source, "complete"))).toString() !==
    digest(encrypted)
  )
    throw new Error("Incomplete backup.");
  const manifest = JSON.parse(
    decryptEnvelope(encrypted, { backup: key }, "manifest").toString(),
  ) as Manifest;
  if (
    manifest.format !== 1 ||
    manifest.companyId !== expectedCompanyId ||
    !Array.isArray(manifest.files)
  )
    throw new Error("Backup scope mismatch.");
  // Validate every artifact before creating a destination; no existing files/database are changed.
  for (const reference of manifest.files) {
    if (
      !["driver-documents", "driver-quarantine"].includes(
        reference.namespace,
      ) ||
      !validKey.test(reference.key)
    )
      throw new Error("Invalid backup path.");
    const sealed = await readPrivate(
      path.join(source, reference.namespace + "-" + reference.key),
    );
    if (
      digest(sealed) !== reference.backupDigest ||
      digest(
        decryptEnvelope(
          sealed,
          { backup: key },
          reference.namespace + "/" + reference.key,
        ),
      ) !== reference.digest
    )
      throw new Error("Backup integrity failure.");
  }
  const target = await newPrivateDirectory(destination);
  for (const namespace of ["driver-documents", "driver-quarantine"])
    await mkdir(path.join(target, namespace), { mode: 0o700 });
  for (const reference of manifest.files) {
    const sealed = await readPrivate(
      path.join(source, reference.namespace + "-" + reference.key),
    );
    const restored = decryptEnvelope(
      sealed,
      { backup: key },
      reference.namespace + "/" + reference.key,
    );
    if (
      digest(sealed) !== reference.backupDigest ||
      digest(restored) !== reference.digest
    )
      throw new Error(
        "Backup changed during recovery; destination remains incomplete.",
      );
    await writePrivate(
      path.join(target, reference.namespace, reference.key),
      restored,
    );
  }
  await writePrivate(
    path.join(target, "document-metadata.json"),
    Buffer.from(JSON.stringify(manifest)),
  );
  for (const namespace of ["driver-documents", "driver-quarantine"]) {
    const directory = await open(path.join(target, namespace), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  }
  await writePrivate(
    path.join(target, "restore.complete"),
    Buffer.from(digest(encrypted)),
  );
  const recoveredDirectory = await open(target, "r");
  try {
    await recoveredDirectory.sync();
  } finally {
    await recoveredDirectory.close();
  }
  return { files: manifest.files.length, versions: manifest.versions.length };
}
export async function inspectDriverStorage(
  companyId: string,
  database: PrismaClient = prisma,
) {
  storageKeys();
  const active = await driverStorage(),
    quarantine = await quarantineStorage();
  const versions = await database.driverDocumentVersion.findMany({
    where: { document: { companyId } },
  });
  const scans = await database.driverDocumentScan.findMany({
    where: { companyId },
  });
  let missing = 0,
    corrupt = 0;
  const references = [
    ...versions.map((version) => ({
      key: version.storageKey,
      sha256: version.sha256,
      byteSize: version.byteSize,
      store: active,
      namespace: "driver-documents",
    })),
    ...scans.map((scan) => ({
      key: scan.quarantineKey,
      sha256: scan.sha256,
      byteSize: scan.byteSize,
      store: quarantine,
      namespace: "driver-quarantine",
    })),
  ];
  // Date-only revisions share a blob: count physical files, not version references.
  const unique = new Map<string, typeof references>();
  for (const reference of references) {
    const key = reference.namespace + "/" + reference.key;
    unique.set(key, [...(unique.get(key) || []), reference]);
  }
  for (const group of unique.values()) {
    const reference = group[0];
    if (
      group.some(
        (entry) =>
          entry.sha256 !== reference.sha256 ||
          entry.byteSize !== reference.byteSize,
      )
    ) {
      corrupt++;
      continue;
    }
    try {
      const bytes = await reference.store.get(reference.key);
      if (
        bytes.length !== reference.byteSize ||
        digest(bytes) !== reference.sha256
      )
        corrupt++;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") missing++;
      else corrupt++;
    }
  }
  // Orphans are global to a namespace, not attributed to an arbitrary company.
  const allVersions = await database.driverDocumentVersion.findMany({
    select: { storageKey: true },
  });
  const allScans = await database.driverDocumentScan.findMany({
    select: { quarantineKey: true },
  });
  let globalOrphans = 0;
  for (const [namespace, references] of [
    ["driver-documents", new Set(allVersions.map((v) => v.storageKey))],
    ["driver-quarantine", new Set(allScans.map((s) => s.quarantineKey))],
  ] as const) {
    const directory = await privateNamespace(namespace);
    await access(directory, constants.R_OK | constants.W_OK);
    globalOrphans += (await readdir(directory)).filter(
      (name) => !references.has(name),
    ).length;
  }
  return {
    versions: versions.length,
    scans: scans.length,
    missing,
    corrupt,
    globalOrphans,
  };
}
