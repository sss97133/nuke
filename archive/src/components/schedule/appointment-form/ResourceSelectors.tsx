
import React from 'react';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface ResourceSelectorsProps {
  selectedVehicle: string;
  setSelectedVehicle: (value: string) => void;
  selectedTechnician: string;
  setSelectedTechnician: (value: string) => void;
  vehicles: { id: string; name: string }[];
  technicians: { id: string; name: string }[];
}

export const ResourceSelectors: React.FC<ResourceSelectorsProps> = ({
  selectedVehicle,
  setSelectedVehicle,
  selectedTechnician,
  setSelectedTechnician,
  vehicles,
  technicians
}) => {
  return (
    <>
      <div className="grid grid-cols-4 gap-4">
        <Label htmlFor="vehicle" className="text-right pt-2">
          Vehicle
        </Label>
        <Select value={selectedVehicle} onValueChange={setSelectedVehicle}>
          <SelectTrigger className="col-span-3">
            <SelectValue placeholder="Select a vehicle" />
          </SelectTrigger>
          <SelectContent>
            {vehicles.map((vehicle) => (
              <SelectItem key={vehicle.id} value={vehicle.id}>
                {vehicle.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      
      <div className="grid grid-cols-4 gap-4">
        <Label htmlFor="technician" className="text-right pt-2">
          Technician
        </Label>
        <Select value={selectedTechnician} onValueChange={setSelectedTechnician}>
          <SelectTrigger className="col-span-3">
            <SelectValue placeholder="Assign a technician" />
          </SelectTrigger>
          <SelectContent>
            {technicians.map((tech) => (
              <SelectItem key={tech.id} value={tech.id}>
                {tech.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
};
