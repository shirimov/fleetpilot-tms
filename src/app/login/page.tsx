import { signIn } from '@/auth';

export default function LoginPage() {
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-white">
      <section className="w-full max-w-md rounded-2xl border border-white/10 bg-slate-900 p-8 shadow-2xl">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">
          FleetPilot
        </p>
        <h1 className="mt-3 text-3xl font-semibold">Secure sign in</h1>
        <p className="mt-3 text-sm leading-6 text-slate-400">
          Sign in with the GitHub account approved for your FleetPilot company.
          Company access is verified on the server after authentication.
        </p>
        <form
          className="mt-7"
          action={async () => {
            'use server';
            await signIn('github', { redirectTo: '/tasks' });
          }}
        >
          <button
            type="submit"
            className="w-full rounded-lg bg-blue-500 px-4 py-3 text-sm font-semibold hover:bg-blue-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300"
          >
            Continue with GitHub
          </button>
        </form>
      </section>
    </main>
  );
}
