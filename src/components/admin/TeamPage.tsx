"use client";

import React, { useEffect, useRef, useState } from 'react';
import ModalLayer from '@/components/ui/ModalLayer';
import Link from 'next/link';

type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';

type Member = {
  id: string;
  role: MemberRole;
  user: {
    id: string;
    displayName: string;
    email: string;
    image?: string | null;
    isActive: boolean;
    hasSignedIn: boolean;
  };
  openTasks: number;
  overdueTasks: number;
  dueToday: number;
  telegram: {
    connected: boolean;
    username: string | null;
  };
  employee: { id: string; preferredName: string | null; jobTitle: string | null; department: string | null; photoUrl: string | null } | null;
  employeeProfileStatus: 'LINKED' | 'NOT_CREATED' | 'UNLINKED_AVAILABLE';
};

type EmployeeOption = {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  jobTitle?: string | null;
  department?: string | null;
};

type TelegramInvite = {
  memberName: string;
  deepLink: string;
  expiresAt: string;
};

function canManageMember(actorRole: MemberRole, targetRole: MemberRole) {
  return actorRole === 'OWNER' || (actorRole === 'ADMIN' && targetRole !== 'OWNER');
}

function canManageTelegram(
  actorRole: MemberRole,
  currentUserId: string | null,
  member: Member,
) {
  return member.user.id === currentUserId || canManageMember(actorRole, member.role);
}

function assignableRoles(actorRole: MemberRole) {
  return actorRole === 'OWNER'
    ? (['OWNER', 'ADMIN', 'MEMBER'] satisfies MemberRole[])
    : (['ADMIN', 'MEMBER'] satisfies MemberRole[]);
}

