type TrailerVinStatusProps = {
  vin: string | null;
  detail?: boolean;
  notes?: string | null;
};

export function TrailerVinStatus({ vin, detail = false, notes }: TrailerVinStatusProps) {
  if (vin) {
    return detail ? (
      <div>
        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">VIN</p>
        <p className="mt-1 font-mono text-sm text-gray-200">{vin}</p>
      </div>
    ) : null;
  }

  if (!detail) {
    return (
      <span className="rounded-full border border-red-700 bg-red-950 px-2 py-1 text-xs font-semibold text-red-200">
        VIN MISSING
      </span>
    );
  }

  return (
    <div role="alert" className="rounded-lg border border-red-700 bg-red-950/70 p-3 text-red-100">
      <p className="text-xs font-semibold uppercase tracking-wide">VIN</p>
      <p className="mt-1 font-semibold">MISSING — ACTION REQUIRED</p>
      {notes ? <p className="mt-2 whitespace-pre-wrap text-xs text-red-100/90">{notes}</p> : null}
    </div>
  );
}
