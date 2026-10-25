import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import path from "node:path";
import type { PrivateFileStorage } from "@/lib/storage/private-file-storage";

const magic = Buffer.from("FPDRV1:");
export function encryptEnvelope(
  bytes: Uint8Array,
  key: Buffer,
  keyId: string,
  purpose: string,
) {
  const nonce = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key, nonce);
  const header = Buffer.from(`${keyId}\n`);
  cipher.setAAD(Buffer.concat([magic, header, Buffer.from(purpose)]));
  const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return Buffer.concat([magic, header, nonce, cipher.getAuthTag(), encrypted]);
}
export function decryptEnvelope(
  bytes: Uint8Array,
  keys: Record<string, Buffer>,
  purpose: string,
) {
  const encoded = Buffer.from(bytes);
  if (!encoded.subarray(0, magic.length).equals(magic))
    throw new Error("Encrypted envelope required.");
  const end = encoded.indexOf(10, magic.length);
  if (end < magic.length || end > 80 || encoded.length < end + 29)
    throw new Error("Invalid encrypted envelope.");
  const keyId = encoded.subarray(magic.length, end).toString(),
    key = keys[keyId];
  if (!key) throw new Error("Required document encryption key unavailable.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    encoded.subarray(end + 1, end + 13),
  );
  decipher.setAAD(
    Buffer.concat([encoded.subarray(0, end + 1), Buffer.from(purpose)]),
  );
  decipher.setAuthTag(encoded.subarray(end + 13, end + 29));
  return Buffer.concat([
    decipher.update(encoded.subarray(end + 29)),
    decipher.final(),
  ]);
}
export function storageKeys() {
  const raw = JSON.parse(process.env.DRIVERS_STORAGE_KEYS || "{}") as Record<
    string,
    unknown
  >;
  const keys: Record<string, Buffer> = {};
  for (const [id, value] of Object.entries(raw)) {
    if (
      !/^[a-zA-Z0-9_-]{1,50}$/.test(id) ||
      typeof value !== "string" ||
      !/^[a-fA-F0-9]{64}$/.test(value)
    )
      throw new Error("Invalid storage key configuration.");
    keys[id] = Buffer.from(value, "hex");
  }
  const active = process.env.DRIVERS_STORAGE_ACTIVE_KEY || "";
  if (active && !keys[active])
    throw new Error("Active storage key unavailable.");
  if (process.env.NODE_ENV === "production" && !active)
    throw new Error("Production requires document encryption.");
  return { active, keys };
}
export async function privateNamespace(
  namespace: "driver-documents" | "driver-quarantine",
) {
  const configured = process.env.PRIVATE_FILE_STORAGE_ROOT;
  if (configured && !path.isAbsolute(configured))
    throw new Error("Private storage root must be absolute.");
  if (
    process.env.NODE_ENV === "production" &&
    (!configured || process.env.DRIVERS_STORAGE_DURABLE !== "true")
  )
    throw new Error("Durable private storage must be configured.");
  const root = path.resolve(configured || path.join(process.cwd(), ".data"));
  const publicRoot = await realpath(path.join(process.cwd(), "public"));
  await mkdir(root, { recursive: true, mode: 0o700 });
  const resolved = await realpath(root);
  const rootStat = await lstat(resolved);
  if (
    process.env.NODE_ENV === "production" &&
    ((rootStat.mode & 0o077) !== 0 ||
      (process.getuid && rootStat.uid !== process.getuid()))
  )
    throw new Error(
      "Production private root requires service ownership and mode 0700.",
    );
  if (resolved === publicRoot || resolved.startsWith(publicRoot + path.sep))
    throw new Error("Private storage cannot be public.");
  const directory = path.join(resolved, namespace);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const stat = await lstat(directory);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (stat.mode & 0o077) !== 0 ||
    (process.getuid && stat.uid !== process.getuid())
  )
    throw new Error("Unsafe private directory permissions.");
  return directory;
}
export class DriverSecureStorage implements PrivateFileStorage {
  constructor(
    private readonly directory: string,
    private readonly namespace: string,
  ) {}
  private target(key: string) {
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        key,
      )
    )
      throw new Error("Invalid document storage key.");
    return path.join(this.directory, key);
  }
  async put(bytes: Uint8Array) {
    const { active, keys } = storageKeys();
    const stored = active
      ? encryptEnvelope(bytes, keys[active], active, this.namespace)
      : Buffer.from(bytes);
    const key = randomUUID(),
      temporary = this.target(randomUUID());
    const file = await open(temporary, "wx", 0o600);
    try {
      await file.writeFile(stored);
      await file.sync();
    } finally {
      await file.close();
    }
    await rename(temporary, this.target(key));
    const directory = await open(this.directory, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return key;
  }
  async get(key: string) {
    const file = await open(
      this.target(key),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    let bytes: Buffer;
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size > 10486000 || (stat.mode & 0o077) !== 0)
        throw new Error("Unsafe document file.");
      bytes = await file.readFile();
    } finally {
      await file.close();
    }
    const { keys } = storageKeys();
    if (bytes.subarray(0, magic.length).equals(magic))
      return decryptEnvelope(bytes, keys, this.namespace);
    if (process.env.NODE_ENV === "production")
      throw new Error(
        "Legacy document requires controlled encryption migration.",
      );
    return bytes;
  }
  async delete(key: string) {
    await unlink(this.target(key)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}
