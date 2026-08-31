import { CountryCode, Products, type LinkTokenCreateRequest } from 'plaid';

export function plaidLinkTokenRequest(input: {
  userId: string;
  companyId: string;
  accessToken?: string;
  webhook?: string;
  redirectUri?: string;
}): LinkTokenCreateRequest {
  return {
    user: { client_user_id: `${input.userId}:${input.companyId}` },
    client_name: 'FleetPilot TMS',
    ...(input.accessToken
      ? { access_token: input.accessToken }
      : { products: [Products.Transactions] }),
    country_codes: [CountryCode.Us],
    language: 'en',
    ...(input.webhook ? { webhook: input.webhook } : {}),
    ...(input.redirectUri ? { redirect_uri: input.redirectUri } : {}),
  };
}
