/** Legacy vehicle dashboard entrypoints share the canonical garage reader and UI. */
import { useAuth } from '../hooks/useAuth';
import { usePageTitle } from '../hooks/usePageTitle';
import { useVehiclesDashboard } from '../hooks/useVehiclesDashboard';
import GarageTab from '../components/garage/GarageTab';

export default function VehiclesDashboard() {
  usePageTitle('Garage');
  const { user, loading } = useAuth();
  const dashboard = useVehiclesDashboard(user?.id);
  if (loading) return <main className="garage-page"><p role="status">Checking access…</p></main>;
  return <GarageTab dashboard={dashboard} />;
}
