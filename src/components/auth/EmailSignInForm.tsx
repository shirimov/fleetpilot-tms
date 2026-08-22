'use client';

import { FormEvent, useState } from 'react';

const GENERIC_MESSAGE =
  'If this email is authorized, a sign-in link has been sent.';

export function EmailSignInForm() {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus('sending');
    try {
      const response = await fetch('/api/auth/email/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      setStatus(response.ok ? 'sent' : 'error');
    } catch {
      setStatus('error');
    }
  }

  return (
    <form className="mt-6 space-y-4" onSubmit={submit} aria-label="Email sign in">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-slate-200">
          Work email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={320}
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={status === 'sending'}
          className="mt-2 w-full rounded-lg border border-white/15 bg-slate-950 px-4 py-3 text-base text-white placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:opacity-60"
          placeholder="you@company.com"
        />
      </div>
      <button
        type="submit"
        disabled={status === 'sending'}
        className="w-full rounded-lg border border-blue-400/40 bg-blue-500/10 px-4 py-3 text-sm font-semibold text-blue-100 hover:bg-blue-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300 disabled:cursor-wait disabled:opacity-60"
      >
        {status === 'sending' ? 'Sending secure link…' : status === 'sent' ? 'Resend sign-in link' : 'Continue with Email'}
      </button>
      <div aria-live="polite" className="min-h-10 text-sm leading-5">
        {status === 'sent' ? <p className="text-emerald-300">{GENERIC_MESSAGE}</p> : null}
        {status === 'error' ? <p className="text-amber-300">We could not process the request. Please try again.</p> : null}
      </div>
    </form>
  );
}
