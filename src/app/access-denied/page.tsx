import Link from 'next/link';

export default function AccessDeniedPage() {
  return (
    <main className="alpha-page grid min-h-[calc(100vh-4rem)] place-items-center">
      <section className="alpha-panel max-w-lg p-8 text-center">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-amber-300">
          Access denied
        </p>
        <h1 className="mt-3 text-2xl font-bold text-white">This module is not available for your role</h1>
        <p className="mt-3 text-sm text-slate-400">
          Your company access currently includes Task Manager. Contact a company owner or administrator if your responsibilities change.
        </p>
        <Link href="/tasks" className="btn btn-primary mt-6 inline-flex">
          Return to Task Manager
        </Link>
      </section>
    </main>
  );
}
