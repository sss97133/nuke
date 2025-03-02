
import { FuelDashboard } from "@/components/fuel/FuelDashboard";

export default function FuelTracking() {
  return (
    <div className="container py-6 space-y-6">
      <h1 className="text-3xl font-bold tracking-tight">Fuel Tracking</h1>
      <FuelDashboard />
    </div>
  );
}
