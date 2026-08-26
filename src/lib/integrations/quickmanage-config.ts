const DEFAULT_API_BASE_URL = 'https://api.quickmanage.com';

export type QuickManageConfig = {
  clientId: string;
  clientSecret: string;
  apiBaseUrl: string;
};

export function getQuickManageConfig(): QuickManageConfig | null {
  const clientId = process.env.QUICKMANAGE_CLIENT_ID?.trim();
  const clientSecret = process.env.QUICKMANAGE_CLIENT_SECRET?.trim();
  const apiBaseUrl = (process.env.QUICKMANAGE_API_BASE_URL?.trim() || DEFAULT_API_BASE_URL)
    .replace(/\/+$/, '');

  if (!clientId || !clientSecret) return null;

  const parsed = new URL(apiBaseUrl);
  if (parsed.protocol !== 'https:') return null;

  return { clientId, clientSecret, apiBaseUrl };
}
