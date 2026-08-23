import { authorizationService } from '@/lib/auth/authorization';
import { prisma } from '@/lib/prisma';
import EmployeeProfile from '@/app/hr/employees/[id]/EmployeeProfile';
import UnlinkedEmployeeProfile from './UnlinkedEmployeeProfile';

export const dynamic = 'force-dynamic';

export default async function OwnEmployeeProfilePage() {
  const context = await authorizationService.requireActiveCompany();
  const employee = await prisma.employee.findFirst({ where: { companyId: context.companyId, userId: context.user.id }, select: { id: true } });
  if (!employee) return <UnlinkedEmployeeProfile role={context.role} />;
  return <EmployeeProfile employeeId={employee.id} />;
}
