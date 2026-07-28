import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

const storageKeyPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const namespacePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface PrivateFileStorage {
  put(bytes: Uint8Array): Promise<string>;
  get(storageKey: string): Promise<Uint8Array>;
  delete(storageKey: string): Promise<void>;
}

function configuredStorageRoot(): string {
  const configured = process.env.PRIVATE_FILE_STORAGE_ROOT;
  if (!configured) return path.resolve(process.cwd(), '.data');
  if (!path.isAbsolute(configured)) {
    throw new Error('PRIVATE_FILE_STORAGE_ROOT must be an absolute path.');
  }
  return path.resolve(configured);
}

export class FilesystemPrivateFileStorage implements PrivateFileStorage {
  private readonly namespaceRoot: string;

  constructor(namespace: string, root = configuredStorageRoot()) {
    if (!namespacePattern.test(namespace)) {
      throw new Error('Private storage namespace is invalid.');
    }
    const resolvedRoot = path.resolve(root);
    const namespaceRoot = path.resolve(resolvedRoot, namespace);
    if (!namespaceRoot.startsWith(`${resolvedRoot}${path.sep}`)) {
      throw new Error('Private storage namespace escapes its root.');
    }
    this.namespaceRoot = namespaceRoot;
  }

  async put(bytes: Uint8Array): Promise<string> {
    const storageKey = randomUUID();
    const target = this.resolve(storageKey);
    const temporary = this.resolveTemporary(randomUUID());
    await mkdir(this.namespaceRoot, { recursive: true, mode: 0o700 });
    try {
      await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
      await rename(temporary, target);
      return storageKey;
    } catch (error) {
      await unlink(temporary).catch(() => undefined);
      throw error;
    }
  }

  async get(storageKey: string): Promise<Uint8Array> {
    return readFile(this.resolve(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    try {
      await unlink(this.resolve(storageKey));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private resolve(storageKey: string): string {
    if (!storageKeyPattern.test(storageKey)) {
      throw new Error('Private storage key is invalid.');
    }
    return this.containedPath(storageKey);
  }

  private resolveTemporary(storageKey: string): string {
    if (!storageKeyPattern.test(storageKey)) {
      throw new Error('Private temporary storage key is invalid.');
    }
    return this.containedPath(`.${storageKey}.tmp`);
  }

  private containedPath(filename: string): string {
    const resolved = path.resolve(this.namespaceRoot, filename);
    if (!resolved.startsWith(`${this.namespaceRoot}${path.sep}`)) {
      throw new Error('Private storage path escapes its namespace.');
    }
    return resolved;
  }
}

function safeAsciiFilename(filename: string): string {
  return filename
    .replace(/[\r\n]/g, '')
    .replace(/[^\x20-\x7e]/g, '_')
    .replace(/["\\]/g, '_')
    .slice(0, 255) || 'download';
}

export function privateDownloadHeaders(
  filename: string,
  mimeType: string,
  disposition: 'attachment' | 'inline' = 'attachment',
): Record<string, string> {
  const normalizedFilename = filename.replace(/[\r\n]/g, '').slice(0, 255);
  return {
    'Content-Type': mimeType,
    'Content-Disposition':
      `${disposition}; filename="${safeAsciiFilename(normalizedFilename)}"; ` +
      `filename*=UTF-8''${encodeURIComponent(normalizedFilename)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
  };
}
