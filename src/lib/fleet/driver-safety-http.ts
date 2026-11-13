import { NextResponse } from 'next/server';
import { authorizationErrorResponse } from '@/lib/auth/auth-route-response';
import { PRIVATE_NO_STORE_HEADERS } from '@/lib/security/cache-headers';
import { DriverSafetyConflictError, DriverSafetyStorageError } from './driver-safety-catalog';
import { DriverSafetyValidationError } from './driver-safety-validation';
import { DriverPoolNotFoundError } from './driver-pool-service';

export function requireSafetyMutation(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') throw new DriverSafetyValidationError('Same-origin request required.');
  const revision = request.headers.get('if-match');
  if (!revision || !/^(0|[0-9a-f-]{36})$/.test(revision)) throw new DriverSafetyConflictError('Reload the safety record before saving.');
  return revision;
}
export async function readSafetyBody(request: Request, limit: number, timeoutMs = 30000): Promise<Uint8Array> {
  const declared = request.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new DriverSafetyValidationError('Upload is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new DriverSafetyValidationError('Upload body is required.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  let timedOut=false;
  const deadline = setTimeout(() => { timedOut=true; void reader.cancel('Upload timed out.'); }, timeoutMs);
  try {
    while (true) {
      const chunk = await reader.read(); if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > limit) { await reader.cancel(); throw new DriverSafetyValidationError('Upload is too large.'); }
      chunks.push(chunk.value);
    }
  } finally { clearTimeout(deadline); reader.releaseLock(); }
  if(timedOut)throw new DriverSafetyValidationError('Upload timed out. Original bytes were not accepted.');
  if (!size) throw new DriverSafetyValidationError('Upload body is empty.');
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk,offset); offset += chunk.length; }
  return bytes;
}
export function safetyJson(value: unknown, status = 200) { return NextResponse.json(value,{status,headers:PRIVATE_NO_STORE_HEADERS}); }
export function safetyError(error: unknown) {
  const auth = authorizationErrorResponse(error); if (auth) return auth;
  if (error instanceof DriverPoolNotFoundError) return safetyJson({error:'Not found.'},404);
  if (error instanceof DriverSafetyConflictError) return safetyJson({error:error.message},409);
  if (error instanceof DriverSafetyValidationError) return safetyJson({error:error.message},400);
  if (error instanceof DriverSafetyStorageError) return safetyJson({error:error.message},503);
  return safetyJson({error:'Safety operation could not be confirmed. Reload to check the saved state before trying again.'},500);
}
