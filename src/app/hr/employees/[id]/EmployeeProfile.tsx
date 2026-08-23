'use client';

import { useEffect, useState } from 'react';

/* eslint-disable @next/next/no-img-element -- authenticated private image routes are not compatible with the public image optimizer */

type Payload = {
  profile: {
    id: string; firstName: string; lastName: string; preferredName: string | null;
    jobTitle: string | null; department: string | null; employmentStatus: string;
    workLocation: string | null; timezone: string; email: string | null; phone: string | null;
    startDate: string | null; photoUrl: string | null; user: { isActive: boolean } | null;
    telegram: { connected: boolean; username: string | null };
    manager: { firstName: string; lastName: string } | null;
    scheduleDays: Array<{ weekday: number; isWorking: boolean; startMinute: number | null; endMinute: number | null; breakMinutes: number; capacityMinutes: number }>;
    skills: Array<{ skill: { id: string; name: string; isActive: boolean } }>;
    salary?: number | null; currency?: string; payType?: string; payFrequency?: string;
  };
  capacity: { expectedTaskCapacityMinutes: number; assignedRemainingExpectedMinutes: number; freeCapacityMinutes: number; utilizationPercentage: number; dueTodayCount: number; overdueCount: number; taskCount: { complete: number; total: number }; weightedCompletion: { percentage: number } };
};

const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const minutes = (value: number | null) => value === null ? '—' : `${String(Math.floor(value / 60)).padStart(2, '0')}:${String(value % 60).padStart(2, '0')}`;

