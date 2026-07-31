import type { ReactNode } from 'react';

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        {eyebrow && (
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-300">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-white sm:text-3xl">
          {title}
        </h1>
        {description && (
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

const metricTones = {
  blue: 'from-blue-500/15 text-blue-300 ring-blue-400/15',
  cyan: 'from-cyan-500/15 text-cyan-300 ring-cyan-400/15',
  emerald: 'from-emerald-500/15 text-emerald-300 ring-emerald-400/15',
  amber: 'from-amber-500/15 text-amber-300 ring-amber-400/15',
  rose: 'from-rose-500/15 text-rose-300 ring-rose-400/15',
  violet: 'from-violet-500/15 text-violet-300 ring-violet-400/15',
} as const;

export function MetricCard({
  label,
  value,
  detail,
  tone = 'blue',
}: {
  label: string;
  value: ReactNode;
  detail: string;
  tone?: keyof typeof metricTones;
}) {
  return (
    <article className={`rounded-2xl bg-gradient-to-br ${metricTones[tone]} to-slate-950/30 p-px ring-1 ring-inset`}>
      <div className="h-full rounded-[15px] border border-white/5 bg-slate-950/75 p-4">
        <p className="text-xs font-medium text-slate-400">{label}</p>
        <p className="mt-3 text-2xl font-bold tracking-tight text-white">{value}</p>
        <p className="mt-1 text-[11px] text-slate-500">{detail}</p>
      </div>
    </article>
  );
}

const statusTones = {
  neutral: 'bg-slate-700/45 text-slate-300 ring-slate-600/50',
  blue: 'bg-blue-500/12 text-blue-200 ring-blue-400/20',
  green: 'bg-emerald-500/12 text-emerald-200 ring-emerald-400/20',
  yellow: 'bg-amber-500/12 text-amber-200 ring-amber-400/20',
  red: 'bg-rose-500/12 text-rose-200 ring-rose-400/20',
  violet: 'bg-violet-500/12 text-violet-200 ring-violet-400/20',
} as const;

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: keyof typeof statusTones;
}) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${statusTones[tone]}`}>
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="grid min-h-48 place-items-center rounded-xl border border-dashed border-slate-700/70 bg-slate-950/25 p-8 text-center">
      <div>
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-slate-800 text-slate-400">
          ◇
        </div>
        <h3 className="mt-4 text-sm font-semibold text-slate-200">{title}</h3>
        <p className="mx-auto mt-1 max-w-md text-xs leading-5 text-slate-500">
          {description}
        </p>
        {action && <div className="mt-4">{action}</div>}
      </div>
    </div>
  );
}

export function PanelSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-label="Loading" className="animate-pulse space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="h-12 rounded-xl bg-slate-800/65" />
      ))}
    </div>
  );
}
