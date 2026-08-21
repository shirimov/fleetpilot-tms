'use client';

import { useState, type ReactNode } from 'react';
import { signOut } from 'next-auth/react';

type SignOutButtonProps = {
  children: ReactNode;
  className?: string;
  role?: string;
};

export default function SignOutButton({
  children,
  className,
  role,
}: SignOutButtonProps) {
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut({ redirectTo: '/login' });
    } catch {
      setSigningOut(false);
    }
  }

  return (
    <button
      type="button"
      role={role}
      disabled={signingOut}
      onClick={() => void handleSignOut()}
      className={className}
    >
      {signingOut ? 'Signing out…' : children}
    </button>
  );
}
