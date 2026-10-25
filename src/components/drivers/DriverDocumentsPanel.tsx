"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  documentAlerts,
  documentLabels,
  expirationState,
  type DocumentKind,
} from "@/lib/drivers/qualification";
import { displayDate } from "@/lib/drivers/types";
type Version = {
  id: string;
  version: number;
  filename: string;
  mimeType: string;
  byteSize: number;
  issuedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
};
type Document = {
  id: string;
  type: DocumentKind;
  title: string;
  currentVersion: Version;
  versionCount: number;
};
type History = { versions: Version[]; page: number; totalPages: number };
function expiry(version: Version) {
  const state = expirationState(version.expiresAt);
  return state.days === null
    ? "Expiration not recorded"
    : state.days < 0
      ? "Expired"
      : state.days <= 90
        ? `Expires in ${state.days} days`
        : "On file";
}
export default function DriverDocumentsPanel({
  driverId,
  canEdit,
  onChanged,
}: {
  driverId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [alerts, setAlerts] = useState<ReturnType<
    typeof documentAlerts
  > | null>(null);
  const [documents, setDocuments] = useState<Document[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [editing, setEditing] = useState<Document | null | undefined>(
      undefined,
    ),
    [type, setType] = useState<DocumentKind>("CDL_FRONT"),
    [title, setTitle] = useState("");
  const [issuedAt, setIssuedAt] = useState(""),
    [expiresAt, setExpiresAt] = useState(""),
    [file, setFile] = useState<File | null>(null),
    [saving, setSaving] = useState(false);
  const [history, setHistory] = useState<{
    document: Document;
    results: History;
  } | null>(null);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(`/api/drivers/${driverId}/documents`, {
          cache: "no-store",
          signal,
        });
        if (!response.ok) throw new Error("Documents could not be loaded.");
        const result = await response.json();
        setDocuments(result.documents);
        setAlerts(result.alerts);
      } catch (error) {
        if (!signal?.aborted) setError((error as Error).message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [driverId],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  function open(document: Document | null) {
    setEditing(document);
    setType(document?.type || "CDL_FRONT");
    setTitle(document?.title || "");
    setIssuedAt(document?.currentVersion.issuedAt?.slice(0, 10) || "");
    setExpiresAt(document?.currentVersion.expiresAt?.slice(0, 10) || "");
    setFile(null);
    setError("");
    setNotice("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      let response: Response;
      if (editing && !file)
        response = await fetch(
          `/api/drivers/${driverId}/documents/${editing.id}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              expectedVersionId: editing.currentVersion.id,
              issuedAt,
              expiresAt,
            }),
          },
        );
      else {
        if (!file) throw new Error("Select a file.");
        const form = new FormData();
        form.set("file", file);
        form.set("type", type);
        form.set("title", title);
        form.set("issuedAt", issuedAt);
        form.set("expiresAt", expiresAt);
        if (editing) {
          form.set("documentId", editing.id);
          form.set("expectedVersionId", editing.currentVersion.id);
        }
        response = await fetch(`/api/drivers/${driverId}/documents`, {
          method: "POST",
          body: form,
        });
      }
      if (!response.ok) {
        const failure = await response.json();
        throw new Error(failure.error || "Document could not be saved.");
      }
      setEditing(undefined);
      setHistory(null);
      setNotice("Document version saved. Previous versions are preserved.");
      await load();
      onChanged();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  async function showHistory(document: Document, page = 1) {
    setError("");
    try {
      const response = await fetch(
        `/api/drivers/${driverId}/documents/${document.id}?page=${page}`,
        { cache: "no-store" },
      );
      if (!response.ok)
        throw new Error("Document history could not be loaded.");
      setHistory({ document, results: await response.json() });
    } catch (error) {
      setError((error as Error).message);
    }
  }
  function actions(document: Document, version: Version) {
    const url = `/api/drivers/${driverId}/documents/${document.id}/versions/${version.id}`;
    return (
      <span className="driver-document-actions">
        <a href={url} target="_blank" rel="noreferrer">
          Download v{version.version}
        </a>
        {version.mimeType.startsWith("image/") && (
          <a href={`${url}?preview=1`} target="_blank" rel="noreferrer">
            Preview
          </a>
        )}
      </span>
    );
  }
  return (
    <section>
      <h3>
        Driver documents{" "}
        {canEdit && (
          <button
            className="driver-button driver-primary"
            onClick={() => open(null)}
          >
            ＋ Add Document
          </button>
        )}
      </h3>
      <p className="driver-muted">
        Private PDF, PNG, JPEG or WebP · up to 10 MB. This internal checklist
        does not establish legal compliance. Date-only expiration uses UTC; a
        document remains current through its expiration day.
      </p>
      {alerts && (
        <details className="driver-info">
          <summary>
            Internal checklist: {alerts.missingRequired.length} missing ·{" "}
            {alerts.expired} expired · {alerts.within30} expiring within 30 days
          </summary>
          <p className="driver-muted">
            {alerts.missingRequired
              .map((type) => documentLabels[type])
              .join(", ") || "No missing document types."}{" "}
            This is a tracking checklist, not a legal qualification
            determination.
          </p>
        </details>
      )}
      {error && (
        <div role="alert" className="driver-alert">
          {error}{" "}
          {editing === undefined && (
            <button onClick={() => void load()}>Try again</button>
          )}
        </div>
      )}
      {notice && (
        <p role="status" className="driver-success">
          {notice}
        </p>
      )}
      {editing !== undefined && (
        <form className="driver-document-form" onSubmit={submit}>
          <h3>
            {editing ? "Replace document / update dates" : "Upload document"}
          </h3>
          <fieldset disabled={saving}>
            <label>
              Document type
              <select
                aria-label="Document type"
                value={type}
                disabled={!!editing}
                onChange={(e) => setType(e.target.value as DocumentKind)}
              >
                {Object.entries(documentLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            {type === "OTHER" && (
              <label>
                Document title
                <input
                  aria-label="Document title"
                  required
                  maxLength={100}
                  disabled={!!editing}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
            )}
            <div className="driver-field-grid">
              <label>
                Issue date
                <input
                  aria-label="Document issue date"
                  type="date"
                  value={issuedAt}
                  onChange={(e) => setIssuedAt(e.target.value)}
                />
              </label>
              <label>
                Expiration date
                <input
                  aria-label="Document expiration date"
                  type="date"
                  value={expiresAt}
                  onChange={(e) => setExpiresAt(e.target.value)}
                />
              </label>
            </div>
            <label>
              {editing
                ? "New file (optional for date corrections)"
                : "Document file"}
              <input
                key={editing?.id || "new"}
                aria-label="Document file"
                type="file"
                required={!editing}
                accept=".pdf,.png,.jpg,.jpeg,.webp"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
              />
            </label>
            <p className="driver-muted">
              Saving appends a version. Existing files and dates stay in
              history. File validation is not a malware scan or qualification
              review.
            </p>
            <div className="flex gap-2">
              <button className="driver-button driver-primary" type="submit">
                {saving ? "Saving…" : "Save document version"}
              </button>
              <button
                className="driver-button"
                type="button"
                onClick={() => setEditing(undefined)}
              >
                Cancel
              </button>
            </div>
          </fieldset>
        </form>
      )}
      {loading ? (
        <p role="status">Loading documents…</p>
      ) : (
        <div className="driver-table-scroll">
          <table>
            <thead>
              <tr>
                <th>Document</th>
                <th>Expiration</th>
                <th>Tracking</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((document) => (
                <tr key={document.id}>
                  <td>
                    <strong>{document.title}</strong>
                    <small>{document.currentVersion.filename}</small>
                  </td>
                  <td>{displayDate(document.currentVersion.expiresAt)}</td>
                  <td>
                    <span
                      className={`driver-badge ${expirationState(document.currentVersion.expiresAt).status === "EXPIRED" ? "red" : "blue"}`}
                    >
                      {expiry(document.currentVersion)}
                    </span>
                  </td>
                  <td>
                    {actions(document, document.currentVersion)}
                    <div className="driver-document-actions">
                      <button onClick={() => void showHistory(document)}>
                        History ({document.versionCount})
                      </button>
                      {canEdit && (
                        <button onClick={() => open(document)}>
                          Replace / dates
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!documents.length && (
            <div className="driver-empty">
              <h3>No documents on file</h3>
              <p>
                Upload qualification documents and record their expiration
                dates.
              </p>
            </div>
          )}
        </div>
      )}
      {history && (
        <section className="driver-history">
          <h3>
            {history.document.title} — version history
            <button
              className="driver-text-button"
              onClick={() => setHistory(null)}
            >
              Close
            </button>
          </h3>
          {history.results.versions.map((version) => (
            <article className="driver-trip" key={version.id}>
              <strong>
                Version {version.version} · {displayDate(version.createdAt)}
              </strong>
              <p>
                {version.filename} · expires {displayDate(version.expiresAt)}
              </p>
              {actions(history.document, version)}
            </article>
          ))}
          <div className="driver-pagination">
            <button
              className="driver-button"
              disabled={history.results.page <= 1}
              onClick={() =>
                void showHistory(history.document, history.results.page - 1)
              }
            >
              Previous versions
            </button>
            <span>
              {history.results.page} / {history.results.totalPages}
            </span>
            <button
              className="driver-button"
              disabled={history.results.page >= history.results.totalPages}
              onClick={() =>
                void showHistory(history.document, history.results.page + 1)
              }
            >
              Older versions
            </button>
          </div>
        </section>
      )}
    </section>
  );
}
