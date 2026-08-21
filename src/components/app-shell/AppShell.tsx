'use client';

import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import Sidebar from '@/components/Sidebar';

type CompanyContext = {
  user: {
    displayName: string;
    email: string;
    image: string | null;
  };
  activeCompanyId: string;
  companies: Array<{
    id: string;
    name: string;
    role: 'OWNER' | 'ADMIN' | 'MEMBER';
  }>;
};

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [companyContext, setCompanyContext] = useState<CompanyContext | null>(null);
  const [companyError, setCompanyError] = useState('');
  const profileTriggerRef = useRef<HTMLButtonElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    fetch('/api/auth/company', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) throw new Error('Company context unavailable');
        return (await response.json()) as CompanyContext;
      })
      .then((context) => {
        if (active) setCompanyContext(context);
      })
      .catch(() => {
        if (active) setCompanyError('Company context unavailable');
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!profileOpen) return;
    const focusFrame = window.requestAnimationFrame(() => {
      profileMenuRef.current
        ?.querySelector<HTMLElement>('[role="menuitem"]')
        ?.focus();
    });
    function dismissOutside(event: PointerEvent) {
      const target = event.target;
      if (
        target instanceof Node &&
        !profileMenuRef.current?.contains(target) &&
        !profileTriggerRef.current?.contains(target)
      ) {
        setProfileOpen(false);
      }
    }
    document.addEventListener('pointerdown', dismissOutside);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener('pointerdown', dismissOutside);
    };
  }, [profileOpen]);

  if (pathname === '/login') return children;

  function toggleCollapsed() {
    setCollapsed((current) => !current);
  }

  async function switchCompany(companyId: string) {
    if (!companyId || companyId === companyContext?.activeCompanyId) return;
    setCompanyError('');
    const response = await fetch('/api/auth/company', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyId }),
    });
    if (!response.ok) {
      setCompanyError('Company could not be changed');
      return;
    }
    window.location.reload();
  }

  const activeCompany = companyContext?.companies.find(
    ({ id }) => id === companyContext.activeCompanyId,
  );
  const userInitial =
    companyContext?.user.displayName.trim().charAt(0).toUpperCase() || 'F';

  function closeProfileMenu({ restoreFocus = false } = {}) {
    setProfileOpen(false);
    if (restoreFocus) {
      window.requestAnimationFrame(() => profileTriggerRef.current?.focus());
    }
  }

  function navigateProfileMenu(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(
      profileMenuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ??
        [],
    );
    if (event.key === 'Escape') {
      event.preventDefault();
      closeProfileMenu({ restoreFocus: true });
      return;
    }
    if (event.key === 'Tab') {
      closeProfileMenu();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (items.length === 0) return;
    const currentIndex = items.indexOf(document.activeElement as HTMLElement);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? items.length - 1
          : event.key === 'ArrowUp'
            ? (currentIndex - 1 + items.length) % items.length
            : (currentIndex + 1) % items.length;
    items[nextIndex]?.focus();
  }

  return (
    <div className="alpha-shell min-h-screen bg-[var(--alpha-canvas)] text-slate-100">
      <Sidebar
        collapsed={collapsed}
        mobileOpen={mobileOpen}
        query=""
        onCollapse={toggleCollapsed}
        onMobileClose={() => setMobileOpen(false)}
        role={activeCompany?.role}
      />

      <div
        className="alpha-shell-content min-h-screen transition-[padding] duration-200"
        data-collapsed={collapsed}
      >
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-800/80 bg-slate-950/85 px-4 backdrop-blur-xl sm:px-6">
          <button
            type="button"
            onClick={() => setMobileOpen(true)}
            className="alpha-icon-button lg:hidden"
            aria-label="Open navigation"
            aria-expanded={mobileOpen}
          >
            <span aria-hidden="true">☰</span>
          </button>

          <label className="relative hidden max-w-xl flex-1 md:block">
            <span className="sr-only">Global search</span>
            <span className="pointer-events-none absolute left-3 top-2.5 text-slate-500">
              ⌕
            </span>
            <input
              type="search"
              placeholder="Search FleetPilot"
              className="h-10 w-full rounded-xl border border-slate-800 bg-slate-900/70 pl-9 pr-16 text-sm text-slate-200 outline-none placeholder:text-slate-500 focus:border-blue-500/70 focus:ring-2 focus:ring-blue-500/10"
            />
            <span className="pointer-events-none absolute right-3 top-2.5 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-500">
              ⌘ K
            </span>
          </label>

          <div className="ml-auto flex min-w-0 items-center gap-2">
            <span className="hidden rounded-full border border-blue-400/20 bg-blue-400/10 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-200 sm:inline-flex">
              Internal Alpha
            </span>
            <label className="hidden min-w-0 sm:block">
              <span className="sr-only">Active company</span>
              <select
                aria-label="Active company"
                value={companyContext?.activeCompanyId ?? ''}
                onChange={(event) => void switchCompany(event.target.value)}
                className="h-10 max-w-52 rounded-xl border border-slate-800 bg-slate-900 px-3 text-sm font-medium text-slate-200 outline-none focus:border-blue-500"
              >
                {!companyContext && <option value="">Loading company…</option>}
                {companyContext?.companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
            </label>

            <div className="relative">
              <button
                ref={profileTriggerRef}
                type="button"
                onClick={() => setProfileOpen((current) => !current)}
                className="flex h-10 items-center gap-2 rounded-xl border border-slate-800 bg-slate-900 p-1.5 pr-2 text-left hover:border-slate-700"
                aria-label="Open profile menu"
                aria-expanded={profileOpen}
                aria-haspopup="menu"
                aria-controls="profile-menu"
              >
                <span className="grid h-7 w-7 place-items-center rounded-lg bg-gradient-to-br from-blue-500 to-cyan-400 text-xs font-bold text-white">
                  {userInitial}
                </span>
                <span className="hidden max-w-36 truncate text-xs font-semibold text-slate-200 xl:block">
                  {companyContext?.user.displayName ?? 'FleetPilot user'}
                </span>
                <span className="text-[10px] text-slate-500">▾</span>
              </button>
              {profileOpen && (
                <div
                  ref={profileMenuRef}
                  id="profile-menu"
                  role="menu"
                  aria-label="Profile"
                  onKeyDown={navigateProfileMenu}
                  className="absolute right-0 top-12 w-64 rounded-xl border border-slate-800 bg-slate-950 p-2 shadow-2xl shadow-black/40"
                >
                  <div className="border-b border-slate-800 px-3 py-2">
                    <p className="truncate text-sm font-semibold text-white">
                      {companyContext?.user.displayName ?? 'FleetPilot user'}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {companyContext?.user.email ?? companyError}
                    </p>
                  </div>
                  <div className="px-3 py-2 text-xs text-slate-400">
                    <p>{activeCompany?.name ?? 'No active company'}</p>
                    {activeCompany && (
                      <p className="mt-0.5 capitalize text-slate-600">
                        {activeCompany.role.toLowerCase()}
                      </p>
                    )}
                  </div>
                  <Link
                    href="/api/auth/signout"
                    role="menuitem"
                    className="block rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-900 hover:text-white"
                  >
                    Sign out
                  </Link>
                </div>
              )}
            </div>
          </div>
        </header>

        {companyError && (
          <div role="status" className="border-b border-amber-400/20 bg-amber-400/10 px-5 py-2 text-xs text-amber-200">
            {companyError}. Sign in or choose an authorized company to load private data.
          </div>
        )}

        <div className="min-h-[calc(100vh-4rem)]">{children}</div>
      </div>
    </div>
  );
}
