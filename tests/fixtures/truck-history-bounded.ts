import type { CompanyPeriod } from '../../src/lib/fleet/truck-company-history';

// Synthetic topology only: no production VINs, Truck IDs or statement references.
// 27 Trucks, 78 bounded blocks, 24 adjacent Company changes, 13 gapped changes.
export function boundedHistoryShape(a: string, b: string): CompanyPeriod[][] {
  let transition = 0;
  const addDays = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00.000Z`); d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  return Array.from({ length: 27 }, (_, i) => {
    let from = i < 6 ? '2026-08-30' : '2026-01-01';
    const periods: CompanyPeriod[] = [];
    const count = i >= 6 && i < 16 ? 3 : 2;
    for (let j = 0; j < count; j++) {
      const end = addDays(from, 7);
      periods.push({ companyId: j % 2 === 0 ? a : b, effectiveFrom: from, effectiveTo: end });
      if (j < count - 1) from = addDays(end, transition++ < 24 ? 0 : 7);
    }
    if (i >= 6 && i < 20) {
      const last = periods.at(-1)!; const start = addDays(last.effectiveTo!, 7);
      periods.push({ companyId: last.companyId, effectiveFrom: start, effectiveTo: addDays(start, 7) });
    }
    return periods;
  });
}