export default function EmployeeProfile({ employeeId }: { employeeId: string }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [scheduleDays, setScheduleDays] = useState<Payload['profile']['scheduleDays']>([]);
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { fetch(`/api/workforce/employees/${employeeId}`, { cache: 'no-store' }).then(async (response) => { if (!response.ok) throw new Error(response.status === 403 ? 'Access denied.' : 'Profile could not be loaded.'); return response.json() as Promise<Payload>; }).then((loaded) => { setPayload(loaded); setScheduleDays(weekdays.map((_, weekday) => loaded.profile.scheduleDays.find((day) => day.weekday === weekday) ?? { weekday, isWorking: false, startMinute: null, endMinute: null, breakMinutes: 0, capacityMinutes: 0 })); }).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Profile could not be loaded.')); }, [employeeId]);
  function updateSchedule(weekday: number, changes: Partial<Payload['profile']['scheduleDays'][number]>) { setScheduleDays((current) => current.map((day) => day.weekday === weekday ? { ...day, ...changes } : day)); }
  async function saveSchedule() { setSavingSchedule(true); setError(''); try { const response = await fetch(`/api/workforce/employees/${employeeId}/schedule`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: scheduleDays }) }); if (!response.ok) throw new Error('Schedule could not be saved.'); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Schedule could not be saved.'); } finally { setSavingSchedule(false); } }
  if (error) return <main className="min-h-screen bg-[#0e1017] p-6 text-white"><div role="alert" className="rounded-xl border border-rose-400/30 bg-rose-400/10 p-5">{error}</div></main>;
  if (!payload) return <main aria-label="Loading employee profile" className="min-h-screen animate-pulse bg-[#0e1017] p-6"><div className="h-48 rounded-2xl bg-white/5" /></main>;
  const { profile, capacity } = payload;
  const name = profile.preferredName || `${profile.firstName} ${profile.lastName}`.trim();
  const initials = `${profile.firstName[0] ?? ''}${profile.lastName[0] ?? ''}`.toUpperCase();
  return <main className="min-h-screen bg-[#0e1017] p-4 text-white sm:p-8">
    <header className="rounded-2xl border border-white/10 bg-gradient-to-br from-[#202638] to-[#151822] p-5 sm:flex sm:items-center sm:gap-5">
      {profile.photoUrl ? <img src={profile.photoUrl} alt={`${name} profile`} className="h-24 w-24 rounded-2xl object-cover" /> : <div aria-label="Initials avatar" className="grid h-24 w-24 place-items-center rounded-2xl bg-blue-500/20 text-3xl font-bold text-blue-200">{initials}</div>}
      <div className="mt-4 min-w-0 sm:mt-0"><p className="text-xs uppercase tracking-[.2em] text-blue-300">Employee profile</p><h1 className="truncate text-3xl font-semibold">{name}</h1><p className="mt-1 text-slate-300">{profile.jobTitle || 'Team member'}{profile.department ? ` · ${profile.department}` : ''}</p><div className="mt-3 flex flex-wrap gap-2 text-xs"><span className="rounded-full bg-emerald-400/10 px-2 py-1 text-emerald-200">{profile.employmentStatus}</span><span className="rounded-full bg-white/5 px-2 py-1 text-slate-300">{profile.timezone}</span><span className="rounded-full bg-white/5 px-2 py-1 text-slate-300">FleetPilot {profile.user?.isActive ? 'active' : 'not linked'}</span><span className="rounded-full bg-white/5 px-2 py-1 text-slate-300">Telegram {profile.telegram.connected ? 'connected' : 'not connected'}</span></div></div>
    </header>
    <section aria-label="Workload summary" className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
      ['Current workload', `${capacity.assignedRemainingExpectedMinutes}m`], ['Free capacity', `${capacity.freeCapacityMinutes}m`], ['Utilization', `${capacity.utilizationPercentage}%`], ['Weighted progress', `${capacity.weightedCompletion.percentage}%`], ['Tasks', `${capacity.taskCount.complete} / ${capacity.taskCount.total} complete`], ['Due today', String(capacity.dueTodayCount)], ['Overdue', String(capacity.overdueCount)], ['Daily capacity', `${capacity.expectedTaskCapacityMinutes}m`],
    ].map(([label, value]) => <div key={label} className="rounded-xl border border-white/8 bg-[#171a24] p-4"><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-xl font-semibold">{value}</p></div>)}</section>
    <div className="mt-5 grid gap-5 lg:grid-cols-2">
      <section className="rounded-xl border border-white/8 bg-[#171a24] p-5"><h2 className="font-semibold">Overview</h2><dl className="mt-4 grid grid-cols-2 gap-4 text-sm"><div><dt className="text-slate-500">Email</dt><dd>{profile.email || '—'}</dd></div><div><dt className="text-slate-500">Phone</dt><dd>{profile.phone || '—'}</dd></div><div><dt className="text-slate-500">Location</dt><dd>{profile.workLocation || '—'}</dd></div><div><dt className="text-slate-500">Manager</dt><dd>{profile.manager ? `${profile.manager.firstName} ${profile.manager.lastName}` : '—'}</dd></div></dl></section>
      <section className="rounded-xl border border-white/8 bg-[#171a24] p-5"><h2 className="font-semibold">Skills</h2><div className="mt-4 flex flex-wrap gap-2">{profile.skills.length ? profile.skills.map(({ skill }) => <span key={skill.id} className={`rounded-full px-3 py-1 text-sm ${skill.isActive ? 'bg-violet-400/10 text-violet-200' : 'bg-white/5 text-slate-500'}`}>{skill.name}</span>) : <p className="text-sm text-slate-500">No skills added.</p>}</div></section>
      <section className="rounded-xl border border-white/8 bg-[#171a24] p-5 lg:col-span-2"><div className="flex items-center justify-between"><h2 className="font-semibold">Schedule</h2><button type="button" onClick={() => void saveSchedule()} disabled={savingSchedule} className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-semibold disabled:opacity-50">{savingSchedule ? 'Saving…' : 'Save schedule'}</button></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{scheduleDays.map((schedule) => <div key={schedule.weekday} className="rounded-lg bg-white/[.03] p-3 text-sm"><label className="flex items-center gap-2 font-medium"><input type="checkbox" checked={schedule.isWorking} onChange={(event) => updateSchedule(schedule.weekday, { isWorking: event.target.checked, startMinute: event.target.checked ? schedule.startMinute ?? 480 : null, endMinute: event.target.checked ? schedule.endMinute ?? 1020 : null })} />{weekdays[schedule.weekday]}</label>{schedule.isWorking ? <div className="mt-2 grid grid-cols-2 gap-2"><label className="text-xs text-slate-500">Start<input aria-label={`${weekdays[schedule.weekday]} start`} type="time" value={minutes(schedule.startMinute)} onChange={(event) => { const [hour, minute] = event.target.value.split(':').map(Number); updateSchedule(schedule.weekday, { startMinute: hour * 60 + minute }); }} className="mt-1 w-full rounded bg-[#10121a] p-1 text-slate-200" /></label><label className="text-xs text-slate-500">End<input aria-label={`${weekdays[schedule.weekday]} end`} type="time" value={minutes(schedule.endMinute)} onChange={(event) => { const [hour, minute] = event.target.value.split(':').map(Number); updateSchedule(schedule.weekday, { endMinute: hour * 60 + minute }); }} className="mt-1 w-full rounded bg-[#10121a] p-1 text-slate-200" /></label><label className="text-xs text-slate-500">Break (m)<input aria-label={`${weekdays[schedule.weekday]} break minutes`} type="number" min="0" max="1440" value={schedule.breakMinutes} onChange={(event) => updateSchedule(schedule.weekday, { breakMinutes: Number(event.target.value) })} className="mt-1 w-full rounded bg-[#10121a] p-1 text-slate-200" /></label><label className="text-xs text-slate-500">Capacity (m)<input aria-label={`${weekdays[schedule.weekday]} capacity minutes`} type="number" min="0" max="1440" value={schedule.capacityMinutes} onChange={(event) => updateSchedule(schedule.weekday, { capacityMinutes: Number(event.target.value) })} className="mt-1 w-full rounded bg-[#10121a] p-1 text-slate-200" /></label></div> : <p className="mt-2 text-slate-500">Not working</p>}</div>)}</div></section>
      {'salary' in profile && <section className="rounded-xl border border-white/8 bg-[#171a24] p-5"><h2 className="font-semibold">Compensation</h2><p className="mt-3 text-2xl font-semibold">{profile.salary == null ? 'Not set' : `${profile.salary.toLocaleString()} ${profile.currency}`}</p><p className="text-sm text-slate-500">{profile.payType} · {profile.payFrequency}</p></section>}
      <section className="rounded-xl border border-white/8 bg-[#171a24] p-5"><h2 className="font-semibold">Performance</h2><p className="mt-3 text-sm leading-6 text-slate-400">Performance analytics will appear after enough task and schedule data is collected.</p></section>
    </div>
  </main>;
}
