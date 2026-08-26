import {
  getQuickManageConfig,
  type QuickManageConfig,
} from './quickmanage-config';

type FetchLike = typeof fetch;

const REQUEST_TIMEOUT_MS = 10_000;
const EXPIRY_MARGIN_MS = 30_000;

type CachedToken = { accessToken: string; expiresAtMs: number };

export type QuickManageErrorCode =
  | 'NOT_CONFIGURED'
  | 'AUTH_REJECTED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'MALFORMED_RESPONSE'
  | 'EXPIRED_TOKEN';

export class QuickManageError extends Error {
  constructor(
    readonly code: QuickManageErrorCode,
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'QuickManageError';
  }
}

function redactText(value: string, secrets: string[]) {
  let redacted = value
    .replace(/Bearer\s+[^\s"']+/gi, 'Bearer [redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted-token]');
  for (const secret of secrets.filter(Boolean)) {
    redacted = redacted.split(secret).join('[redacted]');
  }
  return redacted.slice(0, 400);
}

export function sanitizeQuickManageError(error: unknown, secrets: string[] = []) {
  if (error instanceof QuickManageError) return redactText(error.message, secrets);
  return 'QuickManage connection failed.';
}

export class QuickManageClient {
  private cachedToken: CachedToken | null = null;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly configResolver: () => QuickManageConfig | null = getQuickManageConfig,
    private readonly now: () => number = Date.now,
    private readonly timeoutSignal: (milliseconds: number) => AbortSignal = AbortSignal.timeout,
  ) {}

  isConfigured() {
    return this.configResolver() !== null;
  }

  clearTokenCache() {
    this.cachedToken = null;
  }

  async testConnection() {
    const token = await this.getAccessToken();
    return { connected: true as const, expiresAt: new Date(token.expiresAtMs).toISOString() };
  }

  async getAccessToken(): Promise<CachedToken> {
    if (this.cachedToken && this.cachedToken.expiresAtMs - EXPIRY_MARGIN_MS > this.now()) {
      return this.cachedToken;
    }

    const config = this.configResolver();
    if (!config) {
      throw new QuickManageError('NOT_CONFIGURED', 'QuickManage integration is not configured.');
    }

    let response: Response;
    try {
      response = await this.fetchImpl(`${config.apiBaseUrl}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: config.clientId,
          client_secret: config.clientSecret,
        }),
        signal: this.timeoutSignal(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError')) {
        throw new QuickManageError('TIMEOUT', 'QuickManage authentication timed out.');
      }
      throw new QuickManageError('NETWORK_ERROR', 'QuickManage authentication could not be reached.');
    }

    if (response.status === 401) {
      this.cachedToken = null;
      throw new QuickManageError('AUTH_REJECTED', 'QuickManage authentication was rejected.', 401);
    }
    if (!response.ok) {
      this.cachedToken = null;
      throw new QuickManageError(
        'AUTH_REJECTED',
        `QuickManage authentication failed with status ${response.status}.`,
        response.status,
      );
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an invalid authentication response.');
    }

    const data = payload && typeof payload === 'object'
      ? (payload as { data?: unknown }).data
      : null;
    const accessToken = data && typeof data === 'object'
      ? (data as { access_token?: unknown }).access_token
      : null;
    const expire = data && typeof data === 'object'
      ? (data as { expire?: unknown }).expire
      : null;
    if (typeof accessToken !== 'string' || !accessToken.trim() || typeof expire !== 'string') {
      throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an invalid authentication response.');
    }

    const expiresAtMs = Date.parse(expire);
    if (!Number.isFinite(expiresAtMs)) {
      throw new QuickManageError('MALFORMED_RESPONSE', 'QuickManage returned an invalid token expiry.');
    }
    if (expiresAtMs <= this.now()) {
      throw new QuickManageError('EXPIRED_TOKEN', 'QuickManage returned an expired access token.');
    }

    this.cachedToken = { accessToken: accessToken.trim(), expiresAtMs };
    return this.cachedToken;
  }
}

export const quickManageClient = new QuickManageClient();
