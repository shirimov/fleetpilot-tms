export type DriverRecord = {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  licenseNum: string | null;
  payType: "PERCENTAGE" | "PER_MILE" | "FLAT" | null;
  payRate: number | null;
  truckId: string | null;
  createdAt: string;
  updatedAt: string;
  employmentStatus?: "ACTIVE" | "INACTIVE" | "TERMINATED" | "ON_LEAVE" | null;
  driverType?: "COMPANY" | "OWNER_OPERATOR" | "LEASE_OPERATOR" | null;
  employmentStartDate?: string | null;
  terminationDate?: string | null;
  homeTerminal?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  emergencyContactRelation?: string | null;
  team?: { id: string; name: string } | null;
  canReadDocuments?: boolean;
  documentAlerts?: {
    expired: number;
    within30: number;
    within60: number;
    within90: number;
    unknownExpiry: number;
    missingRequired: string[];
  };
  assignmentRestricted?: boolean;
  canEdit?: boolean;
  canViewCompensation?: boolean;
  truck: { id: string; unitNumber: string; make?: string | null } | null;
};
export type DriverProfile = DriverRecord & {
  company: { name: string } | null;
  loads: {
    id: string;
    loadNumber: string;
    status: string;
    origin: string;
    destination: string;
    pickupDate: string | null;
    deliveryDate: string | null;
    miles: number | null;
    truck: { unitNumber: string } | null;
  }[];
  settlements: {
    id: string;
    weekEnding: string;
    driverPay: number;
    fuelDeduction: number;
    otherDeductions: number;
    netPay: number;
    isPaid: boolean;
    paidAt: string | null;
  }[];
  driverOrientations: {
    id: string;
    completedAt: string;
    completedBy: string;
    notes: string | null;
  }[];
};
export function payLabel(driver: Pick<DriverRecord, "payType" | "payRate">) {
  if (driver.payRate == null || driver.payType == null) return "Restricted";
  if (driver.payType === "PERCENTAGE") return `${driver.payRate}% of load`;
  return (
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(driver.payRate) +
    (driver.payType === "PER_MILE" ? " / mile" : " flat")
  );
}
export function displayDate(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(new Date(value))
    : "Not recorded";
}
