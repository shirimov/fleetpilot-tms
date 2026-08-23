import { redirect } from 'next/navigation';
import { authorizationService } from '@/lib/auth/authorization';
import { prisma } from '@/lib/prisma';
import EmployeeProfile from '@/app/hr/employees/[id]/EmployeeProfile';

export const dynamic = 'force-dynamic';

export default async function OwnEmployeeProfilePage() {
  const context = await authorizationService.requireActiveCompany();
  const employee = await prisma.employee.findFirst({ where: { companyId: context.companyId, userId: context.user.id }, select: { id: true } });
  if (!employee) redirect('/tasks');
  return <EmployeeProfile employeeId={employee.id} />;
}
