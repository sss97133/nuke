
import { Vehicle } from '../../components/vehicles/discovery/types';

// Functions for handling vehicle actions
export const handleVerify = (id: number) => {
  console.log(`Verifying vehicle ${id}`);
};

export const handleEdit = (id: number) => {
  console.log(`Editing vehicle ${id}`);
};

export const handleRemove = (id: number) => {
  console.log(`Removing vehicle ${id}`);
};

export const handleBulkVerify = (selectedVehicles: number[]) => {
  console.log(`Verifying vehicles: ${selectedVehicles.join(', ')}`);
};

export const handleBulkAddToGarage = (selectedVehicles: number[]) => {
  console.log(`Adding vehicles to garage: ${selectedVehicles.join(', ')}`);
};

export const handleBulkRemove = (selectedVehicles: number[]) => {
  console.log(`Removing vehicles: ${selectedVehicles.join(', ')}`);
};

// Toggle selection of a vehicle
export const toggleVehicleSelection = (
  id: number,
  selectedVehicles: number[],
  setSelectedVehicles: React.Dispatch<React.SetStateAction<number[]>>
) => {
  if (id === -1) {
    setSelectedVehicles([]);
    return;
  }
  
  if (selectedVehicles.includes(id)) {
    setSelectedVehicles(selectedVehicles.filter(vehicleId => vehicleId !== id));
  } else {
    setSelectedVehicles([...selectedVehicles, id]);
  }
};
