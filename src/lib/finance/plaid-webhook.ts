import { createHash } from 'node:crypto';
import {
  decodeProtectedHeader,
  importJWK,
  jwtVerify,
  type JWK,
} from 'jose';
import { BankLedgerValidationError } from './bank-ledger-errors';

const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;

type PlaidJwk = JWK & { expired_at?: number | null };
export type PlaidVerificationKeyResolver = (keyId: string) => Promise<PlaidJwk>;

export async function verifyPlaidWebhook(
  rawBody: string,
  verificationHeader: string | null,
  resolveKey: PlaidVerificationKeyResolver,
  now = Date.now(),
) {
  if (!verificationHeader) {
    throw new BankLedgerValidationError('Invalid provider webhook.');
  }
  const header = decodeProtectedHeader(verificationHeader);
  if (header.alg !== 'ES256' || typeof header.kid !== 'string' || !header.kid) {
    throw new BankLedgerValidationError('Invalid provider webhook.');
  }
  const jwk = await resolveKey(header.kid);
  if (jwk.alg !== 'ES256' || jwk.kid !== header.kid) {
    throw new BankLedgerValidationError('Invalid provider webhook.');
  }
  if (typeof jwk.expired_at === 'number' && jwk.expired_at <= Math.floor(now / 1000)) {
    throw new BankLedgerValidationError('Invalid provider webhook.');
  }
  const key = await importJWK(jwk, 'ES256');
  const { payload } = await jwtVerify(verificationHeader, key, {
    algorithms: ['ES256'],
  });
  if (
    typeof payload.iat !== 'number' ||
    payload.iat > Math.floor(now / 1000) + 30 ||
    Math.floor(now / 1000) - payload.iat > MAX_WEBHOOK_AGE_SECONDS
  ) {
    throw new BankLedgerValidationError('Invalid provider webhook.');
  }
  const bodyHash = createHash('sha256').update(rawBody).digest('hex');
  if (payload.request_body_sha256 !== bodyHash) {
    throw new BankLedgerValidationError('Invalid provider webhook.');
  }
  const eventHash = createHash('sha256')
    .update(bodyHash)
    .update('.')
    .update(verificationHeader)
    .digest('hex');
  return { bodyHash, eventHash, keyId: header.kid };
}
