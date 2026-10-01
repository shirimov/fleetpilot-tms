export type OwnerAttribution = { ownerPartyId: string; periodId: string; revisionId: string; businessDate: string };

export function FuelOwnerAttribution({ attribution, matchMethod, onOpenHistory }: {
  attribution?: OwnerAttribution | null; matchMethod: string | null; onOpenHistory?: () => void;
}) {
  return <section aria-label="Owner attribution" className="space-y-1 rounded border border-white/20 p-2">
    <h4 className="font-semibold">BENEFICIAL OWNER PROVENANCE</h4>
    {attribution ? <>
      <p className="break-all">Owner party: {attribution.ownerPartyId}</p>
      <p>Calendar date label: {attribution.businessDate}</p>
      <p className="break-all">Owner period: {attribution.periodId}</p>
      <p className="break-all">Owner revision: {attribution.revisionId}</p>
      <p>This is the effective owner attribution used in this preview, not ownership inferred from the posted statement recipient. A provider date label is not a timezone-confirmed purchase instant.</p>
    </> : <p>{matchMethod === 'NEEDS_BUSINESS_DATE' ? 'Purchase business date unresolved — owner attribution remains in review. No timezone is inferred.' : 'No confirmed owner attribution on this row. The statement recipient or current operating Company does not establish beneficial ownership.'}</p>}
    {matchMethod && <p>Attribution / matching method: {matchMethod}</p>}
    {onOpenHistory && <button type="button" className="text-emerald-300 underline" onClick={onOpenHistory}>Owner history</button>}
  </section>;
}
