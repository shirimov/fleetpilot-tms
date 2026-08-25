'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ModalLayer from '@/components/ui/ModalLayer';
import type { KanbanCard, KanbanCardFieldUpdate, KanbanColumn } from '@/lib/tasks/kanban-types';
import type { TaskArchivePolicy, TaskAssignee, TaskDeletePolicy } from '@/lib/tasks/task-types';
import type { TaskStatus } from '@prisma/client';
import MarkdownContent from './MarkdownContent';
import TaskAttachments from './TaskAttachments';
import TaskDescriptionEditor, {
  extractMentionUserIds,
} from './TaskDescriptionEditor';
import TaskDeadline from './TaskDeadline';
import { TaskAssigneeSelect, TaskDueDateInput, TaskDurationInput, TaskEffortSelect, TaskPrioritySelect, TaskStatusSelect } from './TaskFields';

type ChecklistItem = {
  id: string;
  content: string;
  isCompleted: boolean;
  order: number;
};

type Comment = {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  authorUser: { displayName: string; image: string | null } | null;
};

type Activity = {
  id: string;
  action: string;
  actorType: string;
  actorId: string | null;
  actorUser: { displayName: string; image: string | null } | null;
  metadata: unknown;
  occurredAt: string;
};

type TelegramSummary = {
  telegramAvailable: boolean;
  assigneeTelegramConnected: boolean;
  assigneeTelegramUsername: string | null;
  canRequestUpdate: boolean;
  latestRequest: {
    id: string;
    status: string;
    createdAt: string;
    respondedAt: string | null;
  } | null;
} | null;

type Props = {
  card: KanbanCard;
  board: KanbanColumn;
  onClose: () => void;
  assignees: TaskAssignee[];
  statuses: Array<{ value: TaskStatus; label: string }>;
  now: number | null;
  updating: boolean;
  onUpdateCard: (cardId: string, changes: KanbanCardFieldUpdate) => Promise<void>;
  onStatusChange: (cardId: string, status: TaskStatus) => Promise<void>;
  onDescriptionSaved: (cardId: string, description: string, updatedAt: string) => void;
  onDeleted: (cardId: string) => void;
  onArchived: (cardId: string) => void;
};

const actionLabels: Record<string, string> = {
  TASK_CREATED: 'created the task',
  TITLE_CHANGED: 'changed the title',
  DESCRIPTION_CHANGED: 'changed the description',
  STATUS_CHANGED: 'changed the status',
  BOARD_CHANGED: 'moved the task',
  PRIORITY_CHANGED: 'changed the priority',
  ASSIGNEE_CHANGED: 'changed the assignee',
  DUE_DATE_CHANGED: 'changed the due date',
  ORDER_CHANGED: 'reordered the task',
  CHECKLIST_ITEM_CREATED: 'added a checklist item',
  CHECKLIST_ITEM_UPDATED: 'edited a checklist item',
  CHECKLIST_ITEM_COMPLETED: 'completed a checklist item',
  CHECKLIST_ITEM_REOPENED: 'reopened a checklist item',
  CHECKLIST_ITEM_REORDERED: 'reordered the checklist',
  CHECKLIST_ITEM_DELETED: 'deleted a checklist item',
  COMMENT_ADDED: 'added a comment',
  COMMENT_EDITED: 'edited a comment',
  COMMENT_DELETED: 'deleted a comment',
  ATTACHMENT_ADDED: 'added an attachment',
  ATTACHMENT_REMOVED: 'removed an attachment',
  MENTION_ADDED: 'mentioned a teammate',
  MENTION_RESOLVED: 'resolved a mention',
  TASK_DELETED: 'deleted the task',
  TASK_ARCHIVED: 'archived the task',
  TASK_UNARCHIVED: 'restored the task',
};

async function responseJson<ResponseBody>(response: Response): Promise<ResponseBody> {
  const body = (await response.json()) as ResponseBody & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'The request could not be completed.');
  return body;
}

function activityDetails(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const values = metadata as Record<string, unknown>;
  if ('from' in values || 'to' in values) {
    return `${String(values.from ?? 'None')} → ${String(values.to ?? 'None')}`;
  }
  return typeof values.content === 'string' ? values.content : null;
}

