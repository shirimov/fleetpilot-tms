'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  EmptyState,
  MetricCard,
  PageHeader,
  PanelSkeleton,
  StatusBadge,
} from '@/components/ui/alpha';

type DashboardSnapshot = {
  activeLoads: number;
  unassignedLoads: number;
  availableTrucks: number;
  availableTrailers: number;
  activeDrivers: number;
  loadsAtRisk: number;
  overdueTasks: number;
  pendingSettlements: number;
  loadsThisWeek: number;
  revenueThisWeek: number;
  recentLoads: Array<{
    id: string;
    loadNumber: string;
    origin: string;
    destination: string;
    rate: number;
    status: string;
    truck: { unitNumber: string } | null;
    driver: { firstName: string; lastName: string } | null;
  }>;
  recentActivity: Array<{
    id: string;
    type: 'task' | 'load';
    action: string;
    title: string;
    actor: string;
    occurredAt: string;
  }>;
};

function statusTone(status: string): 'neutral' | 'blue' | 'green' | 'yellow' | 'red' | 'violet' {
  if (status === 'PAID' || status === 'DELIVERED') return 'green';
  if (status === 'IN_TRANSIT' || status === 'DISPATCHED') return 'blue';
  if (status === 'CANCELLED') return 'red';
  if (status === 'POD_UPLOADED' || status === 'INVOICED') return 'violet';
  return 'yellow';
}

function formatAction(action: string) {
  return action.toLowerCase().replaceAll('_', ' ');
}

export default function Home() {
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    fetch('/api/dashboard', { cache: 'no-store' })
      .then(async (response) => {
        const body = (await response.json()) as DashboardSnapshot | { error?: string };
        if (!response.ok) {
          throw new Error('error' in body ? body.error : 'Dashboard unavailable');
        }
        return body as DashboardSnapshot;
      })
      .then((nextSnapshot) => {
        if (active) setSnapshot(nextSnapshot);
      })
      .catch((caught: Error) => {
        if (active) setError(caught.message || 'Dashboard unavailable');
      });
    return () => {
      active = false;
    };
  }, []);

  const metrics = [
    ['Active loads', snapshot?.activeLoads, 'Moving through operations', 'blue'],
    ['Unassigned', snapshot?.unassignedLoads, 'Need equipment or driver', 'amber'],
    ['Available trucks', snapshot?.availableTrucks, 'Ready for assignment', 'cyan'],
    ['Available trailers', snapshot?.availableTrailers, 'Ready for assignment', 'emerald'],
    ['Active drivers', snapshot?.activeDrivers, 'Company driver roster', 'violet'],
    ['Loads at risk', snapshot?.loadsAtRisk, 'Late or incomplete assignment', 'rose'],
    ['Overdue tasks', snapshot?.overdueTasks, 'Open past their due date', 'amber'],
    ['Pending settlements', snapshot?.pendingSettlements, 'Awaiting payment', 'blue'],
  ] as const;

  return (
    <main className="alpha-page">
      <PageHeader
        eyebrow="Operations command center"
        title="Good morning, dispatch"
        description="A live view of the work, equipment, and exceptions that need attention across your active company."
        actions={
          <>
            <Link href="/tasks" className="rounded-xl border border-slate-700 bg-slate-900 px-4 py-2.5 text-sm font-semibold text-slate-200 hover:border-slate-600 hover:bg-slate-800">
              Open tasks
            </Link>
            <Link href="/loads?view=loads" className="rounded-xl bg-blue-500 px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-blue-500/20 hover:bg-blue-400">
              + New load
            </Link>
          </>
        }
      />

      {error && (
        <div role="alert" className="mt-6 rounded-xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {error}. Confirm your session and active-company membership, then refresh.
        </div>
      )}

      <section aria-label="Operational metrics" className="mt-7 grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-8">
        {metrics.map(([label, value, detail, tone]) => (
          <MetricCard
            key={label}
            label={label}
            value={snapshot ? value ?? 0 : <span className="text-slate-700">—</span>}
            detail={detail}
            tone={tone}
          />
        ))}
      </section>

      <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.65fr)_minmax(20rem,0.75fr)]">
        <section className="alpha-panel min-w-0 p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="font-semibold text-white">Recent loads</h2>
              <p className="mt-1 text-xs text-slate-500">
                {snapshot?.loadsThisWeek ?? 0} created this week ·{' '}
                ${(snapshot?.revenueThisWeek ?? 0).toLocaleString()} gross
              </p>
            </div>
            <Link href="/loads?view=dispatch" className="text-xs font-semibold text-blue-300 hover:text-blue-200">
              Dispatch board →
            </Link>
          </div>

          {!snapshot ? (
            <PanelSkeleton rows={5} />
          ) : snapshot.recentLoads.length === 0 ? (
            <EmptyState
              title="No loads yet"
              description="Create the first load in the dispatch workspace to start tracking operations."
              action={<Link href="/loads?view=loads" className="text-sm font-semibold text-blue-300">Create a load</Link>}
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-800 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">
                    <th className="px-2 pb-3">Load</th>
                    <th className="px-2 pb-3">Route</th>
                    <th className="px-2 pb-3">Assignment</th>
                    <th className="px-2 pb-3">Rate</th>
                    <th className="px-2 pb-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {snapshot.recentLoads.map((load) => (
                    <tr key={load.id} className="border-b border-slate-800/60 last:border-0 hover:bg-slate-800/30">
                      <td className="px-2 py-3 font-mono text-xs font-bold text-blue-300">{load.loadNumber}</td>
                      <td className="px-2 py-3">
                        <p className="max-w-56 truncate text-slate-200">{load.origin} → {load.destination}</p>
                      </td>
                      <td className="px-2 py-3 text-xs text-slate-400">
                        {load.truck?.unitNumber ?? 'No truck'} ·{' '}
                        {load.driver ? `${load.driver.firstName} ${load.driver.lastName}` : 'No driver'}
                      </td>
                      <td className="px-2 py-3 font-medium text-emerald-300">${load.rate.toLocaleString()}</td>
                      <td className="px-2 py-3"><StatusBadge tone={statusTone(load.status)}>{formatAction(load.status)}</StatusBadge></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <div className="space-y-6">
          <section className="alpha-panel p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="font-semibold text-white">Recent activity</h2>
                <p className="mt-1 text-xs text-slate-500">Verified load and task events</p>
              </div>
              <Link href="/tasks" className="text-xs font-semibold text-blue-300">View tasks</Link>
            </div>
            {!snapshot ? (
              <PanelSkeleton rows={4} />
            ) : snapshot.recentActivity.length === 0 ? (
              <EmptyState title="No recent activity" description="Verified operational events will appear here." />
            ) : (
              <ol className="space-y-1">
                {snapshot.recentActivity.map((activity) => (
                  <li key={activity.id} className="flex gap-3 rounded-xl px-2 py-2.5 hover:bg-slate-800/35">
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${activity.type === 'task' ? 'bg-blue-400' : 'bg-emerald-400'}`} />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-200">{activity.title}</p>
                      <p className="mt-0.5 text-xs text-slate-500">
                        {activity.actor} · {formatAction(activity.action)}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>

          <section className="rounded-2xl border border-amber-400/15 bg-gradient-to-br from-amber-400/10 to-slate-950/40 p-5">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-amber-400/10 text-amber-300">↗</span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-sm font-semibold text-slate-200">QuickManage integration</h2>
                  <StatusBadge tone="yellow">Unavailable</StatusBadge>
                </div>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  Live gross remains disabled until a reviewed company-to-carrier mapping and tenant-partitioned cache exist.
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
