import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';

export const PLAID_REQUEST_TIMEOUT_MS = 30_000;

const configuration = new Configuration({
  basePath: PlaidEnvironments[process.env.PLAID_ENV as keyof typeof PlaidEnvironments || 'sandbox'],
  baseOptions: {
    timeout: PLAID_REQUEST_TIMEOUT_MS,
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

export const plaidClient = new PlaidApi(configuration);
