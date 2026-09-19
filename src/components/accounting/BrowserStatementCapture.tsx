"use client";
import { browserEvidenceGuard } from "@/lib/finance/archive-browser-evidence";
import { useCallback, useEffect, useState } from "react";

type Row = {
  source: {
    id: string;
    carrier_name: string;
    status: string;
    statementCount: number;
    earliestPid: string | null;
    latestPid: string | null;
  };
  binding: { id: string } | null;
  proposedCompanyId: string | null;
  status: string;
  evidence: string;
};
type Review = {
  catalogId: string | null;
  rows: Row[];
  canonical: { id: string; name: string }[];
  canConfirm: boolean;
  accountConfigured: boolean;
  bridgeEnabled: boolean;
};
type Evidence = {
  kind: string;
  companyId?: string;
  pid?: string;
  statementId?: string;
  version?: number;
  [key: string]: unknown;
};
const endpoint = "/api/finance/archive/bridge";
async function request(url: string, body?: unknown) {
  const r = await fetch(
    url,
    body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : undefined,
  );
  const result = await r.json();
  if (!r.ok) throw Error(result.error || "Request failed");
  return result;
}
const box =
  "min-w-0 max-w-full rounded-xl border border-white/10 bg-slate-900/70 p-4 space-y-3";
const input =
  "max-w-full min-w-0 rounded border border-white/20 bg-slate-950 p-2";
