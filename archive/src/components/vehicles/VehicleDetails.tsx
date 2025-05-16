import type { Vehicle } from "@/types/inventory";
import { AspectRatio } from "@/components/ui/aspect-ratio";

interface VehicleDetailsProps {
  vehicle: Vehicle;
}

export const VehicleDetails = ({ vehicle }: VehicleDetailsProps) => {
  const batImage = vehicle.historical_data?.previousSales?.[0]?.imageUrl;

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
      {batImage && (
        <div className="col-span-2 mt-4">
          <h3 className="font-mono text-sm text-[#666] mb-2">Bring a Trailer Image</h3>
          <AspectRatio ratio={16 / 9} className="bg-muted">
            <img
              src={batImage}
              alt={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              className="rounded-md object-cover w-full h-full"
            />
          </AspectRatio>
        </div>
      )}
    </div>
  );
};