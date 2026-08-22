'use client';

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';

export function VerifyEmailSignIn() {
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    let active = true;
    const token = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
    window.history.replaceState(null, '', window.location.pathname);
    if (!token) {
      queueMicrotask(() => {
        if (active) setInvalid(true);
      });
      return () => { active = false; };
    }
    void signIn('email-magic-link', {
      token,
      redirect: false,
      redirectTo: '/tasks',
    }).then((result) => {
      if (!active) return;
      if (result?.ok && result.url) {
        const destination = new URL(result.url, window.location.origin);
        window.location.assign(
          `${destination.pathname}${destination.search}${destination.hash}`,
        );
      } else setInvalid(true);
    }).catch(() => {
      if (active) setInvalid(true);
    });
    return () => { active = false; };
  }, []);

  if (invalid) {
    return (
      <>
        <h1 className="text-2xl font-semibold">This sign-in link is invalid or expired</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Return to sign in and request a new secure link.
        </p>
        <a href="/login" className="mt-6 inline-flex rounded-lg bg-blue-500 px-4 py-3 text-sm font-semibold hover:bg-blue-400">
          Return to sign in
        </a>
      </>
    );
  }
  return (
    <>
      <h1 className="text-2xl font-semibold">Signing you in securely…</h1>
      <p className="mt-3 text-sm text-slate-400" role="status">Verifying your one-time link.</p>
    </>
  );
}
