import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export interface TaskAttachmentStorage {
  put(bytes: Uint8Array): Promise<string>;
  get(storageKey: string): Promise<Uint8Array>;
  delete(storageKey: string): Promise<void>;
}

export class DevelopmentTaskAttachmentStorage implements TaskAttachmentStorage {
  private readonly root = path.resolve(process.cwd(), '.data', 'task-attachments');

  async put(bytes: Uint8Array): Promise<string> {
    const storageKey = randomUUID();
    await mkdir(this.root, { recursive: true });
    await writeFile(this.resolve(storageKey), bytes, { flag: 'wx' });
    return storageKey;
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
    if (!/^[0-9a-f-]{36}$/i.test(storageKey)) throw new Error('Invalid storage key.');
    const resolved = path.resolve(this.root, storageKey);
    if (!resolved.startsWith(`${this.root}${path.sep}`)) {
      throw new Error('Invalid storage key.');
    }
    return resolved;
  }
}

export const taskAttachmentStorage = new DevelopmentTaskAttachmentStorage();
