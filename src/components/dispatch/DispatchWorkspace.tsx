'use client';

import {
  DndContext,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { TrailerVinStatus } from './TrailerVinStatus';

type Status =
  | 'DRAFT'
  | 'PLANNED'
  | 'ASSIGNED'
  | 'DISPATCHED'
  | 'PICKED_UP'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'POD_UPLOADED'
  | 'INVOICED'
  | 'PAID';

type Customer = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  contacts: Array<{ id: string; name: string; email: string | null; phone: string | null }>;
};

type Trailer = {
  id: string;
  unitNumber: string;
  equipmentType: string;
  status: string;
  vin: string | null;
  plate: string | null;
  state: string | null;
  notes: string | null;
  assignment: { loadNumber: string } | null;
  documents: Array<{ id: string; type: string; displayFilename: string }>;
};

type Load = {
  id: string;
  loadNumber: string;
  referenceNum: string | null;
  status: Status | 'PENDING' | 'CANCELLED';
  origin: string;
  destination: string;
  pickupDate: string | null;
  deliveryDate: string | null;
  rate: number;
  fuelSurcharge: number | null;
  truckId: string | null;
  driverId: string | null;
  trailerId: string | null;
  customerId: string | null;
  invoiceNumber: string | null;
  updatedAt: string;
  truck: { id: string; unitNumber: string } | null;
  driver: { id: string; firstName: string; lastName: string } | null;
  trailer: Trailer | null;
  customer: Customer | null;
  stops: Array<{
    id: string;
    type: 'PICKUP' | 'DELIVERY';
    order: number;
    facilityName: string;
    city: string;
    state: string | null;
    appointmentStart: string | null;
    appointmentEnd: string | null;
  }>;
  documents: Array<{ id: string; type: string; displayFilename: string }>;
  exceptions?: string[];
};

type Board = { columns: Array<{ status: Status; loads: Load[] }> };
type Truck = { id: string; unitNumber: string };
type Driver = { id: string; firstName: string; lastName: string };

const statusLabel: Record<Status, string> = {
  DRAFT: 'Draft',
  PLANNED: 'Planned',
  ASSIGNED: 'Assigned',
  DISPATCHED: 'Dispatched',
  PICKED_UP: 'Picked up',
  IN_TRANSIT: 'In transit',
  DELIVERED: 'Delivered',
  POD_UPLOADED: 'POD uploaded',
  INVOICED: 'Invoiced',
  PAID: 'Paid',
};

const nextStatus: Partial<Record<Status, Status>> = {
  DRAFT: 'PLANNED',
  PLANNED: 'ASSIGNED',
  ASSIGNED: 'DISPATCHED',
  DISPATCHED: 'PICKED_UP',
  PICKED_UP: 'IN_TRANSIT',
  IN_TRANSIT: 'DELIVERED',
  DELIVERED: 'POD_UPLOADED',
  POD_UPLOADED: 'INVOICED',
  INVOICED: 'PAID',
};

const emptyLoad = {
  loadNumber: '',
  referenceNum: '',
  rate: '',
  fuelSurcharge: '',
  customerId: '',
  truckId: '',
  driverId: '',
  trailerId: '',
  invoiceNumber: '',
  notes: '',
  stops: [
    { type: 'PICKUP', facilityName: '', city: '', state: '', appointmentStart: '' },
    { type: 'DELIVERY', facilityName: '', city: '', state: '', appointmentStart: '' },
  ],
};

function Column({
  status,
  loads,
  onOpen,
}: {
  status: Status;
  loads: Load[];
  onOpen: (load: Load) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <section
      ref={setNodeRef}
      aria-label={`${statusLabel[status]} loads`}
      className={`min-h-44 w-72 shrink-0 rounded-xl border p-3 ${
        isOver ? 'border-blue-400 bg-blue-500/10' : 'border-gray-800 bg-gray-900'
      }`}
    >
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold">{statusLabel[status]}</h2>
        <span className="rounded bg-gray-800 px-2 py-0.5 text-xs text-gray-400">
          {loads.length}
        </span>
      </div>
      <div className="space-y-2">
        {loads.map((load) => (
          <LoadCard key={load.id} load={load} onOpen={onOpen} />
        ))}
        {!loads.length && (
          <p className="py-8 text-center text-xs text-gray-600">Drop a load here</p>
        )}
      </div>
    </section>
  );
}

