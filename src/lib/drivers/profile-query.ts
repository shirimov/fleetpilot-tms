import type { Prisma } from "@prisma/client";
// Explicit projections keep unrelated truck, company and financial fields private.
export function driverProfileQuery(id: string, companyId: string) {
  return {
    where: { id, companyId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      email: true,
      licenseNum: true,
      payType: true,
      payRate: true,
      truckId: true,
      createdAt: true,
      updatedAt: true,
      company: { select: { name: true } },
      truck: { select: { id: true, unitNumber: true, companyId: true } },
      loads: {
        where: { companyId },
        orderBy: { createdAt: "desc" as const },
        take: 100,
        select: {
          id: true,
          loadNumber: true,
          status: true,
          origin: true,
          destination: true,
          pickupDate: true,
          deliveryDate: true,
          miles: true,
          truck: { select: { unitNumber: true, companyId: true } },
        },
      },
      settlements: {
        where: {
          truck: { companyId },
          OR: [{ loadId: null }, { load: { companyId } }],
        },
        orderBy: { weekEnding: "desc" as const },
        take: 100,
        select: {
          id: true,
          weekEnding: true,
          driverPay: true,
          fuelDeduction: true,
          otherDeductions: true,
          netPay: true,
          isPaid: true,
          paidAt: true,
        },
      },
      driverOrientations: {
        orderBy: { completedAt: "desc" as const },
        take: 25,
        select: { id: true, completedAt: true, completedBy: true, notes: true },
      },
    },
  } satisfies Prisma.DriverFindFirstArgs;
}
