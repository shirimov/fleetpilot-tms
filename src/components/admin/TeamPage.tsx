"use client";

import React, { useEffect, useRef, useState } from 'react';
import ModalLayer from '@/components/ui/ModalLayer';

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
  };
  openTasks: number;
  overdueTasks: number;
  dueToday: number;
  telegram: {
    connected: boolean;
    username: string | null;
  };
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
              <th className="p-2">Open</th>
              <th className="p-2">Overdue</th>
              <th className="p-2">Due Today</th>
              <th className="p-2">Telegram</th>
              <th className="p-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((member) => (
              <tr key={member.id} className="border-t border-white/6">
                <td className="p-2 align-middle">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-700 text-sm">
                      {member.user.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- user-provided remote avatars are not configured for next/image
                        <img src={member.user.image} alt="" className="h-8 w-8 rounded-full" />
                      ) : (
                        (member.user.displayName || member.user.email)
                          .slice(0, 2)
                          .toUpperCase()
                      )}
                    </div>
                    <div className="font-medium">{member.user.displayName}</div>
                  </div>
                </td>
                <td className="p-2">{member.user.email}</td>
                <td className="p-2">{member.role}</td>
                <td className="p-2">{member.user.isActive ? 'Active' : 'Inactive'}</td>
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
                  <div className="flex flex-wrap gap-2">
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
    </div>
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
