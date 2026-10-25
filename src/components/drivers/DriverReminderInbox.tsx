"use client";
import { useEffect, useState } from "react";
import { documentLabels, type DocumentKind } from "@/lib/drivers/qualification";
import { displayDate } from "@/lib/drivers/types";
type Notification = {
  id: string;
  driverId: string;
  kind: string;
  documentType: DocumentKind;
  dueAt: string | null;
  createdAt: string;
};
export default function DriverReminderInbox({
  openDriver,
}: {
  openDriver: (id: string) => void;
}) {
  const [page, setPage] = useState(1),
    [pages, setPages] = useState(1),
    [total, setTotal] = useState(0);
  const [notifications, setNotifications] = useState<Notification[]>([]),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(true),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/drivers/reminders?page=${page}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error("Reminder history could not be loaded.");
        const result = await response.json();
        if (!controller.signal.aborted) {
          setError("");
          setNotifications(result.notifications);
          setTotal(result.total);
          setPages(result.totalPages);
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [page, attempt]);
  return (
    <details className="driver-info">
      <summary>Document notification history ({total})</summary>
      <p>
        Internal reminders only. External delivery is disabled. Historical
        alerts may have since been resolved; open the profile for current
        documents.
      </p>
      {loading ? (
        <p role="status">Loading reminders…</p>
      ) : error ? (
        <p role="alert">
          {error}{" "}
          <button
            onClick={() => {
              setLoading(true);
              setAttempt(attempt + 1);
            }}
          >
            Retry
          </button>
        </p>
      ) : notifications.length ? (
        notifications.map((notice) => (
          <p key={notice.id}>
            <button
              className="driver-link"
              onClick={() => openDriver(notice.driverId)}
            >
              Open driver
            </button>{" "}
            · {documentLabels[notice.documentType]} ·{" "}
            {notice.kind.replaceAll("_", " ")} ·{" "}
            {notice.dueAt
              ? `Due ${displayDate(notice.dueAt)}`
              : "Missing under configured policy"}{" "}
            · Recorded {displayDate(notice.createdAt)}
          </p>
        ))
      ) : (
        <p>No scheduled document reminders recorded.</p>
      )}
      <div className="driver-pagination">
        <button
          disabled={page <= 1}
          onClick={() => {
            setLoading(true);
            setPage(page - 1);
          }}
        >
          Previous
        </button>
        <span>
          {page} / {pages}
        </span>
        <button
          disabled={page >= pages}
          onClick={() => {
            setLoading(true);
            setPage(page + 1);
          }}
        >
          Next
        </button>
      </div>
    </details>
  );
}
