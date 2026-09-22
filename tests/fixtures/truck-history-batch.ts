import type { BatchHistoryRequest, CompanyPeriod } from '../../src/lib/fleet/truck-company-history';
import { boundedHistoryShape } from './truck-history-bounded';

// Synthetic production-shaped topology only: no Alpha Truck, Company, provider, or statement identifiers.
export function batchHistoryShape(a: string, b: string): CompanyPeriod[][] {
  const histories = boundedHistoryShape(a, b);
  for (let index = 0; index < 31; index++) {
    const first: CompanyPeriod = { companyId: index % 2 ? b : a, effectiveFrom: '2026-04-01', effectiveTo: '2026-04-08' };
    histories.push(index < 4
      ? [first, { companyId: first.companyId, effectiveFrom: '2026-04-15', effectiveTo: '2026-04-22' }]
      : [first]);
  }
  return histories;
}

export function batchReconciliationRequests(truckIds: string[], histories: CompanyPeriod[][]) {
  const requests: BatchHistoryRequest[] = Array.from({ length: 670 }, (_, index) => {
    const truckIndex = index % truckIds.length;
    return { key: `covered-${index}`, truckId: truckIds[truckIndex], timestamp: histories[truckIndex][0].effectiveFrom };
  });
  requests.push(...Array.from({ length: 28 }, (_, index) => ({
    key: `unknown-${index}`, truckId: truckIds[index % truckIds.length], timestamp: '2025-01-01',
  })));
  return requests;
}
