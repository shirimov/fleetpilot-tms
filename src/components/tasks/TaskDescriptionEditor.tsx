'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import MarkdownContent from './MarkdownContent';

type MentionCandidate = {
  id: string;
  displayName: string;
  image: string | null;
};

type Props = {
  cardId: string;
  initialMarkdown: string;
  initialUpdatedAt: string;
  onSaved?: (markdown: string, updatedAt: string) => void;
};

const mentionPattern = /@\[([^\]]+)\]\(user:([^)]+)\)/g;

export function extractMentionUserIds(markdown: string): string[] {
  return [...new Set([...markdown.matchAll(mentionPattern)].map((match) => match[2]))];
}

export function isCurrentDescriptionSave(
  requestCardId: string,
  currentCardId: string,
  requestSequence: number,
  currentSequence: number,
): boolean {
  return requestCardId === currentCardId && requestSequence === currentSequence;
}

export default function TaskDescriptionEditor({
  cardId,
  initialMarkdown,
  initialUpdatedAt,
  onSaved,
}: Props) {
  const [markdown, setMarkdown] = useState(initialMarkdown);
  const [savedMarkdown, setSavedMarkdown] = useState(initialMarkdown);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [mode, setMode] = useState<'write' | 'preview'>('preview');
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');
  const [mentionCandidates, setMentionCandidates] = useState<MentionCandidate[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const requestSequence = useRef(0);
  const activeCardId = useRef(cardId);
  const markdownRef = useRef(markdown);
  if (activeCardId.current !== cardId) {
    activeCardId.current = cardId;
    requestSequence.current += 1;
  }
  markdownRef.current = markdown;
  const dirty = markdown !== savedMarkdown;

  useEffect(() => {
    setMarkdown(initialMarkdown);
    setSavedMarkdown(initialMarkdown);
    setUpdatedAt(initialUpdatedAt);
  }, [cardId, initialMarkdown, initialUpdatedAt]);

  const mentionQuery = useMemo(() => {
    const beforeCursor = markdown.slice(0, textareaRef.current?.selectionStart ?? markdown.length);
    return beforeCursor.match(/(?:^|\s)@([\w .-]{0,40})$/)?.[1] ?? null;
  }, [markdown]);

  useEffect(() => {
    if (mentionQuery === null || mode !== 'write') {
      setMentionCandidates([]);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/tasks/mentions?q=${encodeURIComponent(mentionQuery)}`, {
      signal: controller.signal,
    })
      .then((response) => response.ok ? response.json() : [])
      .then((users: MentionCandidate[]) => setMentionCandidates(users))
      .catch(() => {});
    return () => controller.abort();
  }, [mentionQuery, mode]);

  useEffect(() => {
    if (!dirty || saveState === 'saving' || saveState === 'error') return;
    const sequence = ++requestSequence.current;
    const requestCardId = cardId;
    const requestMarkdown = markdown;
    const timer = window.setTimeout(async () => {
      setSaveState('saving');
      try {
        const response = await fetch('/api/tasks/cards', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: cardId,
            description: requestMarkdown || null,
            expectedUpdatedAt: updatedAt,
            mentionUserIds: extractMentionUserIds(requestMarkdown),
          }),
        });
        const body = (await response.json()) as {
          error?: string;
          description?: string | null;
          updatedAt?: string;
        };
        if (!response.ok) throw new Error(body.error ?? 'Description could not be saved.');
        if (
          !isCurrentDescriptionSave(
            requestCardId,
            activeCardId.current,
            sequence,
            requestSequence.current,
          )
        ) {
          if (requestCardId === activeCardId.current) setSaveState('saved');
          return;
        }
        const canonical = body.description ?? '';
        setSavedMarkdown(canonical);
        setUpdatedAt(body.updatedAt ?? updatedAt);
        setSaveState('saved');
        setSaveError('');
        if (markdownRef.current === requestMarkdown) {
          onSaved?.(canonical, body.updatedAt ?? updatedAt);
        }
      } catch (error) {
        if (
          isCurrentDescriptionSave(
            requestCardId,
            activeCardId.current,
            sequence,
            requestSequence.current,
          )
        ) {
          setSaveState('error');
          setSaveError(error instanceof Error ? error.message : 'Description could not be saved.');
        }
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [cardId, dirty, markdown, onSaved, saveState, updatedAt]);

  function wrap(prefix: string, suffix = prefix) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    setMarkdown(
      `${markdown.slice(0, start)}${prefix}${markdown.slice(start, end)}${suffix}${markdown.slice(end)}`,
    );
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + prefix.length, end + prefix.length);
    });
  }

  function insertMention(candidate: MentionCandidate) {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursor = textarea.selectionStart;
    const before = markdown.slice(0, cursor);
    const match = before.match(/@[\w .-]{0,40}$/);
    const start = match ? cursor - match[0].length : cursor;
    const token = `@[${candidate.displayName}](user:${candidate.id}) `;
    setMarkdown(`${markdown.slice(0, start)}${token}${markdown.slice(cursor)}`);
    setMentionCandidates([]);
    requestAnimationFrame(() => textarea.focus());
  }

  return (
    <section aria-labelledby="description-heading">
      <div className="mb-3 flex items-center justify-between">
        <h3 id="description-heading" className="text-sm font-semibold text-white">Description</h3>
        <div className="flex items-center gap-2">
          <span role="status" className={`text-xs ${saveState === 'error' ? 'text-rose-300' : 'text-slate-500'}`}>
            {saveState === 'saving' ? 'Saving…' : saveState === 'error' ? 'Save failed' : 'Saved'}
          </span>
          {saveState === 'error' && (
            <button type="button" onClick={() => setSaveState('saved')} className="rounded px-2 py-1 text-xs font-semibold text-rose-200 hover:bg-rose-400/10">Retry</button>
          )}
          {(['write', 'preview'] as const).map((option) => (
            <button key={option} type="button" onClick={() => setMode(option)} aria-pressed={mode === option} className="rounded px-2 py-1 text-xs capitalize text-slate-300 hover:bg-white/5">{option}</button>
          ))}
        </div>
      </div>
      {mode === 'write' ? (
        <div className="relative rounded-xl border border-white/10 bg-[#181b25]">
          <div role="toolbar" aria-label="Markdown formatting" className="flex flex-wrap gap-1 border-b border-white/8 p-2">
            <button type="button" onClick={() => wrap('**')} aria-label="Bold" className="rounded px-2 py-1 text-xs hover:bg-white/10"><strong>B</strong></button>
            <button type="button" onClick={() => wrap('_')} aria-label="Italic" className="rounded px-2 py-1 text-xs hover:bg-white/10"><em>I</em></button>
            <button type="button" onClick={() => wrap('`')} aria-label="Inline code" className="rounded px-2 py-1 text-xs hover:bg-white/10">Code</button>
            <button type="button" onClick={() => wrap('# ', '')} aria-label="Heading" className="rounded px-2 py-1 text-xs hover:bg-white/10">H1</button>
            <button type="button" onClick={() => wrap('- ', '')} aria-label="List" className="rounded px-2 py-1 text-xs hover:bg-white/10">List</button>
            <button type="button" onClick={() => wrap('- [ ] ', '')} aria-label="Task list" className="rounded px-2 py-1 text-xs hover:bg-white/10">☑</button>
            <button type="button" onClick={() => wrap('> ', '')} aria-label="Block quote" className="rounded px-2 py-1 text-xs hover:bg-white/10">Quote</button>
            <button type="button" onClick={() => wrap('[', '](https://)')} aria-label="Link" className="rounded px-2 py-1 text-xs hover:bg-white/10">Link</button>
          </div>
          <textarea
            ref={textareaRef}
            aria-label="Task description Markdown"
            data-task-inline-editor={dirty ? 'true' : undefined}
            value={markdown}
            onChange={(event) => {
              requestSequence.current += 1;
              setMarkdown(event.target.value);
              if (saveState === 'error') {
                setSaveState('saved');
                setSaveError('');
              }
            }}
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
                event.preventDefault();
                wrap('**');
              }
              if (event.key === 'Escape' && dirty) {
                event.stopPropagation();
                setSaveState('error');
              }
            }}
            className="min-h-48 w-full resize-y bg-transparent p-3 font-mono text-sm text-slate-200 outline-none"
            placeholder="Describe the task with Markdown. Type @ to mention a teammate."
          />
          {saveState === 'error' && <p role="alert" className="px-3 pb-3 text-xs text-rose-300">{saveError}</p>}
          {mentionCandidates.length > 0 && (
            <ul role="listbox" aria-label="Mention suggestions" className="absolute left-3 top-full z-20 mt-1 max-h-44 w-72 overflow-auto rounded-lg border border-white/10 bg-slate-900 p-1 shadow-xl">
              {mentionCandidates.map((candidate) => (
                <li key={candidate.id}>
                  <button type="button" role="option" aria-selected="false" onClick={() => insertMention(candidate)} className="w-full rounded px-3 py-2 text-left text-sm hover:bg-white/10">{candidate.displayName}</button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="min-h-20 rounded-xl border border-white/8 bg-[#181b25] p-4">
          {markdown ? <MarkdownContent markdown={markdown} /> : <p className="text-sm text-slate-500">No description has been added.</p>}
        </div>
      )}
    </section>
  );
}
