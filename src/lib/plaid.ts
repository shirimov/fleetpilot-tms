import { Configuration, PlaidApi, PlaidEnvironments } from 'plaid';
import { bankProviderConfiguration } from '@/lib/finance/bank-token-crypto';

export const PLAID_REQUEST_TIMEOUT_MS = 30_000;

const providerConfiguration = bankProviderConfiguration();
const plaidEnvironment = providerConfiguration.environment === 'invalid'
  ? 'sandbox'
  : providerConfiguration.environment;

const configuration = new Configuration({
  basePath: PlaidEnvironments[plaidEnvironment as keyof typeof PlaidEnvironments],
  baseOptions: {
    timeout: PLAID_REQUEST_TIMEOUT_MS,
    headers: {
      'PLAID-CLIENT-ID': process.env.PLAID_CLIENT_ID,
      'PLAID-SECRET': process.env.PLAID_SECRET,
    },
  },
});

export const plaidClient = new PlaidApi(configuration);
