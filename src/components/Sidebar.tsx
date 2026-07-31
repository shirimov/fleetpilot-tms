'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useRef } from 'react';
import {
  alphaNavigation,
  navigationItemIsActive,
  type NavigationIconName,
} from '@/components/app-shell/navigation';
import ModalLayer from '@/components/ui/ModalLayer';

type SidebarProps = {
  collapsed?: boolean;
  mobileOpen?: boolean;
  query?: string;
  onCollapse?: () => void;
  onMobileClose?: () => void;
};

const iconPaths: Record<NavigationIconName, string> = {
  dashboard: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6v-9h-6v9Zm0-16v5h6V4h-6Z',
  dispatch: 'M3 6h11v10H3V6Zm11 4h3l4 4v2h-7v-6ZM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  loads: 'm12 3 9 5-9 5-9-5 9-5Zm-9 8 9 5 9-5v6l-9 5-9-5v-6Z',
  customers: 'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm8-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 21v-2a5 5 0 0 1 5-5h2a5 5 0 0 1 5 5v2H2Zm13-7h1a5 5 0 0 1 5 5v2h-5',
  trucks: 'M3 6h11v10H3V6Zm11 4h3l4 4v2h-7v-6ZM7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm11 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  trailers: 'M3 7h18v9H3V7Zm4 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm10 0a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  drivers: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 9v-2a7 7 0 0 1 14 0v2H5Zm3-8 4 3 4-3',
  inspections: 'M7 3h10v3H7V3ZM5 5h14v16H5V5Zm3 6 2 2 5-5m-7 8h8',
  tasks: 'M5 4h14v16H5V4Zm3 5 2 2 5-5m-7 10h8',
  settlements: 'M4 6h16v12H4V6Zm3 3h10M8 14h3',
  finance: 'M3 20h18M5 20V9m5 11V9m5 11V9m5 11V9M3 7l9-4 9 4H3Z',
  companies: 'M4 21V5h10v16M14 9h6v12M7 8h3m-3 4h3m-3 4h3m10-3h-3m3 4h-3',
  hr: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm6-1a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM2 21v-2a6 6 0 0 1 12 0v2m2-8a5 5 0 0 1 5 5v3',
  inbox: 'M3 5h18v14H3V5Zm0 2 9 7 9-7',
};

function NavigationIcon({ name }: { name: NavigationIconName }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px] shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={iconPaths[name]} />
    </svg>
  );
}

export default function Sidebar(props: SidebarProps = {}) {
  const pathname = usePathname();
  const mobileCloseRef = useRef<HTMLButtonElement>(null);
  if (!props.onCollapse || !props.onMobileClose) return null;
  const {
    collapsed = false,
    mobileOpen = false,
    query = '',
    onCollapse,
    onMobileClose,
  } = props;

  const content = (
    <>
      <div className="flex h-16 items-center border-b border-slate-800/80 px-4">
        <Link href="/" onClick={onMobileClose} className="flex min-w-0 items-center gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-blue-500 via-blue-500 to-cyan-400 shadow-lg shadow-blue-500/20">
            <svg viewBox="0 0 24 24" className="h-5 w-5 text-white" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="m4 15 16-9-6 14-2-6-8 1Z" strokeLinejoin="round" />
            </svg>
          </span>
          {!collapsed && (
            <span className="min-w-0">
              <span className="block truncate text-[15px] font-bold tracking-tight text-white">
                FleetPilot
              </span>
              <span className="block text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">
                Command center
              </span>
            </span>
          )}
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Primary navigation">
        {alphaNavigation.map((section) => (
          <section key={section.label} className="mb-4">
            {!collapsed && (
              <h2 className="mb-1.5 px-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-600">
                {section.label}
              </h2>
            )}
            <div className="space-y-0.5">
              {section.items.map((item) => {
                const active = navigationItemIsActive(item.href, pathname, query);
                if (item.unavailable) {
                  return (
                    <div
                      key={item.href}
                      title="Unavailable until company mailbox ownership is configured"
                      className="flex h-10 cursor-not-allowed items-center gap-3 rounded-lg px-2.5 text-slate-600"
                      aria-disabled="true"
                    >
                      <NavigationIcon name={item.icon} />
                      {!collapsed && (
                        <>
                          <span className="truncate text-sm">{item.label}</span>
                          <span className="ml-auto rounded bg-slate-800 px-1.5 py-0.5 text-[9px] uppercase tracking-wide">
                            Soon
                          </span>
                        </>
                      )}
                    </div>
                  );
                }
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={onMobileClose}
                    title={collapsed ? item.label : undefined}
                    className={`group flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm font-medium transition ${
                      active
                        ? 'bg-blue-500/15 text-blue-200 ring-1 ring-inset ring-blue-400/10'
                        : 'text-slate-400 hover:bg-slate-900 hover:text-slate-100'
                    }`}
                  >
                    <NavigationIcon name={item.icon} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                    {active && !collapsed && (
                      <span className="ml-auto h-1.5 w-1.5 rounded-full bg-blue-400" />
                    )}
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="border-t border-slate-800/80 p-3">
        <div className={`rounded-xl border border-slate-800 bg-slate-900/60 ${collapsed ? 'p-2' : 'p-3'}`}>
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-30" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </span>
            {!collapsed && (
              <div className="min-w-0">
                <p className="text-xs font-semibold text-slate-300">Systems operational</p>
                <p className="mt-0.5 text-[10px] text-slate-600">Private alpha environment</p>
              </div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onCollapse}
          className="mt-2 hidden h-9 w-full items-center justify-center rounded-lg text-xs text-slate-500 hover:bg-slate-900 hover:text-slate-200 lg:flex"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        >
          {collapsed ? '›' : '‹  Collapse'}
        </button>
      </div>
    </>
  );

  return (
    <>
      <aside
        className={`fixed inset-y-0 left-0 z-40 hidden flex-col border-r border-slate-800/80 bg-slate-950 transition-[width] duration-200 lg:flex ${
          collapsed ? 'w-[5.25rem]' : 'w-[17rem]'
        }`}
      >
        {content}
      </aside>
      {mobileOpen && (
        <ModalLayer
          className="fixed inset-0 z-50 lg:hidden"
          labelledBy="mobile-navigation-title"
          describedBy="mobile-navigation-description"
          initialFocusRef={mobileCloseRef}
          onClose={onMobileClose}
        >
          <button
            type="button"
            tabIndex={-1}
            aria-label="Dismiss navigation"
            onClick={onMobileClose}
            className="absolute inset-0 bg-black/65 backdrop-blur-sm"
          />
          <aside
            aria-label="Mobile navigation"
            className="relative flex h-full w-[min(19rem,86vw)] flex-col border-r border-slate-800 bg-slate-950 shadow-2xl"
          >
            <h2 id="mobile-navigation-title" className="sr-only">
              FleetPilot navigation
            </h2>
            <p id="mobile-navigation-description" className="sr-only">
              Navigate between completed Internal Alpha modules.
            </p>
            <button
              ref={mobileCloseRef}
              type="button"
              onClick={onMobileClose}
              aria-label="Close navigation"
              className="absolute right-3 top-3 z-10 grid h-9 w-9 place-items-center rounded-lg border border-slate-800 bg-slate-900 text-slate-400 hover:text-white"
            >
              ×
            </button>
            {content}
          </aside>
        </ModalLayer>
      )}
    </>
  );
}
