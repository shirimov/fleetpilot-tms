export class DriverSafetyValidationError extends Error {}
export type RatingPolicy = { label: string; enabled: boolean; maximum: number; minimum: number; violationPenalty: number; outOfServicePenalty: number; windowStart: string; windowEnd: string };
export type InspectionInput = { source: string; reportIdentifier: string; inspectionDate: string; violations: number | null; outOfService: boolean | null; reviewed: boolean };
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new DriverSafetyValidationError('A structured record is required.');
  return value as Record<string, unknown>;
}
function text(value: unknown, label: string, max = 160) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f]/.test(value)) throw new DriverSafetyValidationError(`${label} is required (maximum ${max} characters).`);
  return value.trim();
}
function date(value: unknown) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new DriverSafetyValidationError('Use a valid calendar date.');
  return value;
}
function number(value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100000) throw new DriverSafetyValidationError('Policy values must be finite numbers between 0 and 100000.');
  return value;
}
export function validatePolicy(value: unknown): RatingPolicy {
  const input = object(value);
  const policy = { label: text(input.label, 'Policy name'), enabled: input.enabled === true, maximum: number(input.maximum), minimum: number(input.minimum), violationPenalty: number(input.violationPenalty), outOfServicePenalty: number(input.outOfServicePenalty), windowStart: date(input.windowStart), windowEnd: date(input.windowEnd) };
  if (typeof input.enabled !== 'boolean' || policy.maximum <= policy.minimum || policy.windowStart > policy.windowEnd || policy.violationPenalty + policy.outOfServicePenalty === 0) throw new DriverSafetyValidationError('Provide an explicit enabled state, increasing score range, nonzero penalties and valid review window.');
  return policy;
}
export function validateInspection(value: unknown): InspectionInput {
  const input = object(value);
  if (input.violations !== null && (typeof input.violations !== 'number' || !Number.isInteger(input.violations) || input.violations < 0 || input.violations > 10000)) throw new DriverSafetyValidationError('Violation count must be an integer, or unknown.');
  if (input.outOfService !== null && typeof input.outOfService !== 'boolean') throw new DriverSafetyValidationError('Out-of-service outcome must be yes, no or unknown.');
  if (typeof input.reviewed !== 'boolean') throw new DriverSafetyValidationError('Review confirmation is required.');
  return { source: text(input.source, 'Report source'), reportIdentifier: text(input.reportIdentifier, 'Report identifier'), inspectionDate: date(input.inspectionDate), violations: input.violations as number | null, outOfService: input.outOfService as boolean | null, reviewed: input.reviewed };
}
export function calculateRating(policy: RatingPolicy | null, evidence: InspectionInput[]) {
  if (!policy || !policy.enabled) return { state: 'POLICY_NOT_CONFIGURED' as const, score: null, reports: null };
  const records = evidence.filter(record => record.inspectionDate >= policy.windowStart && record.inspectionDate <= policy.windowEnd);
  if (!records.length || records.some(record => !record.reviewed || record.violations === null || record.outOfService === null)) return { state: 'EVIDENCE_PENDING' as const, score: null, reports: records.length };
  const penalty = records.reduce((sum, record) => sum + record.violations! * policy.violationPenalty + (record.outOfService ? policy.outOfServicePenalty : 0), 0);
  return { state: 'RATED' as const, score: Math.round(Math.max(policy.minimum, policy.maximum - penalty) * 100) / 100, reports: records.length };
}
export function imageSignature(bytes: Uint8Array, mime: string) {
  if (mime === 'image/jpeg') return bytes.length >= 3 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (mime === 'image/png') return bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((byte,index) => bytes[index] === byte);
  return mime === 'image/webp' && bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0,4)) === 'RIFF' && new TextDecoder().decode(bytes.slice(8,12)) === 'WEBP';
}
export async function validatePhoto(bytes: Uint8Array, mime: string): Promise<Uint8Array> {
  if (!bytes.length || bytes.length > 5 * 1024 * 1024 || !imageSignature(bytes,mime)) throw new DriverSafetyValidationError('Supply a valid JPEG, PNG or WebP photo up to 5 MB.');
  // Decode, bound pixels, resize and strip metadata. Never crop a license image.
  // sharp 0.35 ships declarations but its ESM export omits the types condition.
  // @ts-expect-error Bundled runtime is exercised by the synthetic image test.
  const { default: sharp } = await import('sharp');
  try { return new Uint8Array(await sharp(bytes, { limitInputPixels: 24000000, failOn: 'warning' }).rotate().resize(800,800,{fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer()); }
  catch { throw new DriverSafetyValidationError('Image could not be decoded safely.'); }
}
