"use client";
import React, { useEffect, useState, useRef } from 'react';
import ModalLayer from '@/components/ui/ModalLayer';

type MemberRole = 'OWNER' | 'ADMIN' | 'MEMBER';

type Member = {
  id: string;
  role: MemberRole;
  user: { id: string; displayName: string; email: string; image?: string | null; isActive: boolean };
  openTasks: number;
  overdueTasks: number;
  dueToday: number;
  telegramStatus: string;
};

function canManageMember(actorRole: MemberRole, targetRole: MemberRole) {
  return actorRole === 'OWNER' || (actorRole === 'ADMIN' && targetRole !== 'OWNER');
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

  async function load() {
    setLoading(true);
    setError(null);
    try {
      // Compute local day boundaries in browser timezone and pass to server so "Due Today" matches the user.
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
    } catch {
      setError('Failed to load team.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = members.filter((m) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      m.user.displayName.toLowerCase().includes(q) ||
      m.user.email.toLowerCase().includes(q)
    );
  });

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Team</h1>
        <div className="flex items-center gap-2">
          <input placeholder="Search name or email" value={query} onChange={(e) => setQuery(e.target.value)} className="px-2 py-1 rounded border bg-slate-900/20" />
          {currentUserRole !== 'MEMBER' ? (
            <button onClick={() => setShowAdd(true)} className="btn btn-primary">Add Member</button>
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
              <th className="p-2">Open</th>
              <th className="p-2">Overdue</th>
              <th className="p-2">Due Today</th>
              <th className="p-2">Telegram</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((m) => (
              <tr key={m.id} className="border-t border-white/6">
                <td className="p-2 align-middle">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-full bg-slate-700 flex items-center justify-center text-sm">
                      {m.user.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- remote avatar sources are user-provided and not configured for next/image
                        <img src={m.user.image} alt="" className="w-8 h-8 rounded-full" />
                      ) : (m.user.displayName || m.user.email).slice(0,2).toUpperCase()}
                    </div>
                    <div>
                      <div className="font-medium">{m.user.displayName}</div>
                    </div>
                  </div>
                </td>
                <td className="p-2">{m.user.email}</td>
                <td className="p-2">{m.role}</td>
                <td className="p-2">{m.user.isActive ? 'Active' : 'Inactive'}</td>
                <td className="p-2">{m.openTasks}</td>
                <td className="p-2">{m.overdueTasks}</td>
                <td className="p-2">{m.dueToday}</td>
                <td className="p-2">{m.telegramStatus}</td>
                <td className="p-2">
                  <div className="flex gap-2">
                    {canManageMember(currentUserRole, m.role) ? (
                      <RoleControl member={m} actorRole={currentUserRole} reload={load} />
                    ) : null}
                    {canManageMember(currentUserRole, m.role) ? (
                      <RemoveControl member={m} reload={load} />
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showAdd ? <AddMemberModal actorRole={currentUserRole} onClose={() => { setShowAdd(false); void load(); }} /> : null}
    </div>
  );
}

function RoleControl({ member, actorRole, reload }: { member: Member; actorRole: MemberRole; reload: () => void }) {
  const [changing, setChanging] = useState(false);
  const [role, setRole] = useState(member.role);
  const roles = assignableRoles(actorRole);

  async function save() {
    if (role === member.role) return;
    setChanging(true);
    try {
      const resp = await fetch('/api/company/team', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: member.user.id, role }) });
      if (!resp.ok) throw new Error('failed');
      await reload();
    } catch {
      // TODO show error
    } finally {
      setChanging(false);
    }
  }

  return (
    <div className="flex items-center gap-1">
      <select value={role} onChange={(e) => setRole(e.target.value as Member['role'])} className="px-2 py-1 rounded bg-slate-900/10">
        {roles.map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
      <button disabled={changing || role === member.role} onClick={save} className="btn btn-sm">Save</button>
    </div>
  );
}

function RemoveControl({ member, reload }: { member: Member; reload: () => void }) {
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (!confirm) { setConfirm(true); return; }
    setBusy(true);
    try {
      const resp = await fetch('/api/company/team', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: member.user.id }) });
      if (!resp.ok) throw new Error('failed');
      await reload();
    } catch {
      // TODO handle error
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <button onClick={remove} disabled={busy} className="btn btn-ghost btn-sm text-rose-400">{confirm ? 'Confirm' : 'Remove'}</button>
  );
}

function AddMemberModal({ actorRole, onClose }: { actorRole: MemberRole; onClose: () => void }) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
 const [role, setRole] = useState<MemberRole>('MEMBER');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement | null>(null);
 const roles = assignableRoles(actorRole);

  async function submit(e?: React.FormEvent) {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const resp = await fetch('/api/company/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName, email, role }) });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
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
      {/* Backdrop */}
      <button
        type="button"
        aria-hidden="true"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-black/50"
      />
      <form id="add-member-form" onSubmit={submit} aria-labelledby="add-member-title" aria-describedby="add-member-desc" className="relative bg-slate-900 p-4 rounded w-[480px] z-10">
        <h2 id="add-member-title" className="text-lg font-medium mb-2">Add Member</h2>
        <p id="add-member-desc" className="sr-only">Add a member to the company with role and email.</p>
        {error ? <div className="text-rose-400 mb-2">{error}</div> : null}
        <label className="block mb-2">Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} className="w-full px-2 py-1 rounded bg-slate-800/40" />
        </label>
        <label className="block mb-2">Email
          <input ref={emailRef} required value={email} onChange={(e) => setEmail(e.target.value)} className="w-full px-2 py-1 rounded bg-slate-800/40" />
        </label>
        <label className="block mb-2">Role
          <select value={role} onChange={(e) => setRole(e.target.value as Member['role'])} className="w-full px-2 py-1 rounded bg-slate-800/40">
            {roles.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2 mt-4">
          <button type="button" onClick={onClose} className="btn btn-ghost">Cancel</button>
          <button type="submit" disabled={busy} className="btn btn-primary">Add</button>
        </div>
      </form>
    </ModalLayer>
  );
}
