'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePlaidLink } from 'react-plaid-link';

type Props = {
  connectionId?: string;
  disabled?: boolean;
  onComplete: () => Promise<void>;
  onError: (message: string) => void;
};

async function postJson(url: string, body?: unknown) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
    cache: 'no-store',
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? 'Bank connection request failed.');
  return result;
}

export default function PlaidLinkButton({ connectionId, disabled, onComplete, onError }: Props) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const onSuccess = useCallback(async (publicToken: string) => {
    setBusy(true);
    try {
      if (connectionId) {
        await postJson(`/api/finance/bank/connections/${connectionId}/reauth`);
      } else {
        await postJson('/api/plaid/exchange-token', { public_token: publicToken });
      }
      await onComplete();
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Bank connection failed.');
    } finally {
      setBusy(false);
      setLinkToken(null);
    }
  }, [connectionId, onComplete, onError]);
  const { open, ready } = usePlaidLink({
    token: linkToken,
    onSuccess,
    onExit: () => setLinkToken(null),
  });
  useEffect(() => {
    if (linkToken && ready) open();
  }, [linkToken, open, ready]);

  async function start() {
    setBusy(true);
    onError('');
    try {
      const result = await postJson('/api/plaid/create-link-token', { connectionId });
      setLinkToken(result.link_token);
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Bank connection failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="btn" disabled={disabled || busy} onClick={() => void start()}>
      {busy ? 'Preparing secure connection…' : connectionId ? 'Reauthenticate' : 'Connect Bank'}
    </button>
  );
}
