"use client";
import { useCallback, useEffect, useState } from "react";
import { displayDate } from "@/lib/drivers/types";
type Activity = {
  id: string;
  action: string;
  actorName: string;
  createdAt: string;
  metadata: { changedFields?: string[] };
};
export default function DriverActivityPanel({
  driverId,
}: {
  driverId: string;
}) {
  const [events, setEvents] = useState<Activity[]>([]),
    [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [error, setError] = useState("");
  const load = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch(
          `/api/drivers/${driverId}/activity?page=${page}`,
          { cache: "no-store", signal },
        );
        if (!response.ok) throw new Error("Activity could not be loaded.");
        const result = await response.json();
        setEvents(result.events);
        setPages(result.totalPages);
        setError("");
      } catch (error) {
        if (!signal?.aborted) setError((error as Error).message);
      }
    },
    [driverId, page],
  );
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  return (
    <section>
      <h3>Driver activity history</h3>
      {error && (
        <div className="driver-alert" role="alert">
          {error}
          <button onClick={() => void load()}>Try again</button>
        </div>
      )}
      {events.map((event) => (
        <article className="driver-trip" key={event.id}>
          <strong>{event.action.replaceAll("_", " ").toLowerCase()}</strong>
          {event.metadata.changedFields?.length ? (
            <p className="driver-muted">
              Changed fields: {event.metadata.changedFields.join(", ")}
            </p>
          ) : null}
          <p>
            {event.actorName} · {displayDate(event.createdAt)}
          </p>
        </article>
      ))}
      {!events.length && !error && (
        <p className="driver-muted">
          No activity recorded since audit tracking was enabled. Earlier changes
          were not backfilled.
        </p>
      )}
      <div className="driver-pagination">
        <button
          className="driver-button"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          Previous activity
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          className="driver-button"
          disabled={page >= pages}
          onClick={() => setPage(page + 1)}
        >
          Older activity
        </button>
      </div>
    </section>
  );
}
