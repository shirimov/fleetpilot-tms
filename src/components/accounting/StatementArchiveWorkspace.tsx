"use client";
import BrowserStatementCapture from "./BrowserStatementCapture";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { formatMinorUnitsDecimal } from "@/lib/finance/money";

type Binding = {
  id: string;
  providerCompanyName: string;
  company: { name: string };
};
type Truck = {
  id: string;
  unit: string | null;
  mappingStatus: string;
  truckId: string | null;
};
type Line = {
  id: string;
  kind: string;
  sourceArray: string;
  description: string | null;
  amountMinor: string | null;
  rawAmount: string | null;
  included: boolean | null;
  sourceUnit: string | null;
  metadata: unknown;
};
type Version = {
  id: string;
  providerVersion: number;
  pid: string;
  statementNumber: string | null;
  recipientName: string | null;
  recipientId: string;
  recipientType: string;
  recipientStatus: string | null;
  role: string | null;
  contract: string | null;
  sourceStatus: string | null;
  grossMinor: string | null;
  deductionsMinor: string | null;
  netPayMinor: string | null;
  payoutMinor: string | null;
  workStart: string;
  workEnd: string;
  pdfChecksum: string;
  detailChecksum: string;
  capturedAt: string;
  trucks: Truck[];
  lines: Line[];
  issues: string[];
  header: { archiveProvenance?: { acquisition?: string; assurance?: string } };
  _count: { lines: number };
};
type Statement = {
  id: string;
  providerStatementId: string;
  status: string;
  company: { providerCompanyName: string };
  versions: Version[];
  version: Version;
  conflicts: { id: string; providerVersion: number; pdfChecksum: string }[];
  latestProviderVersion: number;
  acceptedProviderVersion: number;
};
type Coverage = {
  id: string;
  company: string;
  pid: string;
  expected: string;
  captured: string;
  missing: string;
  conflicts: string;
  failed: string;
  unexpected: string;
  complete: boolean;
};
type Item = {
  id: string;
  providerStatementId: string;
  providerVersion: number;
  recipientName: string | null;
  recipientId: string;
  recipientType: string;
  captured: boolean;
  archiveStatus: string;
  statementId: string | null;
  job: { status: string; attempts: number; errorCode: string | null };
};
type Overview = {
  bindings: Binding[];
  statementCount: number;
  groups: string;
  complete: string;
  missing: string;
  conflicts: string;
  failed: string;
  unexpected: string;
  connectionEnabled: boolean;
};
type Data = {
  items: Statement[] & Coverage[] & Item[];
  total: number;
  coverage: Coverage;
  snapshot: { id: string; pid: string; company: Binding };
  unexpected: { id: string; providerStatementId: string }[];
} & Statement;
const box = "rounded-xl border border-white/10 bg-slate-900/70 p-4";
const input = "rounded border border-white/20 bg-slate-950 p-2 max-w-full";
const money = (v: string | null | undefined) =>
  v == null ? "—" : `$${formatMinorUnitsDecimal(BigInt(v))}`;
