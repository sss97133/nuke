import type { Vehicle } from "@/types/inventory";

interface VehicleDetailsProps {
  vehicle: Vehicle;
}

export const VehicleDetails = ({ vehicle }: VehicleDetailsProps) => {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-2">
        <h3 className="font-mono text-sm text-[#666]">Vehicle Information</h3>
        <p className="font-mono">VIN: {vehicle.vin || 'N/A'}</p>
        <p className="font-mono">Make: {vehicle.make}</p>
        <p className="font-mono">Model: {vehicle.model}</p>
        <p className="font-mono">Year: {vehicle.year}</p>
      </div>
      {vehicle.notes && (
        <div className="space-y-2">
          <h3 className="font-mono text-sm text-[#666]">Notes</h3>
          <p className="font-mono">{vehicle.notes}</p>
        </div>
      )}
    </div>
  );
};