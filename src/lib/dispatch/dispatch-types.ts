import type {
  DispatchDocumentType,
  LoadStatus,
  LoadStopType,
  TrailerEquipmentType,
  TrailerStatus,
} from '@prisma/client';
import type { CompanyAuthorization } from '@/lib/auth/authorization';

export type DispatchActor = CompanyAuthorization;

export type CustomerContactInput = {
  id?: string;
  name: string;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
};

export type CustomerInput = {
  name: string;
  status?: 'ACTIVE' | 'INACTIVE';
  mcNumber?: string | null;
  dotNumber?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  contacts?: CustomerContactInput[];
};

export type TrailerInput = {
  unitNumber: string;
  equipmentType?: TrailerEquipmentType;
  status?: TrailerStatus;
  vin?: string | null;
  plate?: string | null;
  state?: string | null;
  notes?: string | null;
};

export type LoadStopInput = {
  id?: string;
  type: LoadStopType;
  order: number;
  facilityName: string;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city: string;
  state?: string | null;
  postalCode?: string | null;
  country?: string;
  contactId?: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  appointmentStart?: Date | null;
  appointmentEnd?: Date | null;
  arrivedAt?: Date | null;
  departedAt?: Date | null;
  notes?: string | null;
};

export type DispatchLoadInput = {
  loadNumber: string;
  referenceNum?: string | null;
  status: LoadStatus;
  origin?: string;
  destination?: string;
  pickupDate?: Date | null;
  deliveryDate?: Date | null;
  miles?: number | null;
  rate: number;
  fuelSurcharge?: number;
  truckId?: string | null;
  driverId?: string | null;
  trailerId?: string | null;
  customerId?: string | null;
  notes?: string | null;
  invoiceNumber?: string | null;
  stops?: LoadStopInput[];
};

export type DispatchDocumentInput = {
  type: DispatchDocumentType;
  originalFilename: string;
  displayFilename: string;
  mimeType: string;
  byteSize: number;
};