export default function TaskDetailDrawer({ card, board, onClose, assignees, statuses, now, updating, onUpdateCard, onStatusChange, onDescriptionSaved, onDeleted, onArchived }: Props) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [comments, setComments] = useState<Comment[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [newItem, setNewItem] = useState('');
  const [newComment, setNewComment] = useState('');
  const [editingItem, setEditingItem] = useState<string | null>(null);
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [commentMentionCandidates, setCommentMentionCandidates] = useState<
    Array<{ id: string; displayName: string }>
  >([]);
  const [telegramSummary, setTelegramSummary] = useState<TelegramSummary>(null);
  const [deletePolicy, setDeletePolicy] = useState<TaskDeletePolicy | null>(null);
  const [archivePolicy, setArchivePolicy] = useState<TaskArchivePolicy | null>(null);

  const loadCollaboration = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [checklistResponse, commentsResponse, activityResponse, telegramResponse, deletePolicyResponse, archivePolicyResponse] =
        await Promise.all([
          fetch(`/api/tasks/cards/${card.id}/checklist`),
          fetch(`/api/tasks/cards/${card.id}/comments`),
          fetch(`/api/tasks/cards/${card.id}/activity`),
          fetch(`/api/tasks/cards/${card.id}/telegram`),
          fetch(`/api/tasks/cards/${card.id}/delete-policy`),
          fetch(`/api/tasks/cards/${card.id}/archive-policy`),
        ]);
      const [items, thread, timeline, telegram, policy, archive] = await Promise.all([
        responseJson<ChecklistItem[]>(checklistResponse),
        responseJson<Comment[]>(commentsResponse),
        responseJson<Activity[]>(activityResponse),
        responseJson<TelegramSummary>(telegramResponse),
        responseJson<TaskDeletePolicy>(deletePolicyResponse),
        responseJson<TaskArchivePolicy>(archivePolicyResponse),
      ]);
      setChecklist(items);
      setComments(thread);
      setActivities(timeline);
      setTelegramSummary(telegram);
      setDeletePolicy(policy);
      setArchivePolicy(archive);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Task collaboration details could not be loaded.',
      );
    } finally {
      setLoading(false);
    }
  }, [card.id]);

  const refreshActivity = useCallback(async () => {
    const [activityResponse, deletePolicyResponse] = await Promise.all([
      fetch(`/api/tasks/cards/${card.id}/activity`),
      fetch(`/api/tasks/cards/${card.id}/delete-policy`),
    ]);
    setActivities(await responseJson<Activity[]>(activityResponse));
    setDeletePolicy(await responseJson<TaskDeletePolicy>(deletePolicyResponse));
  }, [card.id]);

  useEffect(() => {
    void loadCollaboration();
  }, [loadCollaboration]);

  useEffect(() => {
    const query = newComment.match(/(?:^|\s)@([\w .-]{0,40})$/)?.[1];
    if (query === undefined) {
      setCommentMentionCandidates([]);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/tasks/mentions?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : [])
      .then((users: Array<{ id: string; displayName: string }>) =>
        setCommentMentionCandidates(users),
      )
      .catch(() => {});
    return () => controller.abort();
  }, [newComment]);

  const completedCount = useMemo(
    () => checklist.filter(({ isCompleted }) => isCompleted).length,
    [checklist],
  );
  const selectedAssignee = useMemo(
    () =>
      assignees.find((assignee) => assignee.id === (card.assigneeUserId ?? '')) ?? null,
    [assignees, card.assigneeUserId],
  );

  async function updateOverview(changes: KanbanCardFieldUpdate) {
    await onUpdateCard(card.id, changes);
    await refreshActivity();
  }

  async function mutate(action: () => Promise<void>) {
    setPending(true);
    setError(null);
    try {
      await action();
      await refreshActivity();
    } catch (mutationError) {
      setError(
        mutationError instanceof Error
          ? mutationError.message
          : 'The change could not be saved.',
      );
      throw mutationError;
    } finally {
      setPending(false);
    }
  }

  async function requestTelegramUpdate() {
    if (pending) return;
    await mutate(async () => {
      const response = await fetch(`/api/tasks/cards/${card.id}/telegram`, {
        method: 'POST',
      });
      await responseJson<{ success: true }>(response);
      const refreshed = await fetch(`/api/tasks/cards/${card.id}/telegram`);
      setTelegramSummary(await responseJson<TelegramSummary>(refreshed));
    });
  }

  async function addChecklistItem() {
    const content = newItem.trim();
    if (!content || pending) return;
    await mutate(async () => {
      const response = await fetch(`/api/tasks/cards/${card.id}/checklist`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const created = await responseJson<ChecklistItem>(response);
      setChecklist((current) => [...current, created]);
      setNewItem('');
    });
  }

  async function toggleChecklistItem(item: ChecklistItem) {
    if (pending) return;
    const snapshot = checklist;
    setChecklist((current) =>
      current.map((candidate) =>
        candidate.id === item.id
          ? { ...candidate, isCompleted: !candidate.isCompleted }
          : candidate,
      ),
    );
    try {
      await mutate(async () => {
        const response = await fetch(
          `/api/tasks/cards/${card.id}/checklist/${item.id}`,
          {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isCompleted: !item.isCompleted }),
          },
        );
        const saved = await responseJson<ChecklistItem>(response);
        setChecklist((current) =>
          current.map((candidate) => (candidate.id === saved.id ? saved : candidate)),
        );
      });
    } catch {
      setChecklist(snapshot);
    }
  }

  async function saveChecklistItem(item: ChecklistItem) {
    const content = editValue.trim();
    if (!content || pending) return;
    await mutate(async () => {
      const response = await fetch(
        `/api/tasks/cards/${card.id}/checklist/${item.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content }),
        },
      );
      const saved = await responseJson<ChecklistItem>(response);
      setChecklist((current) =>
        current.map((candidate) => (candidate.id === saved.id ? saved : candidate)),
      );
      setEditingItem(null);
    });
  }

  async function deleteChecklistItem(item: ChecklistItem) {
    if (pending) return;
    await mutate(async () => {
      const response = await fetch(
        `/api/tasks/cards/${card.id}/checklist/${item.id}`,
        { method: 'DELETE' },
      );
      await responseJson<{ success: true }>(response);
      setChecklist((current) =>
        current
          .filter(({ id }) => id !== item.id)
          .map((candidate, order) => ({ ...candidate, order })),
      );
      if (editingItem === item.id) {
        setEditingItem(null);
      }
    });
  }

  async function moveChecklistItem(index: number, offset: number) {
    const destination = index + offset;
    if (destination < 0 || destination >= checklist.length || pending) return;
    const snapshot = checklist;
    const reordered = [...checklist];
    const [item] = reordered.splice(index, 1);
    reordered.splice(destination, 0, item);
    setChecklist(reordered.map((candidate, order) => ({ ...candidate, order })));
    try {
      await mutate(async () => {
        const response = await fetch(`/api/tasks/cards/${card.id}/checklist`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ itemIds: reordered.map(({ id }) => id) }),
        });
        setChecklist(await responseJson<ChecklistItem[]>(response));
      });
    } catch {
      setChecklist(snapshot);
    }
  }

  async function addComment() {
    const content = newComment.trim();
    if (!content || pending) return;
    await mutate(async () => {
      const response = await fetch(`/api/tasks/cards/${card.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          mentionUserIds: extractMentionUserIds(content),
        }),
      });
      const comment = await responseJson<Comment>(response);
      setComments((current) => [...current, { ...comment, canEdit: true }]);
      setNewComment('');
    });
  }

  async function saveComment(comment: Comment) {
    const content = editValue.trim();
    if (!content || pending) return;
    await mutate(async () => {
      const response = await fetch(
        `/api/tasks/cards/${card.id}/comments/${comment.id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content,
            mentionUserIds: extractMentionUserIds(content),
          }),
        },
      );
      const saved = await responseJson<Comment>(response);
      setComments((current) =>
        current.map((candidate) =>
          candidate.id === saved.id ? { ...saved, canEdit: true } : candidate,
        ),
      );
      setEditingComment(null);
    });
  }

  async function deleteComment(comment: Comment) {
    if (pending) return;
    await mutate(async () => {
      const response = await fetch(
        `/api/tasks/cards/${card.id}/comments/${comment.id}`,
        { method: 'DELETE' },
      );
      await responseJson<{ success: true }>(response);
      setComments((current) => current.filter(({ id }) => id !== comment.id));
      if (editingComment === comment.id) {
        setEditingComment(null);
      }
    });
  }

  async function permanentlyDeleteTask() {
    if (pending || !deletePolicy?.canPermanentlyDelete || deletePolicy.isProtected) return;
    if (!window.confirm('Permanently delete this task? This action cannot be undone.')) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/cards?id=${encodeURIComponent(card.id)}`, {
        method: 'DELETE',
      });
      await responseJson<{ success: true }>(response);
      onDeleted(card.id);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'The task could not be permanently deleted.');
      const policyResponse = await fetch(`/api/tasks/cards/${card.id}/delete-policy`);
      if (policyResponse.ok) setDeletePolicy(await responseJson<TaskDeletePolicy>(policyResponse));
    } finally {
      setPending(false);
    }
  }

  async function changeArchiveState(archived: boolean) {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/cards/${card.id}/archive`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
      await responseJson<{ ok: true }>(response);
      onArchived(card.id);
    } catch (archiveError) {
      setError(archiveError instanceof Error ? archiveError.message : 'The task lifecycle could not be changed.');
    } finally {
      setPending(false);
    }
  }

  return (
    <ModalLayer
      className="fixed inset-0 z-50 flex justify-end"
      labelledBy="task-drawer-title"
      describedBy="task-drawer-description"
      initialFocusRef={closeButtonRef}
      onClose={onClose}
      canCloseOnEscape={() =>
        !document.querySelector('[data-task-inline-editor="true"]')
      }
    >
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close task details"
        onClick={onClose}
        className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
      />
      <aside
        className="relative h-full w-full max-w-2xl overflow-y-auto border-l border-white/10 bg-[#12141c] shadow-2xl"
      >
        <header className="sticky top-0 z-10 flex items-start gap-4 border-b border-white/8 bg-[#12141c]/95 px-5 py-5 backdrop-blur">
          <div className="min-w-0 flex-1">
            <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-blue-300">
              {board.name}
            </p>
            <h2 id="task-drawer-title" className="text-xl font-semibold text-white">
              {card.title}
            </h2>
            <p id="task-drawer-description" className="sr-only">
              Task details, collaboration, attachments, and activity.
            </p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-xl text-slate-400 hover:bg-white/5 hover:text-white">×</button>
        </header>

        <div className="space-y-7 p-5">
          {error && (
            <div role="alert" className="rounded-lg bg-rose-400/10 p-3 text-sm text-rose-200">
              {error}
              {loading === false && (
                <button type="button" onClick={() => void loadCollaboration()} className="ml-2 underline">Retry</button>
              )}
            </div>
          )}

          <section aria-labelledby="overview-heading">
            <h3 id="overview-heading" className="mb-3 text-sm font-semibold text-white">Overview</h3>
            <div className="grid gap-3 rounded-xl border border-white/8 bg-[#181b25] p-4 text-sm sm:grid-cols-2">
              <label className="text-xs text-slate-500">Status<span className="mt-1 block"><TaskStatusSelect label="Task status" value={card.status} statuses={statuses} disabled={updating} onChange={(status) => void onStatusChange(card.id, status).then(refreshActivity)} /></span></label>
              <label className="text-xs text-slate-500">Priority<span className="mt-1 block"><TaskPrioritySelect label="Task priority" value={card.priority} disabled={updating} onChange={(priority) => void updateOverview({ priority })} /></span></label>
              <label className="text-xs text-slate-500">Assignee<span className="mt-1 block"><TaskAssigneeSelect label="Task assignee" value={card.assigneeUserId ?? ''} legacyName={card.assignedTo} assignees={assignees} disabled={updating} onChange={(assigneeUserId) => void updateOverview({ assigneeUserId })} /></span></label>
              <label className="text-xs text-slate-500">Due date and time<span className="mt-1 block"><TaskDueDateInput label="Task due date and time" value={card.dueDate} disabled={updating} onChange={(dueDate) => void updateOverview({ dueDate })} /></span></label>
              <label className="text-xs text-slate-500">Effort<span className="mt-1 block"><TaskEffortSelect label="Task effort" value={card.effort ?? 3} disabled={updating} onChange={(effort) => void updateOverview({ effort })} /></span></label>
              <label className="text-xs text-slate-500">Expected duration<span className="mt-1 block"><TaskDurationInput label="Expected duration" value={card.expectedDurationMinutes ?? null} disabled={updating} onChange={(expectedDurationMinutes) => void updateOverview({ expectedDurationMinutes })} /></span></label>
              <label className="text-xs text-slate-500 sm:col-span-2">Blocked / waiting reason<select aria-label="Blocked or waiting reason" value={card.blockedReason ?? ''} disabled={updating} onChange={(event) => void updateOverview({ blockedReason: (event.target.value || null) as typeof card.blockedReason })} className="mt-1 h-8 w-full rounded-md border border-white/10 bg-[#11151f] px-2 text-xs text-slate-200"><option value="">Not blocked</option><option value="WAITING_ON_CUSTOMER">Waiting on Customer</option><option value="WAITING_ON_DRIVER">Waiting on Driver</option><option value="WAITING_ON_VENDOR">Waiting on Vendor</option><option value="WAITING_ON_MANAGER">Waiting on Manager</option><option value="WAITING_ON_GOVERNMENT_DMV">Waiting on Government/DMV</option><option value="WAITING_ON_AMAZON">Waiting on Amazon</option><option value="WAITING_ON_INSURANCE">Waiting on Insurance</option><option value="TECHNICAL_ISSUE">Technical Issue</option><option value="OTHER">Other</option></select></label>
              <div className="sm:col-span-2 flex items-center justify-between border-t border-white/8 pt-3"><span className="text-xs text-slate-500">Countdown</span><TaskDeadline dueDate={card.dueDate} now={now} status={card.status} /></div>
            </div>
          </section>

          <section aria-labelledby="telegram-heading">
            <h3 id="telegram-heading" className="mb-3 text-sm font-semibold text-white">Telegram</h3>
            <div className="rounded-xl border border-white/8 bg-[#181b25] p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-slate-200">
                    {!telegramSummary?.telegramAvailable
                      ? 'Unavailable'
                      : telegramSummary.assigneeTelegramConnected
                        ? 'Connected'
                        : 'Not connected'}
                    {telegramSummary?.telegramAvailable && telegramSummary.assigneeTelegramUsername
                      ? ` @${telegramSummary.assigneeTelegramUsername}`
                      : ''}
                  </p>
                  <p className="text-xs text-slate-400">
                    {!telegramSummary?.telegramAvailable
                      ? 'Telegram collaboration is disabled.'
                      : selectedAssignee
                      ? `${selectedAssignee.displayName} ${
                          telegramSummary?.assigneeTelegramConnected
                            ? 'can receive Telegram collaboration messages.'
                            : 'has not linked Telegram.'
                        }`
                      : 'Assign this task to enable Telegram collaboration.'}
                  </p>
                </div>
                {telegramSummary?.canRequestUpdate ? (
                  <button
                    type="button"
                    onClick={() => void requestTelegramUpdate()}
                    disabled={pending}
                    className="btn btn-sm"
                  >
                    Request update
                  </button>
                ) : null}
              </div>
              {telegramSummary?.latestRequest ? (
                <div className="mt-3 text-xs text-slate-400">
                  <div>Update request: {telegramSummary.latestRequest.status.toLowerCase()}</div>
                  <div>Requested {new Date(telegramSummary.latestRequest.createdAt).toLocaleString()}</div>
                  {telegramSummary.latestRequest.respondedAt ? (
                    <div>Responded {new Date(telegramSummary.latestRequest.respondedAt).toLocaleString()}</div>
                  ) : null}
                </div>
              ) : null}
            </div>
          </section>

          <TaskDescriptionEditor
            cardId={card.id}
            initialMarkdown={card.description ?? ''}
            initialUpdatedAt={card.updatedAt}
            onSaved={(description, updatedAt) => {
              onDescriptionSaved(card.id, description, updatedAt);
              void refreshActivity();
            }}
          />

          <section aria-labelledby="checklist-heading">
            <div className="mb-3 flex items-center justify-between">
              <h3 id="checklist-heading" className="text-sm font-semibold text-white">Checklist</h3>
              <span className="text-xs text-slate-400">{completedCount}/{checklist.length} complete</span>
            </div>
            <div className="mb-4 h-1.5 overflow-hidden rounded-full bg-white/8">
              <div className="h-full bg-emerald-400 transition-all" style={{ width: checklist.length ? `${(completedCount / checklist.length) * 100}%` : '0%' }} />
            </div>
            {loading ? <div className="h-20 animate-pulse rounded-xl bg-white/5" /> : checklist.length === 0 ? <p className="mb-3 text-sm text-slate-500">No checklist items yet.</p> : (
              <ul className="space-y-2">
                {checklist.map((item, index) => (
                  <li key={item.id} className="flex items-center gap-2 rounded-lg border border-white/8 bg-[#181b25] p-2">
                    <input aria-label={`Complete ${item.content}`} type="checkbox" checked={item.isCompleted} onChange={() => void toggleChecklistItem(item)} disabled={pending} />
                    {editingItem === item.id ? (
                      <input data-task-inline-editor="true" aria-label={`Edit ${item.content}`} autoFocus value={editValue} onChange={(event) => setEditValue(event.target.value)} onKeyDown={(event) => {
                        if (event.key === 'Enter') void saveChecklistItem(item);
                        if (event.key === 'Escape') {
                          event.stopPropagation();
                          setEditingItem(null);
                        }
                      }} className="min-w-0 flex-1 rounded bg-[#10121a] px-2 py-1 text-sm outline-none ring-1 ring-blue-400" />
                    ) : <span className={`min-w-0 flex-1 text-sm ${item.isCompleted ? 'text-slate-500 line-through' : 'text-slate-200'}`}>{item.content}</span>}
                    {editingItem === item.id ? <button type="button" onClick={() => void saveChecklistItem(item)} className="text-xs text-blue-300">Save</button> : <button type="button" onClick={() => { setEditingItem(item.id); setEditValue(item.content); }} className="text-xs text-slate-400">Edit</button>}
                    <button type="button" aria-label={`Move ${item.content} up`} disabled={index === 0 || pending} onClick={() => void moveChecklistItem(index, -1)} className="text-slate-500 disabled:opacity-20">↑</button>
                    <button type="button" aria-label={`Move ${item.content} down`} disabled={index === checklist.length - 1 || pending} onClick={() => void moveChecklistItem(index, 1)} className="text-slate-500 disabled:opacity-20">↓</button>
                    <button type="button" aria-label={`Delete ${item.content}`} onClick={() => void deleteChecklistItem(item)} className="text-rose-300">×</button>
                  </li>
                ))}
              </ul>
            )}
            <form className="mt-3 flex gap-2" onSubmit={(event) => { event.preventDefault(); void addChecklistItem(); }}>
              <input aria-label="New checklist item" value={newItem} onChange={(event) => setNewItem(event.target.value)} placeholder="Add a checklist item" className="min-w-0 flex-1 rounded-lg border border-white/10 bg-[#181b25] px-3 py-2 text-sm outline-none focus:border-blue-400" />
              <button disabled={!newItem.trim() || pending} className="rounded-lg bg-blue-500 px-3 py-2 text-sm font-semibold disabled:opacity-40">Add</button>
            </form>
          </section>

          <section aria-labelledby="comments-heading">
            <h3 id="comments-heading" className="mb-3 text-sm font-semibold text-white">Comments</h3>
            {!loading && comments.length === 0 && <p className="mb-3 text-sm text-slate-500">Start the conversation.</p>}
            <ol className="space-y-3">
              {comments.map((comment) => (
                <li key={comment.id} className="rounded-xl border border-white/8 bg-[#181b25] p-3">
                  <div className="flex justify-between gap-3 text-xs text-slate-500">
                    <span className="font-medium text-slate-300">{comment.authorUser?.displayName ?? comment.author}</span>
                    <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
                  </div>
                  {editingComment === comment.id ? (
                    <textarea data-task-inline-editor="true" aria-label={`Edit comment by ${comment.authorUser?.displayName ?? comment.author}`} autoFocus value={editValue} onChange={(event) => setEditValue(event.target.value)} onKeyDown={(event) => {
                      if (event.key === 'Escape') {
                        event.stopPropagation();
                        setEditingComment(null);
                      }
                    }} className="mt-2 min-h-20 w-full rounded-lg bg-[#10121a] p-2 text-sm outline-none ring-1 ring-blue-400" />
                  ) : <div className="mt-2"><MarkdownContent markdown={comment.content} /></div>}
                  {comment.canEdit && <div className="mt-2 flex gap-3 text-xs">
                    {editingComment === comment.id ? <button type="button" onClick={() => void saveComment(comment)} className="text-blue-300">Save</button> : <button type="button" onClick={() => { setEditingComment(comment.id); setEditValue(comment.content); }} className="text-slate-400">Edit</button>}
                    <button type="button" onClick={() => void deleteComment(comment)} className="text-rose-300">Delete</button>
                  </div>}
                </li>
              ))}
            </ol>
            <form className="mt-3" onSubmit={(event) => { event.preventDefault(); void addComment(); }}>
              <textarea aria-label="New comment" value={newComment} onChange={(event) => setNewComment(event.target.value)} placeholder="Write a comment…" className="min-h-24 w-full rounded-lg border border-white/10 bg-[#181b25] p-3 text-sm outline-none focus:border-blue-400" />
              {commentMentionCandidates.length > 0 && (
                <ul role="listbox" aria-label="Comment mention suggestions" className="mt-1 rounded-lg border border-white/10 bg-slate-900 p-1">
                  {commentMentionCandidates.map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected="false"
                        onClick={() => {
                          setNewComment((current) =>
                            current.replace(
                              /@[\w .-]{0,40}$/,
                              `@[${candidate.displayName}](user:${candidate.id}) `,
                            ),
                          );
                          setCommentMentionCandidates([]);
                        }}
                        className="w-full rounded px-3 py-2 text-left text-sm hover:bg-white/10"
                      >
                        {candidate.displayName}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex justify-end"><button disabled={!newComment.trim() || pending} className="rounded-lg bg-blue-500 px-4 py-2 text-sm font-semibold disabled:opacity-40">Comment</button></div>
            </form>
          </section>

          <TaskAttachments
            cardId={card.id}
            onActivityChanged={refreshActivity}
          />

          <section aria-labelledby="activity-heading">
            <h3 id="activity-heading" className="mb-3 text-sm font-semibold text-white">Activity</h3>
            {loading ? <div className="h-24 animate-pulse rounded-xl bg-white/5" /> : activities.length === 0 ? <p className="text-sm text-slate-500">No activity recorded yet.</p> : (
              <ol className="space-y-3">
                {activities.map((activity) => {
                  const details = activityDetails(activity.metadata);
                  return <li key={activity.id} className="flex gap-3 text-sm">
                    <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                    <div>
                      <p className="text-slate-200"><strong>{activity.actorUser?.displayName ?? (activity.actorType === 'UNATTRIBUTED' ? 'Legacy user' : activity.actorType.toLocaleLowerCase())}</strong> {actionLabels[activity.action] ?? activity.action.replaceAll('_', ' ').toLocaleLowerCase()}</p>
                      {details && <p className="mt-0.5 text-xs text-slate-400">{details}</p>}
                      <time dateTime={activity.occurredAt} className="mt-0.5 block text-xs text-slate-500">{new Date(activity.occurredAt).toLocaleString()}</time>
                    </div>
                  </li>;
                })}
              </ol>
            )}
          </section>

          {(archivePolicy?.canArchive || archivePolicy?.canRestore) && (
            <section aria-labelledby="archive-task-heading" className="rounded-xl border border-amber-400/20 bg-amber-400/5 p-4">
              <h3 id="archive-task-heading" className="text-sm font-semibold text-amber-100">Archive</h3>
              <p className="mt-2 text-sm text-slate-400">Archived tasks leave active workflows and capacity reporting while retaining collaboration history.</p>
              <button type="button" disabled={pending} onClick={() => void changeArchiveState(!archivePolicy.isArchived)} className="mt-3 rounded-lg bg-amber-600 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-500 disabled:opacity-40">{archivePolicy.isArchived ? 'Unarchive Task' : 'Archive Task'}</button>
            </section>
          )}

          {deletePolicy?.canPermanentlyDelete ? (
            <section aria-labelledby="delete-task-heading" className="rounded-xl border border-rose-400/20 bg-rose-400/5 p-4">
              <h3 id="delete-task-heading" className="text-sm font-semibold text-rose-200">Permanent deletion</h3>
              {deletePolicy.isProtected ? (
                <p className="mt-2 text-sm text-rose-100">{deletePolicy.explanation}</p>
              ) : (
                <>
                  <p className="mt-2 text-sm text-slate-400">Only safe tasks without activity or collaboration history can be permanently deleted.</p>
                  <button type="button" disabled={pending} onClick={() => void permanentlyDeleteTask()} className="mt-3 rounded-lg bg-rose-600 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-500 disabled:opacity-40">Delete Permanently</button>
                </>
              )}
            </section>
          ) : null}
        </div>
      </aside>
    </ModalLayer>
  );
}
