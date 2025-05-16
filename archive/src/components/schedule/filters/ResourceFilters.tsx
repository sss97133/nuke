
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ResourceFiltersProps {
  vehicleId: string;
  setVehicleId: (id: string) => void;
  technicianId: string;
  setTechnicianId: (id: string) => void;
  availableVehicles: { id: string; name: string }[];
  availableTechnicians: { id: string; name: string }[];
}

export const ResourceFilters = ({
  vehicleId,
  setVehicleId,
  technicianId,
  setTechnicianId,
  availableVehicles,
  availableTechnicians
}: ResourceFiltersProps) => {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-medium mb-2">Vehicle</h3>
        <Select value={vehicleId} onValueChange={setVehicleId}>
          <SelectTrigger>
            <SelectValue placeholder="Select a vehicle" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Vehicles</SelectItem>
            {availableVehicles.map((vehicle) => (
              <SelectItem key={vehicle.id} value={vehicle.id}>
                {vehicle.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      <div>
        <h3 className="text-lg font-medium mb-2">Technician</h3>
        <Select value={technicianId} onValueChange={setTechnicianId}>
          <SelectTrigger>
            <SelectValue placeholder="Select a technician" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">All Technicians</SelectItem>
            {availableTechnicians.map((tech) => (
              <SelectItem key={tech.id} value={tech.id}>
                {tech.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
};
