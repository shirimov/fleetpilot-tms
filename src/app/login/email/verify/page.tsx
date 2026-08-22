import { VerifyEmailSignIn } from '@/components/auth/VerifyEmailSignIn';

export default function VerifyEmailPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-8 shadow-2xl">
        <p className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">FleetPilot</p>
        <VerifyEmailSignIn />
      </section>
    </main>
  );
}
