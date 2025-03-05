
// This file will serve as a temporary in-memory storage for vehicles
// until we implement proper database integration

import { Vehicle } from '@/components/vehicles/discovery/types';
import { mockVehicles } from './mockVehicleData';

// Start with the mock vehicles
let storedVehicles: Vehicle[] = [...mockVehicles];

export const getStoredVehicles = (): Vehicle[] => {
  return storedVehicles;
};

export const addStoredVehicle = (vehicle: Vehicle): void => {
  // Add the new vehicle to the beginning of the array
  storedVehicles = [vehicle, ...storedVehicles];
  console.log('Vehicle added to mock storage:', vehicle);
  console.log('Total vehicles in storage:', storedVehicles.length);
};

export const clearStoredVehicles = (): void => {
  storedVehicles = [...mockVehicles];
};
