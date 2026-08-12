import PatientDashboard from '@/components/PatientDashboard';

export const dynamic = 'force-dynamic';

export default async function AdminUserDashboardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <PatientDashboard targetUserId={id} />;
}
