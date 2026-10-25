"use client";
import { useEffect, useRef, useState } from "react";
import DriverDocumentsPanel from "./DriverDocumentsPanel";
import DriverQualificationPanel from "./DriverQualificationPanel";
import DriverActivityPanel from "./DriverActivityPanel";
import { documentLabels } from "@/lib/drivers/qualification";
import ModalLayer from "@/components/ui/ModalLayer";
import {
  displayDate,
  payLabel,
  type DriverProfile,
  type DriverRecord,
} from "@/lib/drivers/types";

const tabs = [
  "Overview",
  "Documents",
  "Assignments & Trips",
  "Pay & Settlements",
  "Safety",
  "Notes & Files",
] as const;
type Tab = (typeof tabs)[number];
const currency = (amount: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    amount,
  );
function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="driver-field">
      <dt>{label}</dt>
      <dd>{children || "Not recorded"}</dd>
    </div>
  );
}
function Missing({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="driver-empty">
      <span className="driver-empty-icon" aria-hidden="true">
        ◇
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export default function DriverProfileDrawer({
  driver,
  onClose,
  onEdit,
  onDataChanged,
}: {
  driver: DriverRecord;
  onClose: () => void;
  onEdit: (driver: DriverRecord) => void;
  onDataChanged?: () => void;
}) {
  const [profile, setProfile] = useState<DriverProfile | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/drivers/${encodeURIComponent(driver.id)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Profile could not be loaded.");
        return response.json();
      })
      .then(setProfile)
      .catch((error) => {
        if (!controller.signal.aborted) setError(error.message);
      });
    return () => controller.abort();
  }, [driver.id, attempt]);
  function changed() {
    setAttempt((value) => value + 1);
    onDataChanged?.();
  }
  return (
    <ModalLayer
      className="drivers-ui driver-drawer-layer"
      labelledBy="driver-profile-title"
      onClose={onClose}
      initialFocusRef={closeRef}
    >
      <button
        className="driver-drawer-backdrop"
        aria-label="Dismiss driver profile"
        onClick={onClose}
        tabIndex={-1}
      />
      <aside className="driver-drawer">
        <header className="driver-profile-header">
          <div className="driver-profile-toolbar">
            <span>DRIVER PROFILE</span>
            <button
              ref={closeRef}
              className="driver-icon-button"
              aria-label="Close driver profile"
              onClick={onClose}
            >
              ×
            </button>
          </div>
          <div className="driver-profile-identity">
            <span className="driver-avatar driver-avatar-large">
              {driver.firstName[0]}
              {driver.lastName[0]}
            </span>
            <div>
              <h2 id="driver-profile-title">
                {driver.firstName} {driver.lastName}
              </h2>
              <p>Driver record · {driver.id.slice(-8)}</p>
              <span className={`driver-badge ${driver.truck ? "blue" : ""}`}>
                {driver.assignmentRestricted
                  ? "Assignment needs review"
                  : driver.truck
                    ? `Truck ${driver.truck.unitNumber}`
                    : "No truck assigned"}
              </span>
            </div>
          </div>
          <button
            disabled={driver.assignmentRestricted || driver.canEdit === false}
            className="driver-button driver-edit"
            onClick={() => onEdit(driver)}
          >
            Edit driver
          </button>
        </header>
        {driver.assignmentRestricted && (
          <div className="driver-alert">
            This record has a truck assignment outside the selected company.
            Editing is blocked until the existing mapping is reviewed.
          </div>
        )}
        <div
          className="driver-tabs"
          role="tablist"
          aria-label="Driver profile sections"
        >
          {tabs.map((label, index) => (
            <button
              key={label}
              role="tab"
              id={`driver-tab-${index}`}
              aria-controls="driver-tab-panel"
              aria-selected={tab === label}
              tabIndex={tab === label ? 0 : -1}
              onClick={() => setTab(label)}
              onKeyDown={(event) => {
                if (
                  !["ArrowLeft", "ArrowRight", "Home", "End"].includes(
                    event.key,
                  )
                )
                  return;
                event.preventDefault();
                const next =
                  event.key === "Home"
                    ? 0
                    : event.key === "End"
                      ? tabs.length - 1
                      : (index +
                          (event.key === "ArrowRight" ? 1 : -1) +
                          tabs.length) %
                        tabs.length;
                setTab(tabs[next]);
                document.getElementById(`driver-tab-${next}`)?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div
          className="driver-profile-body"
          role="tabpanel"
          id="driver-tab-panel"
          aria-labelledby={`driver-tab-${tabs.indexOf(tab)}`}
          tabIndex={0}
        >
          {error ? (
            <div role="alert" className="driver-alert">
              {error}{" "}
              <button
                onClick={() => {
                  setError("");
                  setAttempt(attempt + 1);
                }}
              >
                Try again
              </button>
            </div>
          ) : !profile ? (
            <p role="status">Loading driver profile…</p>
          ) : (
            <>
              {tab === "Overview" && (
                <>
                  <h3>Contact information</h3>
                  <dl className="driver-field-grid">
                    <Field label="Phone">
                      {profile.phone ? (
                        <a href={`tel:${profile.phone}`}>{profile.phone}</a>
                      ) : null}
                    </Field>
                    <Field label="Email">
                      {profile.email ? (
                        <a href={`mailto:${profile.email}`}>{profile.email}</a>
                      ) : null}
                    </Field>
                    <Field label="Company">{profile.company?.name}</Field>
                    <Field label="Assigned truck">
                      {profile.assignmentRestricted
                        ? "Assignment needs review"
                        : profile.truck?.unitNumber || "Unassigned"}
                    </Field>
                  </dl>
                  <h3>Pay agreement</h3>
                  <dl className="driver-field-grid">
                    <Field label="Pay type">
                      {profile.payType?.replaceAll("_", " ") || "Restricted"}
                    </Field>
                    <Field label="Agreed rate">{payLabel(profile)}</Field>
                  </dl>
                  <h3>Driver information</h3>
                  <dl className="driver-field-grid">
                    <Field label="CDL number">{profile.licenseNum}</Field>
                    <Field label="Record created">
                      {displayDate(profile.createdAt)}
                    </Field>
                  </dl>
                  <h3>Employment & team</h3>
                  <dl className="driver-field-grid">
                    <Field label="Employment status">
                      {profile.employmentStatus?.replaceAll("_", " ") ||
                        "Not recorded"}
                    </Field>
                    <Field label="Driver type">
                      {profile.driverType?.replaceAll("_", " ") ||
                        "Not recorded"}
                    </Field>
                    <Field label="Employment start">
                      {displayDate(profile.employmentStartDate || null)}
                    </Field>
                    <Field label="Termination date">
                      {displayDate(profile.terminationDate || null)}
                    </Field>
                    <Field label="Home terminal">{profile.homeTerminal}</Field>
                    <Field label="Driver team">
                      {profile.team?.name || "Unassigned"}
                    </Field>
                    <Field label="Emergency contact">
                      {profile.canReadDocuments === false
                        ? "Restricted"
                        : profile.emergencyContactName}
                    </Field>
                    <Field label="Emergency phone / relationship">
                      {profile.canReadDocuments === false
                        ? "Restricted"
                        : [
                            profile.emergencyContactPhone,
                            profile.emergencyContactRelation,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                    </Field>
                  </dl>
                  <p className="driver-info">
                    Employment status is separate from ELD duty status. Duty
                    data is not connected.
                  </p>
                  {profile.documentAlerts && (
                    <section className="driver-alert-summary">
                      <h3>Document alerts</h3>
                      <div className="driver-field-grid">
                        <Field label="Expired">
                          {String(profile.documentAlerts.expired)}
                        </Field>
                        <Field label="Expiring within 30 / 60 / 90 days">{`${profile.documentAlerts.within30} / ${profile.documentAlerts.within60} / ${profile.documentAlerts.within90}`}</Field>
                      </div>
                      <p className="driver-muted">
                        Missing from the internal checklist:{" "}
                        {profile.documentAlerts.missingRequired
                          .map(
                            (type) =>
                              documentLabels[
                                type as keyof typeof documentLabels
                              ],
                          )
                          .join(", ") || "None"}
                        . Counts use current versions only; 30/60/90-day windows
                        are cumulative. Files do not establish compliance.
                      </p>
                    </section>
                  )}
                  <h3>
                    Recent assignments{" "}
                    <button
                      className="driver-text-button"
                      onClick={() => setTab("Assignments & Trips")}
                    >
                      View trips →
                    </button>
                  </h3>
                  {profile.loads.length ? (
                    profile.loads.slice(0, 2).map((load) => (
                      <article key={load.id} className="driver-trip">
                        <div>
                          <strong>Load #{load.loadNumber}</strong>
                          <span className="driver-badge blue">
                            {load.status.replaceAll("_", " ")}
                          </span>
                        </div>
                        <p>
                          {load.origin} → {load.destination}
                        </p>
                        <small>
                          Pickup {displayDate(load.pickupDate)} · Delivery{" "}
                          {displayDate(load.deliveryDate)}
                        </small>
                      </article>
                    ))
                  ) : (
                    <Missing title="No linked loads">
                      No dispatch loads are linked to this driver in the
                      selected company.
                    </Missing>
                  )}
                </>
              )}
              {tab === "Documents" &&
                (profile.canReadDocuments === false ? (
                  <Missing title="Document access restricted">
                    Private documents and CDL details are limited to authorized
                    fleet/safety readers and administrators.
                  </Missing>
                ) : (
                  <DriverDocumentsPanel
                    driverId={driver.id}
                    canEdit={driver.canEdit !== false}
                    onChanged={changed}
                  />
                ))}
              {tab === "Assignments & Trips" && (
                <>
                  <h3>Assignments & trips</h3>
                  <p className="driver-muted">
                    Latest 100 linked loads · selected company only
                  </p>
                  <dl className="driver-field-grid">
                    <Field label="Current truck assignment">
                      {profile.assignmentRestricted
                        ? "Assignment needs review"
                        : profile.truck?.unitNumber || "Unassigned"}
                    </Field>
                    <Field label="Assignment history">
                      Not recorded separately
                    </Field>
                  </dl>
                  {profile.loads.length ? (
                    <div className="driver-table-scroll">
                      <table>
                        <thead>
                          <tr>
                            <th>Load / route</th>
                            <th>Status</th>
                            <th>Dates / miles</th>
                            <th>Truck</th>
                          </tr>
                        </thead>
                        <tbody>
                          {profile.loads.map((load) => (
                            <tr key={load.id}>
                              <td>
                                <strong>#{load.loadNumber}</strong>
                                <small>
                                  {load.origin} → {load.destination}
                                </small>
                              </td>
                              <td>
                                <span className="driver-badge blue">
                                  {load.status.replaceAll("_", " ")}
                                </span>
                              </td>
                              <td>
                                {displayDate(load.pickupDate)}
                                <small>
                                  Delivery {displayDate(load.deliveryDate)}
                                </small>
                                <small>
                                  {load.miles == null
                                    ? "Mileage not recorded"
                                    : `${load.miles.toLocaleString()} mi`}
                                </small>
                              </td>
                              <td>{load.truck?.unitNumber || "Unassigned"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <Missing title="No trips yet">
                      Linked dispatch loads will appear here when available.
                    </Missing>
                  )}
                  {profile.canEdit !== false && (
                    <a className="driver-link" href="/dispatch">
                      Open Dispatch →
                    </a>
                  )}
                </>
              )}
              {tab === "Pay & Settlements" &&
                profile.canViewCompensation === false && (
                  <Missing title="Compensation access restricted">
                    Your Drivers access is read-only and does not include pay
                    agreements or settlements.
                  </Missing>
                )}
              {tab === "Pay & Settlements" &&
                profile.canViewCompensation !== false && (
                  <>
                    <h3>Pay & settlements</h3>
                    <dl className="driver-field-grid">
                      <Field label="Pay agreement">{payLabel(profile)}</Field>
                      <Field label="Payment source">
                        Existing settlement records
                      </Field>
                    </dl>
                    <p className="driver-muted">
                      Latest 100 settlements · selected company only. Paid
                      status reflects the recorded settlement flag.
                    </p>
                    {profile.settlements.length ? (
                      <div className="driver-table-scroll">
                        <table>
                          <thead>
                            <tr>
                              <th>Week ending</th>
                              <th>Driver pay</th>
                              <th>Deductions</th>
                              <th>Net pay</th>
                              <th>Payment</th>
                            </tr>
                          </thead>
                          <tbody>
                            {profile.settlements.map((settlement) => (
                              <tr key={settlement.id}>
                                <td>{displayDate(settlement.weekEnding)}</td>
                                <td>{currency(settlement.driverPay)}</td>
                                <td>
                                  {currency(
                                    settlement.fuelDeduction +
                                      settlement.otherDeductions,
                                  )}
                                  <small>
                                    Fuel {currency(settlement.fuelDeduction)}
                                    <br />
                                    Other {currency(settlement.otherDeductions)}
                                  </small>
                                </td>
                                <td>
                                  <strong>{currency(settlement.netPay)}</strong>
                                </td>
                                <td>
                                  <span
                                    className={`driver-badge ${settlement.isPaid ? "green" : ""}`}
                                  >
                                    {settlement.isPaid ? "Paid" : "Unpaid"}
                                  </span>
                                  <small>
                                    {settlement.paidAt
                                      ? displayDate(settlement.paidAt)
                                      : "No payment date"}
                                  </small>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Missing title="No linked settlements">
                        There are no settlement records linked to this driver in
                        the selected company.
                      </Missing>
                    )}
                    <a className="driver-link" href="/settlements">
                      Open Settlements →
                    </a>
                  </>
                )}
              {tab === "Safety" && profile.canReadDocuments !== false && (
                <DriverQualificationPanel
                  driverId={driver.id}
                  canEdit={driver.canEdit !== false}
                  onChanged={changed}
                />
              )}
              {tab === "Safety" && (
                <>
                  <h3>Safety & qualification</h3>
                  <div className="driver-info">
                    Incident history and safety scores belong to the future
                    Fleet → Safety module. Orientation completion and
                    qualification files do not establish compliance.
                  </div>
                  <h3>Orientation records</h3>
                  {profile.driverOrientations.length ? (
                    profile.driverOrientations.map((orientation) => (
                      <article className="driver-trip" key={orientation.id}>
                        <strong>Orientation recorded</strong>
                        <p>
                          {displayDate(orientation.completedAt)} ·{" "}
                          {orientation.completedBy}
                        </p>
                        {orientation.notes && <p>{orientation.notes}</p>}
                      </article>
                    ))
                  ) : (
                    <Missing title="No orientation records">
                      No orientation records are linked to this driver.
                    </Missing>
                  )}
                </>
              )}
              {tab === "Notes & Files" && (
                <>
                  <h3>Notes & files</h3>
                  {profile.driverOrientations
                    .filter((orientation) => orientation.notes)
                    .map((orientation) => (
                      <article className="driver-trip" key={orientation.id}>
                        <strong>
                          Orientation note ·{" "}
                          {displayDate(orientation.completedAt)}
                        </strong>
                        <p className="whitespace-pre-wrap">
                          {orientation.notes}
                        </p>
                      </article>
                    ))}
                  {profile.canReadDocuments !== false ? (
                    <DriverActivityPanel driverId={driver.id} />
                  ) : (
                    <p className="driver-info">
                      Private documents and audit history require authorized
                      fleet/safety access.
                    </p>
                  )}
                  <p className="driver-muted">
                    Driver files are managed in Documents. Existing orientation
                    notes are preserved above.
                  </p>
                  <dl className="driver-field-grid">
                    <Field label="Record created">
                      {displayDate(profile.createdAt)}
                    </Field>
                    <Field label="Last record update">
                      {displayDate(profile.updatedAt)}
                    </Field>
                  </dl>
                </>
              )}
            </>
          )}
        </div>
      </aside>
    </ModalLayer>
  );
}
