export const QUICKMANAGE_WEB_EQUIPMENT = 'QUICKMANAGE_WEB_EQUIPMENT';

export type QuickManageWebTruck = {
  id: string;
  carrierId: string;
  carrierName: string;
  unit: string;
  vin?: string | null;
  make?: string | null;
  year?: number | null;
  status: string;
  plateNumber?: string | null;
  plateState?: string | null;
  fuelType?: string | null;
  ownership?: string | null;
  inServiceDate?: string | null;
};

// Intentionally data-only: authenticated browser reads are supplied by a trusted
// server-side collector. This adapter exposes no QuickManage mutation method.
export function validateQuickManageWebTruck(value: QuickManageWebTruck) {
  if (!value.id.trim() || !value.carrierId.trim() || !value.carrierName.trim() || !value.unit.trim()) {
    throw new Error('QuickManage Equipment truck identity is incomplete.');
  }
  return value;
}
