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

export function bankProviderHttpsUrl(name: 'PLAID_WEBHOOK_URL' | 'PLAID_REDIRECT_URI') {
  const configured = process.env[name]?.trim();
  if (!configured) return undefined;
  try {
    const parsed = new URL(configured);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

export function bankProviderConfiguration() {
  const environment = process.env.PLAID_ENV?.trim().toLowerCase() || 'sandbox';
  const supportedEnvironment = ['sandbox', 'development', 'production'].includes(environment);
  const products = (process.env.PLAID_PRODUCTS ?? 'transactions')
    .split(',')
    .map((product) => product.trim().toLowerCase())
    .filter(Boolean);
  const readOnlyProducts = products.length === 1 && products[0] === 'transactions';
  const plaidConfigured = Boolean(
    process.env.PLAID_CLIENT_ID?.trim() &&
      process.env.PLAID_SECRET?.trim() &&
      process.env.BANK_TOKEN_ENCRYPTION_KEY?.trim() &&
      supportedEnvironment &&
      readOnlyProducts,
  );
  return {
    plaidConfigured,
    liveProviderAvailable: plaidConfigured,
    environment: supportedEnvironment ? environment : 'invalid',
    products: readOnlyProducts ? ['transactions'] : [],
    webhookConfigured: Boolean(bankProviderHttpsUrl('PLAID_WEBHOOK_URL')),
    redirectConfigured: Boolean(bankProviderHttpsUrl('PLAID_REDIRECT_URI')),
  };
}
