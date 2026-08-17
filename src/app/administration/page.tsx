import TeamPage from '@/components/admin/TeamPage';

export const dynamic = 'force-dynamic';

export default function AdministrationPage() {
  return (
    <div className="p-6">
      <TeamPage />
    </div>
  );
}