function LoadCard({ load, onOpen }: { load: Load; onOpen: (load: Load) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: load.id,
  });
  return (
    <button
      ref={setNodeRef}
      type="button"
      data-load-id={load.id}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(load)}
      style={{
        transform: transform
          ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
          : undefined,
        opacity: isDragging ? 0.55 : 1,
      }}
      className="w-full touch-none rounded-lg border border-gray-700 bg-gray-950 p-3 text-left hover:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-sm font-semibold text-blue-300">
          {load.loadNumber}
        </span>
        {!!load.exceptions?.length && (
          <span
            title={load.exceptions.join(', ')}
            aria-label={`${load.exceptions.length} exceptions`}
            className="text-amber-300"
          >
            ⚠
          </span>
        )}
      </div>
      <p className="mt-2 truncate text-xs text-gray-300">
        {load.origin || 'Origin pending'} → {load.destination || 'Destination pending'}
      </p>
      <p className="mt-2 text-xs text-gray-500">
        {load.driver
          ? `${load.driver.firstName} ${load.driver.lastName}`
          : 'Driver unassigned'}
        {' · '}
        {load.truck?.unitNumber ?? 'No truck'}
        {' · '}
        {load.trailer?.unitNumber ?? 'No trailer'}
      </p>
    </button>
  );
}

