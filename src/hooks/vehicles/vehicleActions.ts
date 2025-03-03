
import { toast } from "sonner";
import { Vehicle } from '../../components/vehicles/discovery/types';

// Functions for handling vehicle actions
export const handleVerify = (id: number) => {
  console.log(`Verifying vehicle ${id}`);
  toast.success(`Vehicle #${id} verified successfully`, {
    description: "The vehicle has been marked as verified in the system."
  });
};

export const handleEdit = (id: number) => {
  console.log(`Editing vehicle ${id}`);
  // In a real app, this would navigate to an edit form
  // or open a modal for editing
  toast.info(`Opening editor for vehicle #${id}`, {
    description: "Vehicle editor would open here in a real application."
  });
};

export const handleRemove = (id: number) => {
  console.log(`Removing vehicle ${id}`);
  toast.success(`Vehicle #${id} removed`, {
    description: "The vehicle has been removed from the discovered vehicles list."
  });
};

export const handleBulkVerify = (selectedVehicles: number[]) => {
  console.log(`Verifying vehicles: ${selectedVehicles.join(', ')}`);
  toast.success(`${selectedVehicles.length} vehicles verified`, {
    description: "All selected vehicles have been marked as verified."
  });
};

export const handleBulkAddToGarage = (selectedVehicles: number[]) => {
  console.log(`Adding vehicles to garage: ${selectedVehicles.join(', ')}`);
  toast.success(`${selectedVehicles.length} vehicles added to garage`, {
    description: "Selected vehicles have been added to your garage."
  });
};

export const handleBulkRemove = (selectedVehicles: number[]) => {
  console.log(`Removing vehicles: ${selectedVehicles.join(', ')}`);
  toast.success(`${selectedVehicles.length} vehicles removed`, {
    description: "Selected vehicles have been removed from discovered vehicles."
  });
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

