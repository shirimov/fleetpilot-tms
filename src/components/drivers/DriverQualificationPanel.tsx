"use client";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { displayDate } from "@/lib/drivers/types";
type Review = {
  id: string;
  outcome: string;
  notes: string;
  reviewerName: string;
  createdAt: string;
};
export default function DriverQualificationPanel({
  driverId,
  canEdit,
  onChanged,
}: {
  driverId: string;
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [reviews, setReviews] = useState<Review[]>([]),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [outcome, setOutcome] = useState("PENDING"),
    [notes, setNotes] = useState(""),
    [saving, setSaving] = useState(false);
  const load = useCallback(
    async (signal?: AbortSignal) => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/drivers/${driverId}/qualification?page=${page}`,
          { cache: "no-store", signal },
        );
        if (!response.ok)
          throw new Error("Qualification records could not be loaded.");
        const result = await response.json();
        setReviews(result.reviews);
        setPages(result.totalPages);
        setError("");
      } catch (error) {
        if (!signal?.aborted) setError((error as Error).message);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [driverId, page],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/drivers/${driverId}/qualification`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome, notes }),
      });
      if (!response.ok) {
        const failure = await response.json();
        throw new Error(failure.error || "Review could not be saved.");
      }
      setNotes("");
      if (page === 1) await load();
      else setPage(1);
      onChanged();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <section>
      <h3>Driver qualification reviews</h3>
      <p className="driver-info">
        Internal human review records only. A file, expiration date or
        “Reviewed” record does not establish legal compliance. Incident
        management and broader Safety remain a separate future Fleet module.
      </p>
      {error && (
        <div role="alert" className="driver-alert">
          {error} <button onClick={() => void load()}>Try again</button>
        </div>
      )}
      {canEdit && (
        <form onSubmit={submit} className="driver-document-form">
          <fieldset disabled={saving}>
            <label>
              Internal review outcome
              <select
                aria-label="Internal review outcome"
                value={outcome}
                onChange={(e) => setOutcome(e.target.value)}
              >
                <option value="PENDING">Pending review</option>
                <option value="REVIEWED">
                  Reviewed — no legal compliance assertion
                </option>
                <option value="NEEDS_FOLLOW_UP">Needs follow-up</option>
              </select>
            </label>
            <label>
              Review notes
              <textarea
                aria-label="Qualification review notes"
                required
                maxLength={2000}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <button className="driver-button driver-primary" type="submit">
              {saving ? "Saving…" : "Record qualification review"}
            </button>
          </fieldset>
        </form>
      )}
      {loading ? (
        <p role="status">Loading qualification reviews…</p>
      ) : reviews.length ? (
        reviews.map((review) => (
          <article className="driver-trip" key={review.id}>
            <span className="driver-badge blue">
              {review.outcome.replaceAll("_", " ")}
            </span>
            <p className="whitespace-pre-wrap">{review.notes}</p>
            <small>
              {review.reviewerName} · {displayDate(review.createdAt)}
            </small>
          </article>
        ))
      ) : (
        <p className="driver-muted">No qualification reviews recorded.</p>
      )}
      <div className="driver-pagination">
        <button
          className="driver-button"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Previous
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          className="driver-button"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        >
          Next
        </button>
      </div>
    </section>
  );
}