export default function BrowserStatementCapture() {
  const [inventoryItems, setInventoryItems] = useState<
    {
      id: string;
      providerStatementId: string;
      providerVersion: number;
      recipientName: string | null;
      recipientType: string;
      sourceUnit: string | null;
      sourceStatus: string | null;
      captured: boolean;
    }[]
  >([]);
  const [review, setReview] = useState<Review | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [snapshot, setSnapshot] = useState(""),
    [files, setFiles] = useState<
      { name: string; evidence: Evidence; selected: boolean }[]
    >([]),
    [coverage, setCoverage] = useState<Record<string, string | boolean> | null>(
      null,
    );
  const refresh = useCallback(
    async () => setReview(await request(endpoint)),
    [],
  );
  useEffect(() => {
    refresh().catch((e) => setError(e.message));
  }, [refresh]);
  async function act(work: () => Promise<void>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  async function read(file: File) {
    if (file.size > 42 * 1024 * 1024)
      throw Error("Evidence file exceeds 42 MiB.");
    let evidence: unknown;
    try {
      evidence = JSON.parse(await file.text());
    } catch {
      throw Error("Invalid evidence export.");
    }
    browserEvidenceGuard(evidence);
    return evidence as Evidence;
  }
  async function loadCoverage(id: string) {
    const r = await request(
      "/api/finance/archive?view=inventory&id=" + encodeURIComponent(id),
    );
    setCoverage(r.coverage);
    setInventoryItems(r.items);
  }
  return (
    <div
      className="min-w-0 max-w-full space-y-4 [overflow-wrap:anywhere]"
      aria-label="Browser-assisted capture"
    >
      <h3 className="text-xl font-semibold">Browser-assisted capture</h3>
      <p>
        Open QuickManage and sign in there. Export a Company catalog, one
        Company/PID inventory, then selected statement evidence with the browser
        acquisition tool. Upload the evidence here. FleetPilot never receives
        your QuickManage login or session.
      </p>
      <a
        href="https://app.quickmanage.com/accounts/payroll/all-statements"
        target="_blank"
        rel="noreferrer"
        className="underline"
      >
        Open QuickManage All Statements
      </a>
      <p>
        Use the operator guide in{" "}
        <code>docs/QuickManage-Browser-Bridge.md</code> for the local export
        tool. Exports contain private statement data; keep them private and
        remove them after verification.
      </p>
      {!review?.bridgeEnabled && (
        <p>
          Browser capture is disabled. Configuration and separate sample
          authorization are required before live use.
        </p>
      )}
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      <section className={box}>
        <h4>1. Review Company identities</h4>
        {!review?.accountConfigured && (
          <p>
            The verified archive account namespace must be configured before
            uploading a catalog.
          </p>
        )}
        <label>
          Company catalog{" "}
          <input
            aria-label="Company catalog"
            type="file"
            className="block max-w-full text-sm"
            accept=".json,application/json"
            disabled={
              busy ||
              !review?.bridgeEnabled ||
              !review?.accountConfigured ||
              !review?.canConfirm
            }
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file)
                void act(async () => {
                  await request(endpoint, {
                    action: "catalog",
                    evidence: await read(file),
                  });
                  await refresh();
                  setNotice(
                    "Catalog received. OWNER confirmation is required for each binding.",
                  );
                });
              e.target.value = "";
            }}
          />
        </label>
        <p>
          Names are suggestions only. Compare provider IDs and authoritative
          records. A confirmation records your attestation; browser exports are
          not signed by QuickManage.
        </p>
        <div className="overflow-x-auto">
          <table className="min-w-[760px] w-full text-left text-sm [overflow-wrap:normal]">
            <thead>
              <tr>
                {[
                  "QuickManage Company / ID",
                  "Statements / PID range",
                  "Status / evidence",
                  "Canonical Company / confirmation",
                ].map((x) => (
                  <th key={x}>{x}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {review?.rows.map((row) => (
                <tr key={row.source.id}>
                  <td>
                    {row.source.carrier_name}
                    <br />
                    <code>{row.source.id}</code>
                    <br />
                    {row.source.status}
                  </td>
                  <td>
                    {row.source.statementCount}
                    <br />
                    {row.source.earliestPid ?? "Range not supplied"} —{" "}
                    {row.source.latestPid ?? ""}
                  </td>
                  <td>
                    {row.status}
                    <p>{row.evidence}</p>
                  </td>
                  <td>
                    {row.binding ? (
                      "Binding recorded"
                    ) : (
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          const f = new FormData(e.currentTarget);
                          void act(async () => {
                            await request(endpoint, {
                              action: "bind",
                              catalogId: review.catalogId,
                              providerCompanyId: row.source.id,
                              companyId: f.get("companyId"),
                              reason: f.get("reason"),
                              historical: f.get("historical") === "on",
                              confirmation: "CONFIRM_COMPANY_IDENTITY",
                            });
                            await refresh();
                            setNotice("Company binding confirmed.");
                          });
                        }}
                        className="space-y-2"
                      >
                        <select
                          className={input}
                          aria-label={
                            "Canonical Company for " + row.source.carrier_name
                          }
                          name="companyId"
                          required
                          defaultValue={row.proposedCompanyId ?? ""}
                        >
                          <option value="">Select canonical Company</option>
                          {review.canonical.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <input
                          className={input}
                          aria-label={
                            "Identity evidence for " + row.source.carrier_name
                          }
                          name="reason"
                          required
                          maxLength={1000}
                          placeholder="Authoritative identity evidence / reason"
                        />
                        <label className="block">
                          <input type="checkbox" name="historical" /> Approve
                          historical archive scope if outside operational
                          Accounting
                        </label>
                        <label className="block">
                          <input type="checkbox" required /> I verified that
                          these provider and canonical identities refer to the
                          same Company.
                        </label>
                        <button
                          className="btn"
                          disabled={
                            busy ||
                            !review?.bridgeEnabled ||
                            !review?.accountConfigured ||
                            !review.canConfirm
                          }
                        >
                          Confirm Company binding
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className={box}>
        <h4>2. Select Company/PID inventory</h4>
        <p>
          Completeness compares the exact submitted identities; it is not
          provider certification of all historical records. Only explicitly
          bound Companies can ingest inventory. Reuploading an identical
          snapshot resumes existing progress; a changed inventory preserves the
          previous snapshot.
        </p>
        <label>
          Inventory evidence{" "}
          <input
            aria-label="Inventory evidence"
            type="file"
            className="block max-w-full text-sm"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f)
                void act(async () => {
                  const evidence = await read(f);
                  if (
                    !review?.rows.some(
                      (r) => r.source.id === evidence.companyId && r.binding,
                    )
                  )
                    throw Error(
                      "Unbound Company: confirm Company identity first.",
                    );
                  const r = await request(endpoint, {
                    action: "inventory",
                    evidence,
                  });
                  setSnapshot(r.id);
                  setFiles([]);
                  await loadCoverage(r.id);
                  setNotice(
                    "Inventory ready. Preview statements before capture.",
                  );
                });
              e.target.value = "";
            }}
          />
        </label>
        <label>
          Resume inventory ID{" "}
          <input
            className={input}
            aria-label="Resume inventory ID"
            value={snapshot}
            onChange={(e) => {
              setSnapshot(e.target.value);
              setCoverage(null);
              setInventoryItems([]);
              setFiles([]);
            }}
          />
        </label>
        <button
          disabled={
            busy ||
            !review?.bridgeEnabled ||
            !review?.accountConfigured ||
            !snapshot
          }
          onClick={() => void act(() => loadCoverage(snapshot))}
        >
          Load archive progress
        </button>
        {coverage && (
          <p role="status">
            Expected {coverage.expected} · Captured {coverage.captured} ·
            Missing {coverage.missing} · Conflicts {coverage.conflicts} · Failed{" "}
            {coverage.failed} · Unexpected {coverage.unexpected} ·{" "}
            {coverage.complete ? "COMPLETE" : "INCOMPLETE"}
          </p>
        )}
      </section>
      {inventoryItems.length > 0 && (
        <section className={box}>
          <h4>Inventory preview (first 25 identities)</h4>
          <div className="overflow-x-auto">
            <table className="min-w-[760px] w-full text-left text-sm [overflow-wrap:normal]">
              <thead>
                <tr>
                  <th>Recipient / type</th>
                  <th>Provider UUID / version</th>
                  <th>Truck / source status</th>
                  <th>Archive</th>
                </tr>
              </thead>
              <tbody>
                {inventoryItems.map((x) => (
                  <tr key={x.id}>
                    <td>
                      {x.recipientName ?? "Unnamed"} · {x.recipientType}
                    </td>
                    <td>
                      {x.providerStatementId} · v{x.providerVersion}
                    </td>
                    <td>
                      {x.sourceUnit ?? "Unspecified"} ·{" "}
                      {x.sourceStatus ?? "Unspecified"}
                    </td>
                    <td>{x.captured ? "Captured" : "Missing"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <a
            className="underline"
            href={
              "/accounting?view=statements&archive=inventory&id=" +
              encodeURIComponent(snapshot)
            }
          >
            Inspect all inventory identities
          </a>
        </section>
      )}
      <section className={box}>
        <h4>3. Preview and capture selected statements</h4>
        <p>
          Choose at most ten exported statement files. Existing UUID/version
          evidence is safe to resubmit deliberately. Progress is stored by
          FleetPilot, including failures and conflicts.
        </p>
        <input
          aria-label="Statement evidence"
          type="file"
          className="block max-w-full text-sm"
          multiple
          accept=".json,application/json"
          disabled={
            busy ||
            !review?.bridgeEnabled ||
            !review?.accountConfigured ||
            !snapshot
          }
          onChange={(e) => {
            const uploads = Array.from(e.target.files ?? []);
            void act(async () => {
              if (uploads.length > 10)
                throw Error("Select at most ten statements.");
              if (
                uploads.reduce((total, file) => total + file.size, 0) >
                42 * 1024 * 1024
              )
                throw Error(
                  "Selected batch exceeds 42 MiB. Choose fewer statements.",
                );
              const result = [];
              for (const file of uploads) {
                const evidence = await read(file);
                if (evidence.kind !== "statement")
                  throw Error("Expected statement evidence.");
                result.push({ name: file.name, evidence, selected: true });
              }
              setFiles(result);
            });
            e.target.value = "";
          }}
        />
        <ul>
          {files.map((f, i) => (
            <li key={f.name}>
              <label>
                <input
                  type="checkbox"
                  checked={f.selected}
                  onChange={(e) =>
                    setFiles(
                      files.map((v, n) =>
                        n === i ? { ...v, selected: e.target.checked } : v,
                      ),
                    )
                  }
                />
                {f.name} · {f.evidence.companyId} · PID {f.evidence.pid} · UUID{" "}
                {f.evidence.statementId} · v{f.evidence.version}
              </label>
            </li>
          ))}
        </ul>
        <button
          className="btn"
          disabled={
            busy ||
            !review?.bridgeEnabled ||
            !review?.accountConfigured ||
            !snapshot ||
            !files.some((x) => x.selected)
          }
          onClick={() =>
            void act(async () => {
              const chosen = files.filter((x) => x.selected);
              if (chosen.length > 10)
                throw Error("At most ten statements per action.");
              let duplicates = 0;
              for (const f of chosen) {
                const result = await request(endpoint, {
                  action: "capture",
                  inventoryId: snapshot,
                  evidence: f.evidence,
                });
                if (result.retry)
                  throw Error(
                    "Capture already in progress. Reload progress and retry.",
                  );
                if (result.status === "NEEDS_REVIEW")
                  throw Error(
                    "Source conflict: original preserved. Review the archive before continuing.",
                  );
                if (result.idempotent) duplicates++;
              }
              await loadCoverage(snapshot);
              setNotice(
                `Processed ${chosen.length} submissions; ${duplicates} unchanged duplicates.`,
              );
            })
          }
        >
          Capture selected statements
        </button>
        <p>
          <a
            className="underline"
            href="/accounting?view=statements&archive=completeness"
          >
            Review completeness
          </a>{" "}
          ·{" "}
          <a
            className="underline"
            href="/accounting?view=statements&archive=statements"
          >
            Review archived recipients, trucks and versions
          </a>
        </p>
      </section>
    </div>
  );
}
