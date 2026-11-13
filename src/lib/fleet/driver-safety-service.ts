import { createHash, randomUUID } from 'node:crypto';
import type { PrivateFileStorage } from '@/lib/storage/private-file-storage';
import { DriverSafetyCatalog, DriverSafetyConflictError, DriverSafetyStorageError, type DriverSafetyState, type SafetyFile } from './driver-safety-catalog';
import { calculateRating, validateInspection, validatePhoto, validatePolicy, DriverSafetyValidationError } from './driver-safety-validation';

export type DriverSafetyScope = { companyId: string; actorId: string; canConfigurePolicy: boolean };
export class DriverSafetyService {
  constructor(private catalog: DriverSafetyCatalog, private files: PrivateFileStorage, private authorize: (id: string) => Promise<DriverSafetyScope>, private expectedRevision?: string) {}
  private async scope(id: string) {
    if (!/^(source|driver):[A-Za-z0-9_-]{1,128}$/.test(id)) throw new DriverSafetyValidationError('Invalid driver reference.');
    return this.authorize(id);
  }
  private active(state: DriverSafetyState, id: string) {
    const records = state.drivers[id]?.inspections ?? [];
    const superseded = new Set(records.map(record => record.supersedes).filter(Boolean));
    return records.filter(record => !superseded.has(record.id));
  }
  async get(id: string) {
    const scope = await this.scope(id), state = await this.catalog.read(scope.companyId);
    const policy = state.policies.at(-1) ?? null;
    const profile = state.drivers[id];
    const records = this.active(state,id);
    return {
      revision: state.revision, canConfigurePolicy: scope.canConfigurePolicy,
      photoVersion: profile?.photo?.sha256 ?? null, photoId: profile?.photo?.key ?? null,
      policy: policy ? { id: policy.id, label: policy.label, enabled: policy.enabled, maximum: policy.maximum, minimum: policy.minimum, violationPenalty: policy.violationPenalty, outOfServicePenalty: policy.outOfServicePenalty, windowStart: policy.windowStart, windowEnd: policy.windowEnd, createdAt: policy.createdAt } : null,
      policyVersions: state.policies.map(policy => ({ id: policy.id, label: policy.label, enabled: policy.enabled, createdAt: policy.createdAt })),
      rating: calculateRating(policy,records),
      inspections: (profile?.inspections ?? []).map(record => ({ id: record.id, source: record.source, reportIdentifier: record.reportIdentifier, inspectionDate: record.inspectionDate, violations: record.violations, outOfService: record.outOfService, reviewed: record.reviewed, createdAt: record.createdAt, sha256: record.file.sha256, bytes: record.file.bytes, supersedes: record.supersedes, current: records.some(current => current.id === record.id) })),
    };
  }
  private async change<T>(id: string, mutate: (state: DriverSafetyState, scope: DriverSafetyScope, committedRevision: string) => Promise<T>) {
    const scope = await this.scope(id);
    return this.catalog.change(scope.companyId, async () => {
      const fresh = await this.scope(id);
      if (fresh.companyId !== scope.companyId || fresh.actorId !== scope.actorId) throw new DriverSafetyConflictError('Company selection changed. Reload before saving.');
      scope.canConfigurePolicy = fresh.canConfigurePolicy;
    }, async (state, committedRevision) => {
      if (this.expectedRevision !== undefined && state.revision !== this.expectedRevision) throw new DriverSafetyConflictError('Safety records changed. Reload and review before saving again.');
      state.drivers[id] ??= { photo: null, inspections: [] };
      return mutate(state,scope,committedRevision);
    });
  }
  private quota(state: DriverSafetyState, addedBytes: number, addedFiles: number) {
    const unique = new Map<string,number>();
    for (const profile of Object.values(state.drivers)) {
      if (profile.photo) unique.set(profile.photo.key,profile.photo.bytes);
      for (const record of profile.inspections) unique.set(record.file.key,record.file.bytes);
    }
    if (unique.size + addedFiles > 2000 || [...unique.values()].reduce((sum,size)=>sum+size,0) + addedBytes > 250 * 1024 * 1024) throw new DriverSafetyStorageError('Company attachment capacity reached.');
  }
  private audit(state: DriverSafetyState, scope: DriverSafetyScope, id: string, action: string) {
    state.audit.push({ action, actorId: scope.actorId, driverId: id, at: new Date().toISOString() });
  }
  private async saveFile(bytes: Uint8Array,mime: string): Promise<SafetyFile> {
    return {key:await this.files.put(bytes),bytes:bytes.length,mime,sha256:createHash('sha256').update(bytes).digest('hex')};
  }
  async setPhoto(id: string, bytes: Uint8Array, mime: string) {
    await this.scope(id);
    const safe = await validatePhoto(bytes,mime);
    const {previous,committed} = await this.change(id,async(state,scope,revision)=>{
      this.quota(state,safe.length,1);
      const previous = state.drivers[id].photo;
      state.drivers[id].photo = await this.saveFile(safe,'image/webp');
      this.audit(state,scope,id,'PHOTO_REPLACED');
      return {previous,committed:{revision,photoId:state.drivers[id].photo.key,photoVersion:state.drivers[id].photo.sha256}};
    });
    // Only collect old bytes after a confirmed catalog commit. Never delete a new
    // file on uncertain commit; catalog and filesystem are not one transaction.
    if (previous) await this.files.delete(previous.key).catch(()=>undefined);
    return committed;
  }
  async removePhoto(id: string) {
    const previous = await this.change(id,async(state,scope)=>{
      const previous = state.drivers[id].photo; state.drivers[id].photo = null;
      this.audit(state,scope,id,'PHOTO_REMOVED'); return previous;
    });
    if (previous) await this.files.delete(previous.key).catch(()=>undefined);
  }
  async photo(id: string) {
    const scope = await this.scope(id), state = await this.catalog.read(scope.companyId);
    const file = state.drivers[id]?.photo;
    if (!file) return null;
    const bytes = await this.files.get(file.key);
    if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new DriverSafetyStorageError('Photo integrity check failed.');
    return bytes;
  }
  async addInspection(id: string, value: unknown, original?: Uint8Array, supersedes: string | null = null) {
    const input = validateInspection(value);
    if (original && (!original.length || original.length > 10 * 1024 * 1024)) throw new DriverSafetyValidationError('Original report must be between 1 byte and 10 MB.');
    return this.change(id,async(state,scope)=>{
      const records = state.drivers[id].inspections;
      const prior = supersedes ? this.active(state,id).find(record=>record.id === supersedes) : null;
      if (supersedes && !prior) throw new DriverSafetyConflictError('The selected report was changed. Reload before reviewing.');
      if (!original && !prior) throw new DriverSafetyValidationError('Attach the original report. Unknown formats are preserved, not parsed.');
      if (records.length >= 200) throw new DriverSafetyStorageError('Driver evidence capacity reached.');
      if (this.active(state,id).some(record=>record.id !== supersedes && record.source === input.source && record.reportIdentifier === input.reportIdentifier)) throw new DriverSafetyConflictError('This report is already recorded. Review its existing entry instead.');
      this.quota(state,original?.length ?? 0,original ? 1 : 0);
      const file = original ? await this.saveFile(original,'application/octet-stream') : prior!.file;
      const record = {...input,id:randomUUID(),actorId:scope.actorId,createdAt:new Date().toISOString(),file,supersedes};
      records.push(record);this.audit(state,scope,id,supersedes?'INSPECTION_REVIEWED':'INSPECTION_ADDED');
      return record.id;
    });
  }
  async setPolicy(id: string, value: unknown) {
    const policy = validatePolicy(value);
    return this.change(id,async(state,scope)=>{
      if (!scope.canConfigurePolicy) throw new DriverSafetyValidationError('Only a company owner can configure the rating policy.');
      const version = {...policy,id:randomUUID(),createdAt:new Date().toISOString(),actorId:scope.actorId};
      state.policies.push(version);this.audit(state,scope,id,'RATING_POLICY_VERSION_CREATED');
      return version.id;
    });
  }
  async download(id: string, recordId: string) {
    const scope = await this.scope(id), state = await this.catalog.read(scope.companyId);
    const record = state.drivers[id]?.inspections.find(record=>record.id === recordId);
    if (!record) throw new DriverSafetyValidationError('Report not found.');
    const bytes = await this.files.get(record.file.key);
    if (createHash('sha256').update(bytes).digest('hex') !== record.file.sha256) throw new DriverSafetyStorageError('Report integrity check failed.');
    return bytes;
  }
}
