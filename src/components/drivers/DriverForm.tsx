"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import ModalLayer from "@/components/ui/ModalLayer";
import type { DriverRecord } from "@/lib/drivers/types";
const defaultForm = {
  firstName: "",
  lastName: "",
  phone: "",
  email: "",
  licenseNum: "",
  payType: "PERCENTAGE",
  payRate: "",
  truckId: "",
};
export default function DriverForm({
  driver,
  onClose,
  onSaved,
}: {
  driver: DriverRecord | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState(
    driver
      ? {
          firstName: driver.firstName,
          lastName: driver.lastName,
          phone: driver.phone || "",
          email: driver.email || "",
          licenseNum: driver.licenseNum || "",
          payType: driver.payType || "PERCENTAGE",
          payRate: String(driver.payRate),
          truckId: driver.truckId || "",
        }
      : defaultForm,
  );
  const originalForm = useRef(JSON.stringify(form));
  const [trucks, setTrucks] = useState<
    { id: string; unitNumber: string; make?: string | null }[]
  >([]);
  const [error, setError] = useState("");
  const [truckError, setTruckError] = useState(false);
  const [saving, setSaving] = useState(false);
  const [trucksLoading, setTrucksLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController();
    async function loadTrucks() {
      const choices: {
        id: string;
        unitNumber: string;
        make?: string | null;
      }[] = [];
      for (let page = 1; ; page++) {
        const response = await fetch(
          `/api/trucks?view=all&format=page&pageSize=100&page=${page}`,
          { signal: controller.signal, cache: "no-store" },
        );
        if (!response.ok)
          throw new Error("Truck assignments could not be loaded.");
        const result = await response.json();
        choices.push(...result.items);
        if (page >= result.pagination.totalPages) break;
      }
      if (!controller.signal.aborted) setTrucks(choices);
    }
    loadTrucks()
      .catch(() => {
        if (!controller.signal.aborted) setTruckError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setTrucksLoading(false);
      });
    return () => controller.abort();
  }, []);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(
        driver
          ? `/api/drivers/${encodeURIComponent(driver.id)}`
          : "/api/drivers",
        {
          method: driver ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(form),
        },
      );
      if (!response.ok) {
        const failure = await response.json();
        throw new Error(failure.error || "Driver could not be saved.");
      }
      onSaved();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Driver could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }
  function close() {
    if (
      !saving &&
      (JSON.stringify(form) === originalForm.current ||
        window.confirm("Close this form? Unsaved changes will be lost."))
    )
      onClose();
  }
  const editId = driver?.id;
  return (
    <ModalLayer
      className="drivers-ui driver-form-layer"
      labelledBy="driver-form-title"
      onClose={close}
    >
      <form onSubmit={submit} className="driver-form">
        <div className="driver-form-heading">
          <h2 id="driver-form-title">
            {driver ? "Edit driver" : "Add driver"}
          </h2>
          <button
            type="button"
            aria-label="Close driver form"
            className="driver-icon-button"
            disabled={saving}
            onClick={close}
          >
            ×
          </button>
        </div>
        {error && (
          <p className="driver-alert" role="alert">
            {error}
          </p>
        )}
        {truckError && (
          <p role="alert" className="driver-alert">
            Truck choices could not be loaded. Close and reopen this form to
            retry. The existing assignment is preserved.
          </p>
        )}
        <fieldset
          disabled={saving || trucksLoading || truckError}
          className="space-y-4"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 uppercase">
                First Name *
              </label>
              <input
                aria-label="First name"
                required
                maxLength={100}
                value={form.firstName}
                onChange={(e) =>
                  setForm({ ...form, firstName: e.target.value })
                }
                className="w-full mt-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 uppercase">
                Last Name *
              </label>
              <input
                aria-label="Last name"
                required
                maxLength={100}
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                className="w-full mt-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-slate-500 uppercase">Phone</label>
              <input
                aria-label="Phone"
                maxLength={50}
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="(555) 000-0000"
                className="w-full mt-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-500 uppercase">Email</label>
              <input
                aria-label="Email"
                maxLength={254}
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full mt-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-slate-500 uppercase">
              CDL License #
            </label>
            <input
              aria-label="CDL number"
              maxLength={100}
              value={form.licenseNum}
              onChange={(e) => setForm({ ...form, licenseNum: e.target.value })}
              className="w-full mt-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="text-xs text-slate-500 uppercase">
              Assign to Truck
            </label>
            <select
              aria-label="Assign to truck"
              value={form.truckId}
              onChange={(e) => setForm({ ...form, truckId: e.target.value })}
              className="w-full mt-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="">Unassigned</option>
              {form.truckId &&
                !trucks.some((truck) => truck.id === form.truckId) && (
                  <option value={form.truckId}>
                    Current assignment (unavailable)
                  </option>
                )}
              {trucks.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.unitNumber}
                  {t.make ? ` — ${t.make}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 uppercase">
              Pay Type *
            </label>
            <select
              aria-label="Pay type"
              value={form.payType}
              onChange={(e) => setForm({ ...form, payType: e.target.value })}
              className="w-full mt-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            >
              <option value="PERCENTAGE">Percentage of Load</option>
              <option value="PER_MILE">Per Mile</option>
              <option value="FLAT">Flat Rate</option>
            </select>
          </div>
          <div>
            <label className="text-xs text-slate-500 uppercase">
              {form.payType === "PERCENTAGE"
                ? "Rate (%)"
                : form.payType === "PER_MILE"
                  ? "Rate ($/mile)"
                  : "Flat Amount ($)"}{" "}
              *
            </label>
            <input
              aria-label="Pay rate"
              required
              type="number"
              step="0.01"
              min="0"
              value={form.payRate}
              onChange={(e) => setForm({ ...form, payRate: e.target.value })}
              placeholder={
                form.payType === "PERCENTAGE"
                  ? "25"
                  : form.payType === "PER_MILE"
                    ? "0.55"
                    : "1500"
              }
              className="w-full mt-1 bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button
              disabled={saving || trucksLoading || truckError}
              className="driver-button driver-primary"
              type="submit"
            >
              {saving ? "Saving…" : editId ? "Save changes" : "Add driver"}
            </button>
            <button className="driver-button" type="button" onClick={close}>
              Cancel
            </button>
          </div>
        </fieldset>
        {(trucksLoading || truckError) && (
          <button className="driver-button" type="button" onClick={close}>
            Cancel
          </button>
        )}
        {trucksLoading && <p role="status">Loading truck choices…</p>}
      </form>
    </ModalLayer>
  );
}
