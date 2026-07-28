'use client';

import { useEffect, useRef, useState } from 'react';

type Attachment = {
  id: string;
  filename: string;
  byteSize: number | null;
  mimeType: string;
  createdAt: string;
  uploader: { id: string | null; displayName: string; image: string | null };
  canDelete: boolean;
};

export default function TaskAttachments({
  cardId,
  onActivityChanged,
}: {
  cardId: string;
  onActivityChanged: () => Promise<void>;
}) {
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [progress, setProgress] = useState<number | null>(null);
  const [status, setStatus] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/tasks/cards/${cardId}/attachments`)
      .then(async (response) => {
        if (!response.ok) throw new Error('Attachments could not be loaded.');
        return response.json() as Promise<Attachment[]>;
      })
      .then((items) => {
        if (active) setAttachments(items);
      })
      .catch(() => {
        if (active) setStatus('Attachments could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, [cardId]);

  function upload(file: File) {
    setStatus('');
    setProgress(0);
    const form = new FormData();
    form.set('file', file);
    const request = new XMLHttpRequest();
    request.open('POST', `/api/tasks/cards/${cardId}/attachments`);
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      setProgress(null);
      if (request.status < 200 || request.status >= 300) {
        try {
          setStatus((JSON.parse(request.responseText) as { error?: string }).error ?? 'Upload failed.');
        } catch {
          setStatus('Upload failed.');
        }
        return;
      }
      setAttachments((current) => [...current, JSON.parse(request.responseText) as Attachment]);
      setStatus('Upload complete.');
      void onActivityChanged();
    };
    request.onerror = () => {
      setProgress(null);
      setStatus('Upload failed.');
    };
    request.send(form);
  }

  async function remove(attachment: Attachment) {
    const response = await fetch(
      `/api/tasks/cards/${cardId}/attachments/${attachment.id}`,
      { method: 'DELETE' },
    );
    if (!response.ok) {
      setStatus('Attachment could not be deleted.');
      return;
    }
    setAttachments((current) => current.filter(({ id }) => id !== attachment.id));
    setStatus('Attachment deleted.');
    await onActivityChanged();
  }

  return (
    <section aria-labelledby="attachments-heading">
      <h3 id="attachments-heading" className="mb-3 text-sm font-semibold text-white">Attachments</h3>
      <div
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          const file = event.dataTransfer.files[0];
          if (file) upload(file);
        }}
        className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-4 text-center"
      >
        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          aria-label="Choose task attachment"
          accept=".png,.jpg,.jpeg,.webp,.gif,.pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.7z"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) upload(file);
            event.currentTarget.value = '';
          }}
        />
        <p className="text-sm text-slate-400">Drop a file here or</p>
        <button type="button" onClick={() => inputRef.current?.click()} className="mt-2 rounded-lg bg-white/8 px-3 py-2 text-sm font-medium hover:bg-white/12">Choose file</button>
        <p className="mt-2 text-xs text-slate-600">Images, PDF, Office, ZIP, RAR, or 7z · 20 MB maximum</p>
        {progress !== null && <progress aria-label="Upload progress" value={progress} max={100} className="mt-3 w-full">{progress}%</progress>}
        <p role="status" aria-live="polite" className="mt-2 text-xs text-slate-400">{status}</p>
      </div>
      {attachments.length === 0 ? (
        <p className="mt-3 text-sm text-slate-500">No attachments yet.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex items-center gap-3 rounded-lg border border-white/8 bg-[#181b25] p-3">
              {attachment.mimeType.startsWith('image/') ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={`/api/tasks/cards/${cardId}/attachments/${attachment.id}/download?preview=1`} alt="" className="h-10 w-10 rounded object-cover" />
              ) : <span aria-hidden="true" className="text-xl">📎</span>}
              <div className="min-w-0 flex-1">
                <a href={`/api/tasks/cards/${cardId}/attachments/${attachment.id}/download`} className="block truncate text-sm font-medium text-blue-300 hover:underline">{attachment.filename}</a>
                <p className="text-xs text-slate-500">{attachment.byteSize === null ? 'Unknown size' : `${Math.ceil(attachment.byteSize / 1024)} KB`} · {attachment.uploader.displayName} · {new Date(attachment.createdAt).toLocaleString()}</p>
              </div>
              {attachment.canDelete && <button type="button" onClick={() => void remove(attachment)} aria-label={`Delete ${attachment.filename}`} className="text-sm text-rose-300">Delete</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