export default function DispatchWorkspace() {
  const searchParams = useSearchParams();
  const requestedView = searchParams.get('view');
  const initialView =
    requestedView === 'loads' ||
    requestedView === 'customers' ||
    requestedView === 'trailers'
      ? requestedView
      : 'dispatch';
  const [board, setBoard] = useState<Board>({ columns: [] });
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [trailers, setTrailers] = useState<Trailer[]>([]);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [drivers, setDrivers] = useState<Driver[]>([]);
  const [query, setQuery] = useState('');
  const [exception, setException] = useState('');
  const [view, setView] = useState(initialView);
  const [editingLoad, setEditingLoad] = useState<Load | null>(null);
  const [loadForm, setLoadForm] = useState(emptyLoad);
  const [showLoadForm, setShowLoadForm] = useState(false);
  const [error, setError] = useState('');
  const [documentType, setDocumentType] = useState('POD');
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [editingTrailerVinId, setEditingTrailerVinId] = useState<string | null>(null);
  const [trailerVinDraft, setTrailerVinDraft] = useState('');
  const sensors = useSensors(useSensor(PointerSensor));

  async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Request failed.');
    return body;
  }

  async function refresh(search = query) {
    const [nextBoard, nextCustomers, nextTrailers, nextTrucks, nextDrivers] =
      await Promise.all([
        fetchJson<Board>(
          `/api/dispatch/board?q=${encodeURIComponent(search)}&exception=${encodeURIComponent(exception)}`,
        ),
        fetchJson<Customer[]>('/api/customers'),
        fetchJson<Trailer[]>('/api/trailers'),
        fetchJson<Truck[]>('/api/trucks'),
        fetchJson<Driver[]>('/api/drivers'),
      ]);
    setBoard(nextBoard);
    setCustomers(nextCustomers);
    setTrailers(nextTrailers);
    setTrucks(nextTrucks);
    setDrivers(nextDrivers);
  }

  useEffect(() => {
    refresh('').catch((caught: Error) => setError(caught.message));
    // The initial request intentionally excludes the mutable search value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    setView(initialView);
  }, [initialView]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      refresh(query).catch((caught: Error) => setError(caught.message));
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, exception]);

  const allLoads = useMemo(
    () => board.columns.flatMap(({ loads }) => loads),
    [board],
  );

  async function moveLoad(loadId: string, to: Status) {
    const load = allLoads.find(({ id }) => id === loadId);
    if (!load || load.status === to) return;
    const from = load.status === 'PENDING' ? 'DRAFT' : load.status;
    if (nextStatus[from as Status] !== to) {
      setError(`Loads must move one step at a time from ${from}.`);
      return;
    }
    const snapshot = board;
    setBoard({
      columns: board.columns.map((column) => ({
        ...column,
        loads:
          column.status === from
            ? column.loads.filter(({ id }) => id !== loadId)
            : column.status === to
              ? [...column.loads, { ...load, status: to }]
              : column.loads,
      })),
    });
    try {
      await fetchJson(`/api/loads/${loadId}/transition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: to, expectedUpdatedAt: load.updatedAt }),
      });
      await refresh();
    } catch (caught) {
      setBoard(snapshot);
      setError(caught instanceof Error ? caught.message : 'Move failed.');
    }
  }

  async function onDragEnd(event: DragEndEvent) {
    if (event.over) await moveLoad(String(event.active.id), event.over.id as Status);
  }

  function openLoad(load?: Load) {
    setEditingLoad(load ?? null);
    setLoadForm(
      load
        ? {
            loadNumber: load.loadNumber,
            referenceNum: load.referenceNum ?? '',
            rate: String(load.rate),
            fuelSurcharge: String(load.fuelSurcharge ?? 0),
            customerId: load.customerId ?? '',
            truckId: load.truckId ?? '',
            driverId: load.driverId ?? '',
            trailerId: load.trailerId ?? '',
            invoiceNumber: load.invoiceNumber ?? '',
            notes: '',
            stops: load.stops.map((stop) => ({
              type: stop.type,
              facilityName: stop.facilityName,
              city: stop.city,
              state: stop.state ?? '',
              appointmentStart: stop.appointmentStart?.slice(0, 16) ?? '',
            })),
          }
        : emptyLoad,
    );
    setShowLoadForm(true);
  }

  async function saveLoad(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    const status = editingLoad?.status === 'PENDING'
      ? 'PENDING'
      : editingLoad?.status ?? 'DRAFT';
    const payload = {
      ...loadForm,
      status,
      stops: loadForm.stops.map((stop, order) => ({
        ...stop,
        order,
        appointmentStart: stop.appointmentStart || null,
      })),
    };
    try {
      await fetchJson(editingLoad ? `/api/loads/${editingLoad.id}` : '/api/loads', {
        method: editingLoad ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      setShowLoadForm(false);
      await refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Load could not be saved.');
    }
  }

  async function saveCustomer(form: HTMLFormElement) {
    const values = new FormData(form);
    await fetchJson('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: values.get('name'),
        email: values.get('email'),
        phone: values.get('phone'),
        notes: values.get('notes'),
        contacts: values.get('contactName')
          ? [{
              name: values.get('contactName'),
              email: values.get('contactEmail'),
              phone: values.get('contactPhone'),
            }]
          : [],
      }),
    });
    form.reset();
    await refresh();
  }

  async function saveTrailer(form: HTMLFormElement) {
    const values = new FormData(form);
    await fetchJson('/api/trailers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(Object.fromEntries(values)),
    });
    form.reset();
    await refresh();
  }

  async function saveTrailerVin(trailerId: string) {
    await fetchJson(`/api/trailers/${trailerId}/vin`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ vin: trailerVinDraft }),
    });
    setEditingTrailerVinId(null);
    setTrailerVinDraft('');
    await refresh();
  }

  async function deleteCustomer(customerId: string) {
    await fetchJson(`/api/customers/${customerId}`, { method: 'DELETE' });
    await refresh();
  }

  async function deleteTrailer(trailerId: string) {
    await fetchJson(`/api/trailers/${trailerId}`, { method: 'DELETE' });
    await refresh();
  }

  async function uploadLoadDocument() {
    if (!editingLoad || !documentFile) return;
    const form = new FormData();
    form.set('file', documentFile);
    form.set('type', documentType);
    await fetchJson(`/api/loads/${editingLoad.id}/documents`, {
      method: 'POST',
      body: form,
    });
    setDocumentFile(null);
    await refresh();
  }

  async function uploadTrailerDocument(trailerId: string, file: File) {
    const form = new FormData();
    form.set('file', file);
    form.set('type', 'TRAILER_REGISTRATION');
    await fetchJson(`/api/trailers/${trailerId}/documents`, {
      method: 'POST',
      body: form,
    });
    await refresh();
  }

  return (
    <div className="flex min-h-[calc(100vh-4rem)] bg-gray-950 text-white">
      <main className="min-w-0 flex-1 overflow-auto p-4 pb-24 md:p-8">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-blue-400">
              Internal Alpha
            </p>
            <h1 className="mt-1 text-2xl font-bold">Dispatch workflow</h1>
            <p className="mt-1 text-sm text-gray-400">
              Plan assignments, monitor exceptions, and move loads through delivery.
            </p>
          </div>
          <button
            type="button"
            onClick={() => openLoad()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500"
          >
            + New load
          </button>
        </header>

        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div role="tablist" aria-label="Dispatch workspace" className="flex rounded-lg bg-gray-900 p-1">
            {(['dispatch', 'loads', 'customers', 'trailers'] as const).map((tab) => (
              <button
                key={tab}
                role="tab"
                aria-selected={view === tab}
                onClick={() => {
                  setView(tab);
                  window.history.replaceState(null, '', `/loads?view=${tab}`);
                }}
                className={`rounded-md px-3 py-2 text-sm capitalize ${
                  view === tab ? 'bg-blue-600 text-white' : 'text-gray-400'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>
          {(view === 'dispatch' || view === 'loads') && (
            <>
              <input
                aria-label="Search dispatch loads"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search load, customer, route…"
                className="min-w-64 flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
              <select
                aria-label="Filter dispatch exceptions"
                value={exception}
                onChange={(event) => setException(event.target.value)}
                className="rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm"
              >
                <option value="">All loads</option>
                <option value="UNASSIGNED">Unassigned</option>
                <option value="LATE_PICKUP">Late pickup</option>
                <option value="LATE_DELIVERY">Late delivery</option>
                <option value="MISSING_POD">Missing POD</option>
              </select>
            </>
          )}
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-lg border border-red-800 bg-red-950/60 p-3 text-sm text-red-200">
            {error}
            <button className="float-right" onClick={() => setError('')} aria-label="Dismiss error">×</button>
          </div>
        )}

        {view === 'dispatch' && (
          <DndContext sensors={sensors} onDragEnd={onDragEnd}>
            <div className="flex gap-4 overflow-x-auto pb-4">
              {board.columns.map((column) => (
                <Column
                  key={column.status}
                  {...column}
                  onOpen={openLoad}
                />
              ))}
            </div>
          </DndContext>
        )}

        {view === 'loads' && (
          <section className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
            {allLoads.length === 0 ? (
              <div className="p-12 text-center">
                <h2 className="font-semibold text-white">No loads yet</h2>
                <p className="mt-2 text-sm text-gray-500">
                  Create a multi-stop load to begin planning dispatch.
                </p>
                <button
                  type="button"
                  onClick={() => openLoad()}
                  className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold hover:bg-blue-500"
                >
                  + New load
                </button>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] text-left text-sm">
                  <thead className="border-b border-gray-800 bg-gray-950/45 text-[10px] uppercase tracking-[0.14em] text-gray-500">
                    <tr>
                      <th className="px-4 py-3">Load</th>
                      <th className="px-4 py-3">Customer</th>
                      <th className="px-4 py-3">Route</th>
                      <th className="px-4 py-3">Assignment</th>
                      <th className="px-4 py-3">Stops</th>
                      <th className="px-4 py-3">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {allLoads.map((load) => (
                      <tr
                        key={load.id}
                        onClick={() => openLoad(load)}
                        className="cursor-pointer border-b border-gray-800/60 last:border-0 hover:bg-gray-800/45"
                      >
                        <td className="px-4 py-3 font-mono font-semibold text-blue-300">{load.loadNumber}</td>
                        <td className="px-4 py-3 text-gray-300">{load.customer?.name ?? 'Unassigned'}</td>
                        <td className="max-w-64 truncate px-4 py-3 text-gray-400">{load.origin} → {load.destination}</td>
                        <td className="px-4 py-3 text-xs text-gray-400">
                          {load.truck?.unitNumber ?? 'No truck'} ·{' '}
                          {load.driver ? `${load.driver.firstName} ${load.driver.lastName}` : 'No driver'}
                        </td>
                        <td className="px-4 py-3 text-gray-400">{load.stops.length}</td>
                        <td className="px-4 py-3">
                          <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-medium text-blue-200">
                            {statusLabel[load.status as Status] ?? load.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {view === 'customers' && (
          <section className="grid gap-5 lg:grid-cols-[22rem_1fr]">
            <form
              aria-label="Add customer"
              onSubmit={(event) => {
                event.preventDefault();
                saveCustomer(event.currentTarget).catch((caught: Error) => setError(caught.message));
              }}
              className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4"
            >
              <h2 className="font-semibold">Add customer</h2>
              {[
                ['name', 'Customer name'],
                ['email', 'Company email'],
                ['phone', 'Company phone'],
                ['contactName', 'Primary contact'],
                ['contactEmail', 'Contact email'],
                ['contactPhone', 'Contact phone'],
              ].map(([name, label]) => (
                <label key={name} className="block text-xs text-gray-400">
                  {label}
                  <input name={name} required={name === 'name'} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white" />
                </label>
              ))}
              <label className="block text-xs text-gray-400">
                Notes
                <textarea name="notes" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white" />
              </label>
              <button className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold">Save customer</button>
            </form>
            <div className="grid gap-3 md:grid-cols-2">
              {customers.map((customer) => (
                <article key={customer.id} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                  <h3 className="font-semibold">{customer.name}</h3>
                  <p className="mt-1 text-xs text-gray-400">{customer.email || customer.phone || 'No company contact'}</p>
                  <p className="mt-3 text-sm text-gray-300">{customer.notes || 'No notes'}</p>
                  <p className="mt-3 text-xs text-blue-300">{customer.contacts.length} contacts</p>
                  <button
                    type="button"
                    onClick={() => deleteCustomer(customer.id).catch((caught: Error) => setError(caught.message))}
                    className="mt-3 text-xs text-red-300"
                  >
                    Delete customer
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}

        {view === 'trailers' && (
          <section className="grid gap-5 lg:grid-cols-[22rem_1fr]">
            <form
              aria-label="Add trailer"
              onSubmit={(event) => {
                event.preventDefault();
                saveTrailer(event.currentTarget).catch((caught: Error) => setError(caught.message));
              }}
              className="space-y-3 rounded-xl border border-gray-800 bg-gray-900 p-4"
            >
              <h2 className="font-semibold">Add trailer</h2>
              <label className="block text-xs text-gray-400">Unit number<input required name="unitNumber" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm" /></label>
              <label className="block text-xs text-gray-400">Equipment type<select name="equipmentType" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm">{['DRY_VAN', 'REEFER', 'FLATBED', 'STEP_DECK', 'POWER_ONLY', 'OTHER'].map((value) => <option key={value}>{value}</option>)}</select></label>
              <label className="block text-xs text-gray-400">VIN<input name="vin" maxLength={17} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm" /></label>
              <label className="block text-xs text-gray-400">Plate<input name="plate" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm" /></label>
              <input type="hidden" name="status" value="AVAILABLE" />
              <button className="w-full rounded-lg bg-blue-600 py-2 text-sm font-semibold">Save trailer</button>
            </form>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {trailers.map((trailer) => (
                <article key={trailer.id} aria-label={`Trailer ${trailer.unitNumber}`} className="rounded-xl border border-gray-800 bg-gray-900 p-4">
                  <div className="flex items-start justify-between">
                    <h3 className="font-mono font-semibold text-blue-300">{trailer.unitNumber}</h3>
                    <div className="flex flex-col items-end gap-2">
                      <span className="text-xs text-gray-400">{trailer.status}</span>
                      <TrailerVinStatus vin={trailer.vin} />
                    </div>
                  </div>
                  <p className="mt-2 text-sm">{trailer.equipmentType.replaceAll('_', ' ')}</p>
                  <p className="mt-2 text-xs text-gray-400">{trailer.assignment ? `Assigned to ${trailer.assignment.loadNumber}` : 'Available'}</p>
                  <p className="mt-2 text-xs text-gray-500">{trailer.documents.length} documents</p>
                  <details className="mt-3 rounded-lg border border-gray-800 bg-gray-950/60 p-3">
                    <summary className="cursor-pointer text-xs font-semibold text-blue-300">Trailer details</summary>
                    <div className="mt-3">
                      <TrailerVinStatus vin={trailer.vin} detail notes={!trailer.vin ? trailer.notes : null} />
                      {editingTrailerVinId === trailer.id ? (
                        <form
                          className="mt-3 space-y-2"
                          onSubmit={(event) => {
                            event.preventDefault();
                            saveTrailerVin(trailer.id).catch((caught: Error) => setError(caught.message));
                          }}
                        >
                          <label className="block text-xs text-gray-400">
                            VIN for {trailer.unitNumber}
                            <input required maxLength={17} value={trailerVinDraft} onChange={(event) => setTrailerVinDraft(event.target.value)} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-sm" />
                          </label>
                          <div className="flex gap-3">
                            <button className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold">Save VIN</button>
                            <button type="button" onClick={() => setEditingTrailerVinId(null)} className="text-xs text-gray-300">Cancel</button>
                          </div>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingTrailerVinId(trailer.id);
                            setTrailerVinDraft(trailer.vin ?? '');
                          }}
                          className="mt-3 text-xs font-semibold text-blue-300"
                        >
                          {trailer.vin ? 'Edit VIN' : 'Add VIN'}
                        </button>
                      )}
                    </div>
                  </details>
                  <label className="mt-3 block cursor-pointer text-xs text-blue-300">
                    Add registration
                    <input
                      type="file"
                      accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
                      className="sr-only"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) uploadTrailerDocument(trailer.id, file).catch((caught: Error) => setError(caught.message));
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => deleteTrailer(trailer.id).catch((caught: Error) => setError(caught.message))}
                    className="mt-3 block text-xs text-red-300"
                  >
                    Delete trailer
                  </button>
                </article>
              ))}
            </div>
          </section>
        )}
      </main>

      {showLoadForm && (
        <div role="dialog" aria-modal="true" aria-labelledby="load-form-title" className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <form onSubmit={saveLoad} className="max-h-[92vh] w-full max-w-3xl overflow-auto rounded-xl border border-gray-700 bg-gray-900 p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="load-form-title" className="text-lg font-semibold">{editingLoad ? `Edit ${editingLoad.loadNumber}` : 'Create load'}</h2>
              <button type="button" aria-label="Close load editor" onClick={() => setShowLoadForm(false)} className="text-xl text-gray-400">×</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs text-gray-400">Load number<input required value={loadForm.loadNumber} onChange={(event) => setLoadForm({ ...loadForm, loadNumber: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white" /></label>
              <label className="text-xs text-gray-400">Reference<input value={loadForm.referenceNum} onChange={(event) => setLoadForm({ ...loadForm, referenceNum: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-white" /></label>
              <label className="text-xs text-gray-400">Customer<select value={loadForm.customerId} onChange={(event) => setLoadForm({ ...loadForm, customerId: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm"><option value="">Unassigned</option>{customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
              <label className="text-xs text-gray-400">Rate<input required min="0" step="0.01" type="number" value={loadForm.rate} onChange={(event) => setLoadForm({ ...loadForm, rate: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm" /></label>
              <label className="text-xs text-gray-400">Truck<select value={loadForm.truckId} onChange={(event) => setLoadForm({ ...loadForm, truckId: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm"><option value="">Unassigned</option>{trucks.map((truck) => <option key={truck.id} value={truck.id}>{truck.unitNumber}</option>)}</select></label>
              <label className="text-xs text-gray-400">Trailer<select value={loadForm.trailerId} onChange={(event) => setLoadForm({ ...loadForm, trailerId: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm"><option value="">Unassigned</option>{trailers.map((trailer) => <option key={trailer.id} value={trailer.id}>{trailer.unitNumber}</option>)}</select></label>
              <label className="text-xs text-gray-400">Driver<select value={loadForm.driverId} onChange={(event) => setLoadForm({ ...loadForm, driverId: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm"><option value="">Unassigned</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.firstName} {driver.lastName}</option>)}</select></label>
              <label className="text-xs text-gray-400">Invoice number<input value={loadForm.invoiceNumber} onChange={(event) => setLoadForm({ ...loadForm, invoiceNumber: event.target.value })} className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-sm" /></label>
            </div>
            <div className="my-5 flex items-center justify-between">
              <h3 className="font-semibold">Stops</h3>
              <div className="flex gap-2">
                {(['PICKUP', 'DELIVERY'] as const).map((type) => (
                  <button key={type} type="button" onClick={() => setLoadForm({ ...loadForm, stops: [...loadForm.stops, { type, facilityName: '', city: '', state: '', appointmentStart: '' }] })} className="rounded bg-gray-800 px-2 py-1 text-xs">+ {type.toLowerCase()}</button>
                ))}
              </div>
            </div>
            <div className="space-y-3">
              {loadForm.stops.map((stop, index) => (
                <fieldset key={`${stop.type}-${index}`} className="grid gap-2 rounded-lg border border-gray-800 p-3 md:grid-cols-4">
                  <legend className="px-1 text-xs font-semibold text-blue-300">{index + 1}. {stop.type}</legend>
                  {(['facilityName', 'city', 'state'] as const).map((field) => (
                    <label key={field} className="text-xs text-gray-400">{field === 'facilityName' ? 'Facility' : field}<input required={field !== 'state'} value={stop[field]} onChange={(event) => setLoadForm({ ...loadForm, stops: loadForm.stops.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, [field]: event.target.value } : candidate) })} className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm" /></label>
                  ))}
                  <label className="text-xs text-gray-400">Appointment<input type="datetime-local" value={stop.appointmentStart} onChange={(event) => setLoadForm({ ...loadForm, stops: loadForm.stops.map((candidate, candidateIndex) => candidateIndex === index ? { ...candidate, appointmentStart: event.target.value } : candidate) })} className="mt-1 w-full rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm" /></label>
                  {loadForm.stops.length > 2 && <button type="button" onClick={() => setLoadForm({ ...loadForm, stops: loadForm.stops.filter((_, candidateIndex) => candidateIndex !== index) })} className="text-left text-xs text-red-300">Remove stop</button>}
                </fieldset>
              ))}
            </div>
            {editingLoad && (
              <section aria-label="Load documents" className="mt-5 rounded-lg border border-gray-800 p-3">
                <h3 className="mb-3 font-semibold">Documents</h3>
                <div className="flex flex-wrap gap-2">
                  <select
                    aria-label="Document type"
                    value={documentType}
                    onChange={(event) => setDocumentType(event.target.value)}
                    className="rounded border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm"
                  >
                    {['RATE_CONFIRMATION', 'BOL', 'POD', 'RECEIPT', 'OTHER'].map((type) => <option key={type}>{type}</option>)}
                  </select>
                  <input
                    aria-label="Choose load document"
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
                    onChange={(event) => setDocumentFile(event.target.files?.[0] ?? null)}
                    className="text-sm"
                  />
                  <button
                    type="button"
                    disabled={!documentFile}
                    onClick={() => uploadLoadDocument().catch((caught: Error) => setError(caught.message))}
                    className="rounded bg-gray-700 px-3 py-1.5 text-sm disabled:opacity-50"
                  >
                    Upload document
                  </button>
                </div>
                <ul className="mt-3 space-y-1 text-xs text-gray-400">
                  {editingLoad.documents.map((document) => (
                    <li key={document.id}>
                      <a className="text-blue-300 underline" href={`/api/loads/${editingLoad.id}/documents/${document.id}`}>
                        {document.type}: {document.displayFilename}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setShowLoadForm(false)} className="rounded-lg px-4 py-2 text-sm text-gray-400">Cancel</button>
              <button className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold">Save load</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
