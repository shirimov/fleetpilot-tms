import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import type { InspectionInput, RatingPolicy } from './driver-safety-validation';

export type SafetyFile = { key: string; bytes: number; sha256: string; mime: string };
export type InspectionRecord = InspectionInput & { id: string; createdAt: string; actorId: string; file: SafetyFile; supersedes: string | null };
export type PolicyVersion = RatingPolicy & { id: string; createdAt: string; actorId: string };
export type DriverSafetyState = { version: 1; revision: string; drivers: Record<string, { photo: SafetyFile | null; inspections: InspectionRecord[] }>; policies: PolicyVersion[]; audit: { action: string; actorId: string; driverId: string; at: string }[] };
export class DriverSafetyStorageError extends Error {}
export class DriverSafetyConflictError extends Error {}
const fresh = (): DriverSafetyState => ({ version: 1, revision: '0', drivers: {}, policies: [], audit: [] });

// Adjunct private catalog: no change to immutable imported source snapshots.
// One company lock serializes writers across app processes on a shared filesystem.
// Never recover/delete a stale lock automatically after an uncertain write.
export class DriverSafetyCatalog {
  readonly root: string;
  constructor(root = process.env.PRIVATE_FILE_STORAGE_ROOT) {
    if (!root || !path.isAbsolute(root)) throw new DriverSafetyStorageError('Private driver storage is not configured.');
    this.root = path.resolve(root);
    if (this.root === '/' || this.root.startsWith(path.resolve(process.cwd(), 'public') + path.sep) || this.root === path.resolve(process.cwd(), 'public')) throw new DriverSafetyStorageError('Private storage cannot be public.');
  }
  async prepare() {
    // Check every existing ancestor; never weaken permissions or follow symlinks.
    let current = this.root;
    const ancestry: string[] = [];
    while (true) { ancestry.push(current); if (current === path.dirname(current)) break; current = path.dirname(current); }
    for (const directory of ancestry.reverse()) {
      const stat = await lstat(directory).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (!stat) continue;
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o022) !== 0 || (stat.uid !== 0 && stat.uid !== process.getuid?.())) throw new DriverSafetyStorageError('Private storage ancestry is not trusted.');
    }
    await mkdir(this.root, { recursive: true, mode: 0o700 });
    const directory = path.join(this.root, 'driver-safety-catalog');
    for(const namespace of ['driver-safety-catalog','driver-safety-files']) {
      const target=path.join(this.root,namespace);
      await mkdir(target, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
      const stat = await lstat(target);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.()) throw new DriverSafetyStorageError('Driver storage namespaces must be owner-only.');
    }
    return directory;
  }
  private async filename(companyId: string) {
    return path.join(await this.prepare(), `${createHash('sha256').update(companyId).digest('hex')}.json`);
  }
  async read(companyId: string): Promise<DriverSafetyState> {
    const filename = await this.filename(companyId);
    const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    if (!handle) return fresh();
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0 || stat.uid !== process.getuid?.() || stat.size > 12 * 1024 * 1024) throw new DriverSafetyStorageError('Driver catalog is not a private bounded file.');
      const state = JSON.parse(await handle.readFile('utf8')) as DriverSafetyState;
      if (state.version !== 1 || !state.drivers || !Array.isArray(state.policies) || !Array.isArray(state.audit)) throw new DriverSafetyStorageError('Unsupported driver catalog.');
      return state;
    } finally { await handle.close(); }
  }
  async change<T>(companyId: string, authorize: () => Promise<void>, mutate: (state: DriverSafetyState, committedRevision: string) => T | Promise<T>): Promise<T> {
    const filename = await this.filename(companyId);
    const lock = await open(`${filename}.lock`, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600).catch(error => { if (error.code === 'EEXIST') throw new DriverSafetyConflictError('Another write is active or requires recovery. Reload; do not blindly retry.'); throw error; });
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await authorize();
      const state = await this.read(companyId);
      if(state.audit.length>=10000)throw new DriverSafetyStorageError('Driver catalog capacity reached.');
      const committedRevision = randomUUID();
      const result = await mutate(state, committedRevision);
      state.revision = committedRevision;
      const bytes = JSON.stringify(state);
      if (Buffer.byteLength(bytes) > 12 * 1024 * 1024 || state.audit.length > 10000 || state.policies.length > 100) throw new DriverSafetyStorageError('Driver catalog capacity reached.');
      const handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
      await rename(temporary, filename);
      // Policy-only writes have no attachment writer to flush newly created
      // storage entries. Publish the catalog and its ancestry independently.
      // Walk to the filesystem root even when prepare/read created them earlier.
      let directory = path.dirname(filename);
      while (true) {
        const handle = await open(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
        try { await handle.sync(); } finally { await handle.close(); }
        const parent = path.dirname(directory);
        if (parent === directory) break;
        directory = parent;
      }
      return result;
    } finally {
      await unlink(temporary).catch(() => undefined);
      await lock.close();
      await unlink(`${filename}.lock`);
    }
  }
}
