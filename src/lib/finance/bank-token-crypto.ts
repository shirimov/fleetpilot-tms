import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { BankProviderUnavailableError } from './bank-ledger-errors';

function encryptionKey() {
  const configured = process.env.BANK_TOKEN_ENCRYPTION_KEY?.trim();
  if (!configured) {
    throw new BankProviderUnavailableError(
      'Bank token encryption is not configured.',
    );
  }
  const key = /^[0-9a-f]{64}$/i.test(configured)
    ? Buffer.from(configured, 'hex')
    : Buffer.from(configured, 'base64');
  if (key.length !== 32) {
    throw new BankProviderUnavailableError(
      'Bank token encryption is not configured correctly.',
    );
  }
  return key;
}

export function encryptBankAccessToken(token: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
}

export function decryptBankAccessToken(ciphertext: string) {
  const [version, ivText, tagText, encryptedText] = ciphertext.split(':');
  if (version !== 'v1' || !ivText || !tagText || !encryptedText) {
    throw new BankProviderUnavailableError('Stored bank credential is invalid.');
  }
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      encryptionKey(),
      Buffer.from(ivText, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(tagText, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(encryptedText, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  } catch {
    throw new BankProviderUnavailableError('Stored bank credential is invalid.');
  }
}

export function bankProviderConfiguration() {
  const plaidConfigured = Boolean(
    process.env.PLAID_CLIENT_ID?.trim() &&
      process.env.PLAID_SECRET?.trim() &&
      process.env.BANK_TOKEN_ENCRYPTION_KEY?.trim(),
  );
  return {
    plaidConfigured,
    liveProviderAvailable: plaidConfigured,
  };
}
