import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import path from 'node:path';
import { FilesystemPrivateFileStorage } from '@/lib/storage/private-file-storage';
import { DriverSafetyCatalog } from './driver-safety-catalog';

// Safety-only durable publication; unrelated private storage behavior is unchanged.
export class DriverSafetyFiles extends FilesystemPrivateFileStorage {
  constructor(private root: string, private openFile: typeof open = open) {
    super('driver-safety-files',root);
  }
  override async put(bytes: Uint8Array): Promise<string> {
    const catalog = new DriverSafetyCatalog(this.root);
    await catalog.prepare();
    const namespace = path.join(catalog.root,'driver-safety-files');
    const key = randomUUID();
    // An unreferenced unique file is not visible through authenticated downloads.
    // Retain it on any uncertainty; never delete possibly committed evidence.
    const file = await this.openFile(path.join(namespace,key),constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,0o600);
    try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    // Flush the file's entry before returning its key to the catalog writer.
    // Also flush ancestors: prepare may have created the root/namespaces.
    // Each fd is closed before opening another, including all failure paths.
    let directory = namespace;
    while (true) {
      const handle = await this.openFile(directory,constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      try { await handle.sync(); } finally { await handle.close(); }
      const parent = path.dirname(directory);
      if(parent === directory)break;
      directory = parent;
    }
    return key;
  }
}
