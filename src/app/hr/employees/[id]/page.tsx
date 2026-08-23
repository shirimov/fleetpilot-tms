import EmployeeProfile from './EmployeeProfile';

export const dynamic = 'force-dynamic';

export default async function EmployeeProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmployeeProfile employeeId={id} />;
}