async function api(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const b = await r.json();
  if (!r.ok) throw Error(b.error ?? "Archive request failed");
  return b;
}
export default function StatementArchiveWorkspace({
  documents,
}: {
  documents: ReactNode;
  companies: { id: string; name: string }[];
}) {
  const router = useRouter(),
    params = useSearchParams(),
    query = params.toString();
  const view = params.get("archive") ?? "overview",
    page = Number(params.get("page") ?? 0);
  const [overview, setOverview] = useState<Overview | null>(null),
    [rawData, setData] = useState<Data | null>(null),
    [loadedQuery, setLoadedQuery] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [selected, setSelected] = useState<string[]>([]);
  const data = loadedQuery === query ? rawData : null;
  const go = useCallback(
    (updates: Record<string, string>) => {
      const p = new URLSearchParams(query);
      p.set("view", "statements");
      p.delete("page");
      for (const [k, v] of Object.entries(updates)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      router.push(`/accounting?${p}`);
      setSelected([]);
    },
    [query, router],
  );
  useEffect(() => {
    const controller = new AbortController();
    const p = new URLSearchParams(query);
    p.set("view", view);
    setData(null);
    setError("");
    Promise.all([
      api("/api/finance/archive", { signal: controller.signal }),
      view === "overview" || view === "capture" || view === "documents"
        ? Promise.resolve(null)
        : api(`/api/finance/archive?${p}`, { signal: controller.signal }),
    ])
      .then(([o, d]) => {
        if (!controller.signal.aborted) {
          setOverview(o);
          setData(d);
          setLoadedQuery(query);
        }
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [query, view, revision]);
  async function action(body: unknown) {
    setBusy(true);
    setError("");
    try {
      const result = await api("/api/finance/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      setRevision((x) => x + 1);
      return result;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }
  const pager = (total: number, size = 25) => (
    <div className="flex items-center gap-3">
      <button
        disabled={page <= 0}
        onClick={() => go({ page: String(page - 1) })}
      >
        Previous page
      </button>
      <span>
        Page {page + 1} · {total} records
      </span>
      <button
        disabled={(page + 1) * size >= total}
        onClick={() => go({ page: String(page + 1) })}
      >
        Next page
      </button>
    </div>
  );
  const filter = (
    <form
      className="flex flex-wrap gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        go(
          Object.fromEntries(new FormData(e.currentTarget).entries()) as Record<
            string,
            string
          >,
        );
      }}
    >
      <select
        aria-label="Company filter"
        className={input}
        name="company"
        defaultValue={params.get("company") ?? ""}
      >
        <option value="">All authorized companies</option>
        {overview?.bindings.map((b) => (
          <option key={b.id} value={b.id}>
            {b.company.name}
          </option>
        ))}
      </select>
      <input
        className={input}
        name="pid"
        aria-label="PID filter"
        placeholder="PID (2026-37)"
        defaultValue={params.get("pid") ?? ""}
      />
      {view === "statements" && (
        <>
          <input
            className={input}
            name="recipient"
            placeholder="Recipient"
            defaultValue={params.get("recipient") ?? ""}
          />
          <input
            className={input}
            name="truck"
            placeholder="Truck unit"
            defaultValue={params.get("truck") ?? ""}
          />
          <select
            className={input}
            name="type"
            aria-label="Recipient type"
            defaultValue={params.get("type") ?? ""}
          >
            <option value="">All types</option>
            <option>DRIVER</option>
            <option>CONTRACTOR</option>
          </select>
          <select
            className={input}
            name="lifecycle"
            aria-label="Recipient lifecycle"
            defaultValue={params.get("lifecycle") ?? ""}
          >
            <option value="">All lifecycle states</option>
            <option value="active">Active</option>
            <option value="terminated">Terminated</option>
            <option value="deleted">Deleted</option>
          </select>
          <select
            className={input}
            name="status"
            aria-label="Archive status"
            defaultValue={params.get("status") ?? ""}
          >
            <option value="">All archive states</option>
            <option>PARSED</option>
            <option>SOURCE_CHANGED</option>
            <option>NEEDS_REVIEW</option>
          </select>
        </>
      )}
      <button className="btn">Apply filters</button>
    </form>
  );
  return (
    <section className="space-y-4 min-w-0">
      <h2 className="text-xl font-semibold">Statement archive</h2>
      <p>
        Historical settlement evidence. Capturing statements does not post
        income, expenses, or bank matches. Completeness means complete against
        the captured inventory snapshot, not independently verified provider
        history. Browser submissions are user-attested and checksum sealed;
        QuickManage has not cryptographically authenticated them to FleetPilot.
      </p>
      <nav
        aria-label="Statement archive views"
        className="flex flex-wrap gap-3"
      >
        {["overview", "statements", "completeness", "capture", "documents"].map(
          (v) => (
            <button
              key={v}
              aria-current={view === v ? "page" : undefined}
              onClick={() => go({ archive: v, id: "", version: "", page: "" })}
            >
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ),
        )}
      </nav>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      {view === "documents" ? (
        documents
      ) : view === "overview" && overview ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["Archived statements", overview.statementCount],
            ["Mapped companies", overview.bindings.length],
            ["Company/PID groups", overview.groups],
            ["Complete inventory snapshots", overview.complete],
            [
              "Incomplete groups",
              Number(overview.groups) - Number(overview.complete),
            ],
            ["Missing statements", overview.missing],
            ["Conflicts / source changes", overview.conflicts],
            ["Capture failures", overview.failed],
            ["Unexpected statements", overview.unexpected],
          ].map(([label, value]) => (
            <div key={label} className={box}>
              <p>{label}</p>
              <strong className="text-2xl">{value}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {view === "capture" && <BrowserStatementCapture />}
      {(view === "statements" || view === "completeness") && filter}
      {view === "completeness" && data && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    "Company",
                    "PID",
                    "Expected",
                    "Captured",
                    "Missing",
                    "Conflicts",
                    "Failed",
                    "Unexpected",
                    "Status",
                  ].map((x) => (
                    <th className="p-2" key={x}>
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((r: Coverage) => (
                  <tr key={r.id}>
                    <td className="p-2">{r.company}</td>
                    <td>
                      <button
                        className="text-emerald-300"
                        onClick={() => go({ archive: "inventory", id: r.id })}
                      >
                        {r.pid}
                      </button>
                    </td>
                    {[
                      r.expected,
                      r.captured,
                      r.missing,
                      r.conflicts,
                      r.failed,
                      r.unexpected,
                    ].map((v, i) => (
                      <td key={i}>{v}</td>
                    ))}
                    <td>{r.complete ? "COMPLETE" : "INCOMPLETE"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!data.items.length && <p>No inventories captured.</p>}
          {pager(Number(data.total))}
        </>
      )}
      {view === "statements" && data && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  {[
                    "Company",
                    "PID / Statement #",
                    "Truck",
                    "Recipient / Type / Role",
                    "Gross",
                    "Deductions",
                    "Net / Payout",
                    "Provider / Archive status",
                  ].map((x) => (
                    <th className="p-2" key={x}>
                      {x}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.items.map((s: Statement) => {
                  const v = s.versions[0];
                  return (
                    <tr key={s.id}>
                      <td className="p-2">{s.company.providerCompanyName}</td>
                      <td>
                        <button
                          className="text-emerald-300"
                          onClick={() => go({ archive: "detail", id: s.id })}
                        >
                          {v.pid} / {v.statementNumber ?? "—"}
                        </button>
                      </td>
                      <td>
                        {v.trucks
                          .map((t) => t.unit)
                          .filter(Boolean)
                          .join(", ") || "Needs review"}
                      </td>
                      <td>
                        {v.recipientName ?? v.recipientId}
                        <p>
                          {v.recipientType} · {v.role} · {v.recipientStatus}
                        </p>
                      </td>
                      <td>{money(v.grossMinor)}</td>
                      <td>{money(v.deductionsMinor)}</td>
                      <td>
                        {money(v.netPayMinor)} / {money(v.payoutMinor)}
                      </td>
                      <td>
                        {v.sourceStatus} / {s.status}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!data.items.length && (
            <p>No archived statements match these filters.</p>
          )}
          {pager(Number(data.total))}
        </>
      )}
      {view === "inventory" && data && (
        <>
          <h3>
            {data.snapshot.company.providerCompanyName} · PID{" "}
            {data.snapshot.pid}
          </h3>
          <p>
            {data.coverage.complete ? "COMPLETE" : "INCOMPLETE"} · Expected{" "}
            {data.coverage.expected} · Captured {data.coverage.captured} ·
            Missing {data.coverage.missing} · Conflicts{" "}
            {data.coverage.conflicts} · Failed {data.coverage.failed} ·
            Unexpected {data.coverage.unexpected}
          </p>
          <button
            className="btn"
            disabled={
              busy ||
              !overview?.connectionEnabled ||
              !selected.length ||
              selected.length > 5
            }
            onClick={() =>
              action({
                action: "capture",
                inventoryId: data.snapshot.id,
                itemIds: selected,
              })
            }
          >
            {busy ? "Capturing…" : "Capture / resume selected (maximum 5)"}
          </button>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm text-left [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_tr]:border-b [&_tr]:border-white/10">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Recipient</th>
                  <th>Provider identity / version</th>
                  <th>Capture</th>
                  <th>Attempt / result</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((i: Item) => (
                  <tr key={i.id}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${i.recipientName ?? i.providerStatementId}`}
                        checked={selected.includes(i.id)}
                        onChange={(e) =>
                          setSelected((s) =>
                            e.target.checked
                              ? [...s, i.id]
                              : s.filter((x) => x !== i.id),
                          )
                        }
                      />
                    </td>
                    <td>
                      {i.recipientName ?? i.recipientId} · {i.recipientType}
                    </td>
                    <td className="break-all">
                      {i.providerStatementId} / {i.providerVersion}
                    </td>
                    <td>
                      {i.statementId ? (
                        <button
                          onClick={() =>
                            go({ archive: "detail", id: i.statementId! })
                          }
                        >
                          {i.captured ? "Captured" : "Missing expected version"}{" "}
                          · {i.archiveStatus}
                        </button>
                      ) : (
                        "MISSING"
                      )}
                    </td>
                    <td>
                      {i.job.status} · {i.job.attempts} {i.job.errorCode}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pager(Number(data.coverage.expected))}
          {data.unexpected.length > 0 && (
            <div className={box}>
              <h3>Unexpected identities</h3>
              {data.unexpected.map((s) => (
                <p key={s.id}>
                  <button onClick={() => go({ archive: "detail", id: s.id })}>
                    {s.providerStatementId}
                  </button>
                </p>
              ))}
            </div>
          )}
        </>
      )}
      {view === "detail" && data?.version && (
        <>
          <div className={box}>
            <h3>
              {data.company.providerCompanyName} · PID {data.version.pid} ·
              Statement {data.version.statementNumber ?? "—"}
            </h3>
            <p>
              {data.version.recipientName ?? data.version.recipientId} ·{" "}
              {data.version.recipientType} · {data.version.recipientStatus}
            </p>
            <p>
              {data.version.workStart.slice(0, 10)} –{" "}
              {data.version.workEnd.slice(0, 10)} · {data.version.role} ·{" "}
              {data.version.contract}
            </p>
            <p>
              Gross {money(data.version.grossMinor)} · Deductions{" "}
              {money(data.version.deductionsMinor)} · Net{" "}
              {money(data.version.netPayMinor)} · Payout{" "}
              {money(data.version.payoutMinor)}
            </p>
            <p>
              Archive: {data.status}. Latest version{" "}
              {data.latestProviderVersion}; accepted version{" "}
              {data.acceptedProviderVersion}.
            </p>
            <p>
              Provenance:{" "}
              {data.version.header.archiveProvenance?.acquisition ===
              "BROWSER_EVIDENCE_V1"
                ? "Browser-submitted evidence · user attested · checksum sealed · provider UUID/version recorded"
                : "Server acquisition / legacy archive · checksum sealed"}
              .
            </p>
            {data.version.trucks.map((t) => (
              <p key={t.id}>
                Truck {t.unit ?? "unknown"} · Mapping: {t.mappingStatus}
              </p>
            ))}
            {!data.version.trucks.length && (
              <p>Truck mapping: NEEDS_REVIEW — no source Truck.</p>
            )}
            <a
              className="text-emerald-300"
              href={`/api/finance/archive?download=${data.version.id}`}
            >
              Original PDF
            </a>
            {data.status === "SOURCE_CHANGED" && (
              <button
                className="btn ml-4"
                disabled={busy}
                onClick={() =>
                  action({ action: "accept", statementId: data.id })
                }
              >
                Accept latest version after review
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-3" aria-label="Version history">
            {data.versions.map((v) => (
              <button
                key={v.id}
                onClick={() => go({ version: String(v.providerVersion) })}
              >
                Version {v.providerVersion}
              </button>
            ))}
          </div>
          <h3>Trips, earnings and deductions</h3>
          <p>
            Excluded and skipped source lines are retained for audit. They are
            not posted economics.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm text-left [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_tr]:border-b [&_tr]:border-white/10">
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Description</th>
                  <th>Amount</th>
                  <th>Included</th>
                  <th>Truck</th>
                </tr>
              </thead>
              <tbody>
                {data.version.lines.map((l) => (
                  <tr key={l.id}>
                    <td>
                      {(
                        {
                          trips: "Trip",
                          fuel_transactions: "Fuel",
                          toll_transactions: "Toll",
                          earnings: "Earning",
                          advance_deductions: "Advance deduction",
                          deductions: "Recurring deduction",
                          fixed_pays: "Fixed pay",
                          accessorials: "Accessorial",
                          salary_deductions: "Salary deduction",
                          pl_records: "P&L summary",
                        } as Record<string, string>
                      )[l.sourceArray] ?? "Other source line"}
                    </td>
                    <td>{l.description ?? "—"}</td>
                    <td>
                      {money(l.amountMinor)}
                      {l.amountMinor === null && l.rawAmount && (
                        <span> (source: {l.rawAmount}; review)</span>
                      )}
                    </td>
                    <td>
                      {l.included === null
                        ? "Unspecified"
                        : l.included
                          ? "Yes"
                          : "No"}
                    </td>
                    <td>{l.sourceUnit ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {pager(data.version._count.lines, 50)}
          <details className={box}>
            <summary>Details / Audit</summary>
            <p className="break-all">
              Provider UUID: {data.providerStatementId}
            </p>
            <p>
              Provider version: {data.version.providerVersion} · Captured:{" "}
              {data.version.capturedAt}
            </p>
            <p className="break-all">PDF SHA-256: {data.version.pdfChecksum}</p>
            <p className="break-all">
              JSON SHA-256: {data.version.detailChecksum}
            </p>
            {data.version.issues.map((x, i) => (
              <p key={i}>{x}</p>
            ))}
            {data.conflicts.map((x) => (
              <p key={x.id} className="break-all">
                Conflicting version {x.providerVersion}: {x.pdfChecksum} —
                preserved for investigation.
              </p>
            ))}
            <pre className="overflow-x-auto">
              {JSON.stringify(data.version.header, null, 2)}
            </pre>
          </details>
          <p>Fuel deduction reconciliation is not implemented.</p>
        </>
      )}
    </section>
  );
}
