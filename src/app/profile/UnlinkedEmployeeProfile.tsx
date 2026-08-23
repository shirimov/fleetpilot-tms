import type { CompanyMembershipRole } from '@prisma/client';

export default function UnlinkedEmployeeProfile({
  role,
}: {
  role: CompanyMembershipRole;
}) {
  const canManageProfiles = role !== 'MEMBER';

  return (
    <main className="min-h-screen bg-[#0e1017] p-6 text-slate-100 sm:p-8">
      <section className="mx-auto max-w-2xl rounded-2xl border border-white/10 bg-[#171a24] p-6 shadow-xl shadow-black/20 sm:p-8">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-300">
          Employee profile
        </p>
        <h1 className="mt-2 text-3xl font-semibold">My Profile</h1>
        <div
          role="status"
          className="mt-6 rounded-xl border border-amber-300/20 bg-amber-300/10 p-4 text-amber-100"
        >
          <p className="font-medium">
            Your employee profile has not been linked yet.
          </p>
          <p className="mt-2 text-sm text-amber-100/75">
            {canManageProfiles
              ? 'Link your FleetPilot user to an employee profile before using workforce profile features.'
              : 'Ask a company owner or administrator to link your FleetPilot user to your employee profile.'}
          </p>
        </div>
      </section>
    </main>
  );
}
