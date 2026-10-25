"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import DriverForm from "@/components/drivers/DriverForm";
import DriverProfileDrawer from "@/components/drivers/DriverProfileDrawer";
import { payLabel, type DriverRecord } from "@/lib/drivers/types";
import "./drivers.css";

function Icon({ kind }: { kind: "people" | "truck" | "duty" | "document" }) {
  const paths = {
    people:
      "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m18 0v-2a4 4 0 0 0-3-3.9M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8m8-7.9a4 4 0 0 1 0 7.8",
    truck:
      "M1 3h14v13H1zm14 5h4l3 4v4h-7M7 18a2 2 0 1 1-4 0 2 2 0 0 1 4 0m14 0a2 2 0 1 1-4 0 2 2 0 0 1 4 0",
    duty: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20m0-10V6m0 6 4 3",
    document: "M14 2H5v20h14V7zm0 0v5h5M8 12h8m-8 4h6",
  };
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={paths[kind]} />
    </svg>
  );
}
export default function DriversPage() {
  const [canEdit, setCanEdit] = useState(false);
  const [canViewCompensation, setCanViewCompensation] = useState(false);
  const [drivers, setDrivers] = useState<DriverRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [employmentFilter, setEmploymentFilter] = useState("all");
  const [expirationWindow, setExpirationWindow] = useState<30 | 60 | 90>(30);
  const [query, setQuery] = useState("");
  const [assignment, setAssignment] = useState("all");
  const [payType, setPayType] = useState("all");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [selected, setSelected] = useState<DriverRecord | null>(null);
  const [form, setForm] = useState<{ driver: DriverRecord | null } | null>(
    null,
  );
  const [notice, setNotice] = useState("");
  const loadDrivers = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError("");
    setDrivers([]);
    setSelected(null);
    try {
      const response = await fetch("/api/drivers", {
        cache: "no-store",
        signal,
      });
      if (!response.ok)
        throw new Error(
          response.status === 401
            ? "Sign in to view your company’s drivers."
            : response.status === 403
              ? "You do not have permission to view drivers."
              : "Drivers could not be loaded. Please try again.",
        );
      const records = await response.json();
      setCanEdit(response.headers.get("X-Drivers-Can-Edit") !== "false");
      setCanViewCompensation(
        response.headers.get("X-Drivers-Can-View-Compensation") !== "false",
      );
      if (!Array.isArray(records))
        throw new Error("The driver response was invalid.");
      if (!signal?.aborted) setDrivers(records);
    } catch (error) {
      if (!signal?.aborted)
        setError(
          error instanceof Error
            ? error.message
            : "Drivers could not be loaded.",
        );
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void loadDrivers(controller.signal);
    return () => controller.abort();
  }, [loadDrivers]);
  const filtered = useMemo(
    () =>
      drivers
        .filter((driver) => {
          const haystack = [
            driver.firstName,
            driver.lastName,
            driver.email,
            driver.phone,
            driver.licenseNum,
            driver.id,
            driver.truck?.unitNumber,
          ]
            .join(" ")
            .toLowerCase();
          return (
            haystack.includes(query.trim().toLowerCase()) &&
            (employmentFilter === "all" ||
              (employmentFilter === "UNKNOWN"
                ? !driver.employmentStatus
                : driver.employmentStatus === employmentFilter)) &&
            (assignment === "all" ||
              (assignment === "assigned"
                ? !!driver.truck || !!driver.assignmentRestricted
                : !driver.truck && !driver.assignmentRestricted)) &&
            (payType === "all" || driver.payType === payType)
          );
        })
        .sort((a, b) =>
          sort === "newest"
            ? b.createdAt.localeCompare(a.createdAt)
            : sort === "truck"
              ? (a.truck?.unitNumber || "").localeCompare(
                  b.truck?.unitNumber || "",
                  undefined,
                  { numeric: true },
                )
              : `${a.lastName} ${a.firstName}`.localeCompare(
                  `${b.lastName} ${b.firstName}`,
                ),
        ),
    [drivers, query, assignment, payType, sort, employmentFilter],
  );
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const visible = filtered.slice(
    (currentPage - 1) * pageSize,
    currentPage * pageSize,
  );
  const assignedCount = drivers.filter(
    (driver) => driver.truck || driver.assignmentRestricted,
  ).length;
  function resetFilters() {
    setQuery("");
    setEmploymentFilter("all");
    setAssignment("all");
    setPayType("all");
    setSort("name");
    setPage(1);
  }
  const count = (value: number) =>
    loading || error ? "—" : value.toLocaleString();
  return (
    <main className="drivers-ui drivers-page">
      <div className="drivers-heading">
        <div>
          <h1>Drivers</h1>
          <p>Manage driver profiles, documents, assignments, and more.</p>
        </div>
        <button
          className="driver-button driver-primary"
          disabled={!canEdit || loading || !!error}
          onClick={() => setForm({ driver: null })}
        >
          <span aria-hidden="true">＋</span> Add Driver
        </button>
      </div>
      <section className="driver-summary" aria-label="Driver summary">
        {[
          {
            label: "Total Drivers",
            value: count(drivers.length),
            help: "Selected company",
            icon: "people" as const,
            color: "blue",
          },
          {
            label: "Assigned to Truck",
            value: count(assignedCount),
            help: "Current truck relationships",
            icon: "truck" as const,
            color: "green",
          },
          {
            label: "Unassigned Drivers",
            value: count(drivers.length - assignedCount),
            help: "No current truck relationship",
            icon: "people" as const,
            color: "slate",
          },
          {
            label: "On Duty / Off Duty",
            value: "—",
            help: "Duty data not connected",
            icon: "duty" as const,
            color: "blue",
          },
          {
            label: "Documents Expiring",
            value: count(
              drivers.reduce(
                (sum, driver) =>
                  sum +
                  (driver.documentAlerts?.[`within${expirationWindow}`] || 0),
                0,
              ),
            ),
            help: `Within ${expirationWindow} days · ${drivers.reduce((sum, driver) => sum + (driver.documentAlerts?.expired || 0), 0)} expired`,
            icon: "document" as const,
            color: "red",
          },
        ].map((card) => (
          <article className="driver-summary-card" key={card.label}>
            <span className={`driver-summary-icon ${card.color}`}>
              <Icon kind={card.icon} />
            </span>
            <div>
              <h2>{card.label}</h2>
              <strong>{card.value}</strong>
              <p>{card.help}</p>
            </div>
          </article>
        ))}
      </section>
      {notice && (
        <div role="status" className="driver-success">
          {notice}
          <button
            aria-label="Dismiss confirmation"
            onClick={() => setNotice("")}
          >
            ×
          </button>
        </div>
      )}
      <section className="driver-roster" aria-label="Driver roster">
        <div
          className="driver-roster-tabs"
          role="group"
          aria-label="Truck assignment filter"
        >
          {[
            ["all", "All Drivers"],
            ["assigned", "Assigned"],
            ["unassigned", "Unassigned"],
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={assignment === value}
              className={assignment === value ? "selected" : ""}
              onClick={() => {
                setAssignment(value);
                setPage(1);
              }}
            >
              {label}
              {!loading && !error && (
                <span>
                  {value === "all"
                    ? drivers.length
                    : value === "assigned"
                      ? assignedCount
                      : drivers.length - assignedCount}
                </span>
              )}
            </button>
          ))}
        </div>
        <div className="driver-filters">
          <label className="driver-search">
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="Search drivers"
              type="search"
              placeholder="Search by name, driver ID, CDL, or truck…"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Employment
            <select
              aria-label="Filter employment status"
              value={employmentFilter}
              onChange={(e) => {
                setEmploymentFilter(e.target.value);
                setPage(1);
              }}
            >
              <option value="all">All employment</option>
              <option value="ACTIVE">Active</option>
              <option value="INACTIVE">Inactive</option>
              <option value="TERMINATED">Terminated</option>
              <option value="ON_LEAVE">On Leave</option>
              <option value="UNKNOWN">Not recorded</option>
            </select>
          </label>
          <label>
            Expiration window
            <select
              aria-label="Expiration window"
              value={expirationWindow}
              onChange={(e) =>
                setExpirationWindow(Number(e.target.value) as 30 | 60 | 90)
              }
            >
              <option value="30">30 days</option>
              <option value="60">60 days</option>
              <option value="90">90 days</option>
            </select>
          </label>
          <label>
            Pay agreement
            <select
              aria-label="Filter by pay type"
              disabled={!canViewCompensation}
              value={payType}
              onChange={(event) => {
                setPayType(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All pay types</option>
              <option value="PERCENTAGE">Percentage</option>
              <option value="PER_MILE">Per mile</option>
              <option value="FLAT">Flat rate</option>
            </select>
          </label>
          <label>
            Sort by
            <select
              aria-label="Sort drivers"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(1);
              }}
            >
              <option value="name">Last name A–Z</option>
              <option value="newest">Newest first</option>
              <option value="truck">Truck number</option>
            </select>
          </label>
          <button className="driver-button" onClick={resetFilters}>
            Reset filters
          </button>
        </div>
        {loading ? (
          <div className="driver-empty" role="status">
            <div className="driver-loading-bar" />
            <h3>Loading drivers…</h3>
            <p>Retrieving records for your selected company.</p>
          </div>
        ) : error ? (
          <div className="driver-empty" role="alert">
            <h3>Drivers unavailable</h3>
            <p>{error}</p>
            <button
              className="driver-button"
              onClick={() => void loadDrivers()}
            >
              Try again
            </button>
          </div>
        ) : visible.length ? (
          <div className="driver-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Driver</th>
                  <th>Employment / assignment</th>
                  <th>Truck</th>
                  <th>Contact</th>
                  <th>Pay agreement</th>
                  <th>CDL</th>
                  <th>
                    <span className="sr-only">Profile</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.map((driver) => (
                  <tr key={driver.id} onClick={() => setSelected(driver)}>
                    <td>
                      <button
                        className="driver-name-button"
                        onClick={() => setSelected(driver)}
                        aria-label={`Open profile for ${driver.firstName} ${driver.lastName}`}
                      >
                        <span className="driver-avatar">
                          {driver.firstName[0]}
                          {driver.lastName[0]}
                        </span>
                        <span>
                          <strong>
                            {driver.firstName} {driver.lastName}
                          </strong>
                          <small>#{driver.id.slice(-8)}</small>
                        </span>
                      </button>
                    </td>
                    <td>
                      {driver.employmentStatus && (
                        <div>
                          <span className="driver-badge blue">
                            {driver.employmentStatus.replaceAll("_", " ")}
                          </span>
                        </div>
                      )}
                      <span
                        className={`driver-badge ${driver.truck ? "green" : ""}`}
                      >
                        {driver.assignmentRestricted
                          ? "Needs assignment review"
                          : driver.truck
                            ? "Assigned"
                            : "Unassigned"}
                      </span>
                    </td>
                    <td>{driver.truck?.unitNumber || "—"}</td>
                    <td>
                      {driver.phone || "No phone recorded"}
                      <small>{driver.email || "No email recorded"}</small>
                    </td>
                    <td>{payLabel(driver)}</td>
                    <td>{driver.licenseNum ? "Recorded" : "Not recorded"}</td>
                    <td>
                      <span aria-hidden="true" className="driver-chevron">
                        ›
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="driver-empty">
            <span className="driver-empty-icon" aria-hidden="true">
              <Icon kind="people" />
            </span>
            <h3>
              {drivers.length
                ? "No drivers match your filters"
                : "No drivers yet"}
            </h3>
            <p>
              {drivers.length
                ? "Try another name, CDL number, truck, or pay type."
                : "Add a driver to start managing profiles and assignments."}
            </p>
            {drivers.length > 0 && (
              <button className="driver-button" onClick={resetFilters}>
                Clear filters
              </button>
            )}
          </div>
        )}
        <footer className="driver-roster-footer">
          <p>
            {loading || error
              ? "Driver records unavailable"
              : `Showing ${filtered.length ? (currentPage - 1) * pageSize + 1 : 0}–${Math.min(currentPage * pageSize, filtered.length)} of ${filtered.length} drivers`}
          </p>
          <div className="driver-pagination">
            <button
              className="driver-button"
              aria-label="Previous page"
              disabled={currentPage <= 1 || loading || !!error}
              onClick={() => setPage(currentPage - 1)}
            >
              ‹
            </button>
            <span>
              Page {currentPage} of {totalPages}
            </span>
            <button
              className="driver-button"
              aria-label="Next page"
              disabled={currentPage >= totalPages || loading || !!error}
              onClick={() => setPage(currentPage + 1)}
            >
              ›
            </button>
          </div>
          <label>
            Show
            <select
              aria-label="Drivers per page"
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(1);
              }}
            >
              {[8, 25, 50].map((size) => (
                <option key={size} value={size}>
                  {size} per page
                </option>
              ))}
            </select>
          </label>
        </footer>
      </section>
      <p className="driver-data-note">
        Assignment indicates a linked truck. Employment status is recorded
        separately; duty data is not connected. Document alerts are an internal
        tracking aid, not a legal compliance determination.
      </p>
      {selected && (
        <DriverProfileDrawer
          key={selected.id}
          driver={selected}
          onDataChanged={() => {
            void fetch("/api/drivers", { cache: "no-store" })
              .then(async (response) => {
                if (response.ok) setDrivers(await response.json());
              })
              .catch(() =>
                setNotice(
                  "Saved. Refresh the dashboard to update document counts.",
                ),
              );
          }}
          onClose={() => setSelected(null)}
          onEdit={(driver) => {
            setSelected(null);
            setForm({ driver });
          }}
        />
      )}
      {form && (
        <DriverForm
          driver={form.driver}
          onClose={() => setForm(null)}
          onSaved={() => {
            setForm(null);
            setNotice("Driver saved successfully.");
            void loadDrivers();
          }}
        />
      )}
    </main>
  );
}
