
import React from 'react';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
}

interface BasicInformationProps {
  vehicleId: string;
  description: string;
  vehicles: Vehicle[];
  onVehicleChange: (id: string) => void;
  onDescriptionChange: (description: string) => void;
}

const BasicInformation: React.FC<BasicInformationProps> = ({
  vehicleId,
  description,
  vehicles,
  onVehicleChange,
  onDescriptionChange
}) => {
  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="vehicle">Vehicle</Label>
        <Select value={vehicleId} onValueChange={onVehicleChange}>
          <SelectTrigger id="vehicle">
            <SelectValue placeholder="Select a vehicle" />
          </SelectTrigger>
          <SelectContent>
            {vehicles?.map((vehicle) => (
              <SelectItem key={vehicle.id} value={vehicle.id}>
                {vehicle.year} {vehicle.make} {vehicle.model}
              </SelectItem>
            )) || <SelectItem value="loading">Loading vehicles...</SelectItem>}
          </SelectContent>
        </Select>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="description">Description</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          placeholder="Describe the service performed"
          className="min-h-[80px]"
        />
      </div>
    </>
  );
};

export default BasicInformation;