export default function TeamPage() {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [currentUserRole, setCurrentUserRole] = useState<MemberRole>('MEMBER');
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [telegramAvailable, setTelegramAvailable] = useState(false);
  const [invite, setInvite] = useState<TelegramInvite | null>(null);
  const [profileMember, setProfileMember] = useState<Member | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const now = new Date();
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const end = new Date(start);
      end.setDate(start.getDate() + 1);
      const params = new URLSearchParams();
      params.set('start', start.toISOString());
      params.set('end', end.toISOString());

      const resp = await fetch(`/api/company/team?${params.toString()}`);
      if (!resp.ok) throw new Error(`Status ${resp.status}`);
      const data = await resp.json();
      setMembers(data.members ?? []);
      setCurrentUserRole(data.currentUserRole ?? 'MEMBER');
      setCurrentUserId(data.currentUserId ?? null);
      setTelegramAvailable(data.telegramAvailable === true);
    } catch {
      setError('Failed to load team.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = members.filter((member) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      member.user.displayName.toLowerCase().includes(q) ||
      member.user.email.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-4">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Team</h1>
        <div className="flex items-center gap-2">
          <input
            placeholder="Search name or email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="rounded border bg-slate-900/20 px-2 py-1"
          />
          {currentUserRole !== 'MEMBER' ? (
            <button onClick={() => setShowAdd(true)} className="btn btn-primary">
              Add Member
            </button>
          ) : null}
        </div>
      </div>

      {loading ? <div>Loading…</div> : null}
      {error ? <div className="text-rose-400">{error}</div> : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="text-sm text-slate-400">
              <th className="p-2">Name</th>
              <th className="p-2">Email</th>
              <th className="p-2">Role</th>
              <th className="p-2">Status</th>
              <th className="p-2">Account</th>
              <th className="p-2">Open</th>
              <th className="p-2">Overdue</th>
              <th className="p-2">Due Today</th>
              <th className="p-2">Telegram</th>
              <th className="p-2">Employee Profile</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((member) => (
              <tr key={member.id} className="border-t border-white/6">
                <td className="p-2 align-middle">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-sm">
                      {member.employee?.photoUrl || member.user.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- user-provided remote avatars are not configured for next/image
                        <img src={member.employee?.photoUrl ?? member.user.image ?? ''} alt="" className="h-8 w-8 rounded-full object-cover" />
                      ) : (
                        (member.user.displayName || member.user.email)
                          .slice(0, 2)
                          .toUpperCase()
                      )}
                    </div>
                    <div><div className="font-medium">{member.employee?.preferredName || member.user.displayName}</div>{member.employee && <div className="text-xs text-slate-500">{member.employee.jobTitle || 'Team member'}{member.employee.department ? ` · ${member.employee.department}` : ''}</div>}</div>
                  </div>
                </td>
                <td className="p-2">{member.user.email}</td>
                <td className="p-2">{member.role}</td>
                <td className="p-2">{member.user.isActive ? 'Active' : 'Inactive'}</td>
                <td className="p-2">
                  <div className="text-sm">
                    <div>{member.user.hasSignedIn ? 'Signed in' : 'Not signed in yet'}</div>
                    <div className="text-xs text-slate-400">
                      {member.user.isActive ? 'Active' : 'Inactive'}
                    </div>
                  </div>
                </td>
                <td className="p-2">{member.openTasks}</td>
                <td className="p-2">{member.overdueTasks}</td>
                <td className="p-2">{member.dueToday}</td>
                <td className="p-2">
                  <div className="text-sm">
                    <div>
                      {!telegramAvailable
                        ? 'Unavailable'
                        : member.telegram.connected
                          ? 'Connected'
                          : 'Not connected'}
                    </div>
                    {telegramAvailable && member.telegram.connected && member.telegram.username ? (
                      <div className="text-xs text-slate-400">@{member.telegram.username}</div>
                    ) : null}
                  </div>
                </td>
                <td className="p-2">
                  {member.employeeProfileStatus === 'LINKED'
                    ? 'Linked'
                    : member.employeeProfileStatus === 'UNLINKED_AVAILABLE'
                      ? 'Unlinked employee available'
                      : 'Not created'}
                </td>
                <td className="p-2">
                  <div className="flex flex-wrap gap-2">
                    {member.employee && <Link href={`/hr/employees/${member.employee.id}`} className="rounded border border-white/10 px-2 py-1 text-xs hover:bg-white/5">View Profile</Link>}
                    {!member.employee && currentUserRole !== 'MEMBER' ? (
                      <button
                        type="button"
                        onClick={() => setProfileMember(member)}
                        className="btn btn-sm"
                      >
                        Create Employee Profile
                      </button>
                    ) : null}
                    <TelegramControl
                      member={member}
                      currentUserId={currentUserId}
                      currentUserRole={currentUserRole}
                      telegramAvailable={telegramAvailable}
                      onInvite={setInvite}
                      reload={load}
                    />
                    {canManageMember(currentUserRole, member.role) ? (
                      <RoleControl member={member} actorRole={currentUserRole} reload={load} />
                    ) : null}
                    {canManageMember(currentUserRole, member.role) ? (
                      <RemoveControl member={member} reload={load} />
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd ? (
        <AddMemberModal
          actorRole={currentUserRole}
          onClose={() => {
            setShowAdd(false);
            void load();
          }}
        />
      ) : null}

      {invite ? (
        <TelegramInviteModal
          invite={invite}
          onClose={() => setInvite(null)}
        />
      ) : null}

      {profileMember ? (
        <EmployeeProfileOnboardingModal
          member={profileMember}
          onClose={() => setProfileMember(null)}
          onSaved={async () => {
            setProfileMember(null);
            await load();
          }}
        />
      ) : null}
    </div>
  );
}

function splitDisplayName(displayName: string) {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? '',
    lastName: parts.slice(1).join(' '),
  };
}

function EmployeeProfileOnboardingModal({
  member,
  onClose,
  onSaved,
}: {
  member: Member;
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const names = splitDisplayName(member.user.displayName);
  const [form, setForm] = useState({
    firstName: names.firstName,
    lastName: names.lastName,
    preferredName: member.user.displayName,
    jobTitle: '',
    department: '',
    employmentType: 'FULL_TIME',
    employmentStatus: 'ACTIVE',
    startDate: '',
    birthDate: '',
    phone: '',
    workLocation: '',
    timezone: 'UTC',
    managerId: '',
    salary: '',
    payType: 'SALARY',
    payFrequency: 'MONTHLY',
    currency: 'USD',
    compensationEffectiveAt: '',
    compensationNotes: '',
  });
  const [managers, setManagers] = useState<EmployeeOption[]>([]);
  const [unlinkedEmployees, setUnlinkedEmployees] = useState<EmployeeOption[]>([]);
  const [existingEmployeeId, setExistingEmployeeId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const firstNameRef = useRef<HTMLInputElement | null>(null);
  const endpoint = `/api/company/team/${member.user.id}/employee-profile`;

  useEffect(() => {
    let active = true;
    fetch(endpoint, { cache: 'no-store' })
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? 'Profile options could not be loaded.');
        return body as { managers: EmployeeOption[]; unlinkedEmployees: EmployeeOption[] };
      })
      .then((body) => {
        if (!active) return;
        setManagers(body.managers);
        setUnlinkedEmployees(body.unlinkedEmployees);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : 'Profile options could not be loaded.');
      });
    return () => { active = false; };
  }, [endpoint]);

  function field(name: keyof typeof form, value: string) {
    setForm((current) => ({ ...current, [name]: value }));
  }

  async function create(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          managerId: form.managerId || null,
          salary: form.salary === '' ? null : Number(form.salary),
          startDate: form.startDate || null,
          birthDate: form.birthDate || null,
          compensationEffectiveAt: form.compensationEffectiveAt || null,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Employee profile could not be created.');
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Employee profile could not be created.');
    } finally {
      setBusy(false);
    }
  }

  async function linkExisting() {
    if (!existingEmployeeId) return;
    setBusy(true);
    setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeId: existingEmployeeId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Employee profile could not be linked.');
      await onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Employee profile could not be linked.');
    } finally {
      setBusy(false);
    }
  }

  const inputClass = 'w-full rounded border border-white/10 bg-slate-950/50 px-3 py-2 text-sm';
  return (
    <ModalLayer
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      labelledBy="employee-profile-onboarding-title"
      describedBy="employee-profile-onboarding-description"
      initialFocusRef={firstNameRef}
      onClose={onClose}
    >
      <button type="button" aria-hidden="true" tabIndex={-1} onClick={onClose} className="absolute inset-0 bg-black/60" />
      <form onSubmit={(event) => void create(event)} className="relative z-10 max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl border border-white/10 bg-slate-900 p-5">
        <h2 id="employee-profile-onboarding-title" className="text-xl font-semibold">Create Employee Profile</h2>
        <p id="employee-profile-onboarding-description" className="mt-1 text-sm text-slate-400">
          Create and link an employee profile for {member.user.displayName}. This reuses the existing FleetPilot user.
        </p>
        <p className="mt-2 text-sm text-slate-300">Account email: {member.user.email}</p>
        {error ? <div role="alert" className="mt-3 rounded bg-rose-400/10 p-3 text-sm text-rose-300">{error}</div> : null}
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">First name<input ref={firstNameRef} required value={form.firstName} onChange={(event) => field('firstName', event.target.value)} className={inputClass} /></label>
          <label className="text-sm">Last name<input required value={form.lastName} onChange={(event) => field('lastName', event.target.value)} className={inputClass} /></label>
          <label className="text-sm">Preferred name<input value={form.preferredName} onChange={(event) => field('preferredName', event.target.value)} className={inputClass} /></label>
          <label className="text-sm">Job title<input value={form.jobTitle} onChange={(event) => field('jobTitle', event.target.value)} className={inputClass} /></label>
          <label className="text-sm">Department<input value={form.department} onChange={(event) => field('department', event.target.value)} className={inputClass} /></label>
          <label className="text-sm">Phone<input value={form.phone} onChange={(event) => field('phone', event.target.value)} className={inputClass} /></label>
          <label className="text-sm">Work location<input value={form.workLocation} onChange={(event) => field('workLocation', event.target.value)} className={inputClass} /></label>
          <label className="text-sm">Timezone<input required value={form.timezone} onChange={(event) => field('timezone', event.target.value)} className={inputClass} /></label>
          <label className="text-sm">Employment type<select value={form.employmentType} onChange={(event) => field('employmentType', event.target.value)} className={inputClass}>{['FULL_TIME', 'PART_TIME', 'CONTRACTOR', 'TEMPORARY'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-sm">Employment status<select value={form.employmentStatus} onChange={(event) => field('employmentStatus', event.target.value)} className={inputClass}>{['ACTIVE', 'LEAVE', 'INACTIVE', 'TERMINATED'].map((value) => <option key={value}>{value}</option>)}</select></label>
          <label className="text-sm">Start date<input type="date" value={form.startDate} onChange={(event) => field('startDate', event.target.value)} className={inputClass} /></label>
          <label className="text-sm">Birth date<input type="date" value={form.birthDate} onChange={(event) => field('birthDate', event.target.value)} className={inputClass} /></label>
          <label className="text-sm">Manager<select value={form.managerId} onChange={(event) => field('managerId', event.target.value)} className={inputClass}><option value="">No manager</option>{managers.map((manager) => <option key={manager.id} value={manager.id}>{manager.firstName} {manager.lastName}{manager.jobTitle ? ` — ${manager.jobTitle}` : ''}</option>)}</select></label>
        </div>
        <fieldset className="mt-5 rounded-lg border border-white/10 p-4">
          <legend className="px-2 text-sm font-medium">Compensation</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">Salary / rate<input type="number" min="0" step="0.01" value={form.salary} onChange={(event) => field('salary', event.target.value)} className={inputClass} /></label>
            <label className="text-sm">Currency<input value={form.currency} onChange={(event) => field('currency', event.target.value)} className={inputClass} /></label>
            <label className="text-sm">Pay type<select value={form.payType} onChange={(event) => field('payType', event.target.value)} className={inputClass}><option>SALARY</option><option>HOURLY</option></select></label>
            <label className="text-sm">Pay frequency<select value={form.payFrequency} onChange={(event) => field('payFrequency', event.target.value)} className={inputClass}>{['WEEKLY', 'BIWEEKLY', 'SEMIMONTHLY', 'MONTHLY'].map((value) => <option key={value}>{value}</option>)}</select></label>
            <label className="text-sm">Effective date<input type="date" value={form.compensationEffectiveAt} onChange={(event) => field('compensationEffectiveAt', event.target.value)} className={inputClass} /></label>
            <label className="text-sm">Compensation notes<input value={form.compensationNotes} onChange={(event) => field('compensationNotes', event.target.value)} className={inputClass} /></label>
          </div>
        </fieldset>
        {unlinkedEmployees.length > 0 ? (
          <section className="mt-5 rounded-lg border border-blue-300/20 bg-blue-300/5 p-4">
            <h3 className="font-medium">Link Existing Employee</h3>
            <p className="mt-1 text-xs text-slate-400">Select explicitly. FleetPilot never links by name or email automatically.</p>
            <div className="mt-3 flex gap-2">
              <select aria-label="Existing employee" value={existingEmployeeId} onChange={(event) => setExistingEmployeeId(event.target.value)} className={inputClass}>
                <option value="">Select an unlinked employee</option>
                {unlinkedEmployees.map((employee) => <option key={employee.id} value={employee.id}>{employee.firstName} {employee.lastName}{employee.jobTitle ? ` — ${employee.jobTitle}` : ''}</option>)}
              </select>
              <button type="button" disabled={busy || !existingEmployeeId} onClick={() => void linkExisting()} className="btn btn-sm">Link Existing Employee</button>
            </div>
          </section>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn btn-primary">{busy ? 'Saving…' : 'Create and Link Profile'}</button>
        </div>
      </form>
    </ModalLayer>
  );
}

function TelegramControl({
  member,
  currentUserId,
  currentUserRole,
  telegramAvailable,
  onInvite,
  reload,
}: {
  member: Member;
  currentUserId: string | null;
  currentUserRole: MemberRole;
  telegramAvailable: boolean;
  onInvite: (invite: TelegramInvite) => void;
  reload: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  if (
    !telegramAvailable ||
    !canManageTelegram(currentUserRole, currentUserId, member)
  ) return null;

  async function connect() {
    setBusy(true);
    try {
      const response = await fetch(`/api/company/team/${member.user.id}/telegram-link`, {
        method: 'POST',
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? 'Failed to create Telegram link.');
      onInvite({
        memberName: member.user.displayName,
        deepLink: body.deepLink,
        expiresAt: body.expiresAt,
      });
    } catch {
      // keep UI minimal; parent load captures later state
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirmDisconnect) {
      setConfirmDisconnect(true);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch(`/api/company/team/${member.user.id}/telegram-link`, {
        method: 'DELETE',
      });
      if (!response.ok) throw new Error('disconnect failed');
      await reload();
    } catch {
      // keep UI minimal; parent load captures later state
    } finally {
      setBusy(false);
      setConfirmDisconnect(false);
    }
  }

  return member.telegram.connected ? (
    <button
      type="button"
      onClick={() => void disconnect()}
      disabled={busy}
      className="btn btn-ghost btn-sm text-amber-300"
    >
      {confirmDisconnect ? 'Confirm Disconnect' : 'Disconnect'}
    </button>
  ) : (
    <button
      type="button"
      onClick={() => void connect()}
      disabled={busy}
      className="btn btn-sm"
    >
      Connect Telegram
    </button>
  );
}

function TelegramInviteModal({
  invite,
  onClose,
}: {
  invite: TelegramInvite;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  return (
    <ModalLayer
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      labelledBy="telegram-invite-title"
      describedBy="telegram-invite-description"
      initialFocusRef={closeRef}
      onClose={onClose}
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <div className="relative z-10 w-full max-w-lg rounded bg-slate-900 p-4">
        <h2 id="telegram-invite-title" className="mb-2 text-lg font-medium">
          Connect Telegram
        </h2>
        <p id="telegram-invite-description" className="mb-3 text-sm text-slate-300">
          The Telegram identity is only verified when {invite.memberName} opens this one-time link in Telegram.
        </p>
        <div className="rounded border border-white/10 bg-slate-950/40 p-3 text-sm break-all">
          {invite.deepLink}
        </div>
        <p className="mt-2 text-xs text-slate-400">
          Expires: {new Date(invite.expiresAt).toLocaleString()}
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button ref={closeRef} type="button" onClick={onClose} className="btn btn-ghost">
            Close
          </button>
          <a href={invite.deepLink} target="_blank" rel="noreferrer" className="btn btn-primary">
            Open Telegram
          </a>
        </div>
      </div>
    </ModalLayer>
  );
}

function RoleControl({
  member,
  actorRole,
  reload,
}: {
  member: Member;
  actorRole: MemberRole;
  reload: () => Promise<void>;
}) {
  const [changing, setChanging] = useState(false);
  const [role, setRole] = useState(member.role);
  const roles = assignableRoles(actorRole);

  async function save() {
    if (role === member.role) return;
    setChanging(true);
    try {
      const response = await fetch('/api/company/team', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: member.user.id, role }),
      });
      if (!response.ok) throw new Error('failed');
      await reload();
    } finally {
      setChanging(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <select
        value={role}
        onChange={(event) => setRole(event.target.value as Member['role'])}
        className="rounded bg-slate-900/10 px-2 py-1"
      >
        {roles.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <button disabled={changing || role === member.role} onClick={() => void save()} className="btn btn-sm">
        Save
      </button>
    </div>
  );
}

function RemoveControl({
  member,
  reload,
}: {
  member: Member;
  reload: () => Promise<void>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm) {
      setConfirm(true);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch('/api/company/team', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: member.user.id }),
      });
      if (!response.ok) throw new Error('failed');
      await reload();
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <button onClick={() => void remove()} disabled={busy} className="btn btn-ghost btn-sm text-rose-400">
      {confirm ? 'Confirm' : 'Remove'}
    </button>
  );
}

function AddMemberModal({
  actorRole,
  onClose,
}: {
  actorRole: MemberRole;
  onClose: () => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<MemberRole>('MEMBER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
  const roles = assignableRoles(actorRole);

  async function submit(event?: React.FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch('/api/company/team', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, email, role }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body?.error ?? 'Failed');
        setBusy(false);
        return;
      }
      onClose();
    } catch {
      setError('Failed to add member');
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalLayer
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      labelledBy="add-member-title"
      describedBy="add-member-desc"
      initialFocusRef={emailRef}
      onClose={onClose}
    >
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <form
        id="add-member-form"
        onSubmit={submit}
        aria-labelledby="add-member-title"
        aria-describedby="add-member-desc"
        className="relative z-10 w-[480px] rounded bg-slate-900 p-4"
      >
        <h2 id="add-member-title" className="mb-2 text-lg font-medium">
          Add Member
        </h2>
        <p id="add-member-desc" className="sr-only">
          Add a member to the company with role and email.
        </p>
        {error ? <div className="mb-2 text-rose-400">{error}</div> : null}
        <label className="mb-2 block">
          Display name
          <input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            className="w-full rounded bg-slate-800/40 px-2 py-1"
          />
        </label>
        <label className="mb-2 block">
          Email
          <input
            ref={emailRef}
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded bg-slate-800/40 px-2 py-1"
          />
        </label>
        <label className="mb-2 block">
          Role
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as Member['role'])}
            className="w-full rounded bg-slate-800/40 px-2 py-1"
          >
            {roles.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancel
          </button>
          <button type="submit" disabled={busy} className="btn btn-primary">
            Add
          </button>
        </div>
      </form>
    </ModalLayer>
  );
}
