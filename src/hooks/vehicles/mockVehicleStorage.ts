
import { Vehicle } from '@/components/vehicles/discovery/types';

// In-memory storage for mock vehicles
let storedVehicles: Vehicle[] = [
  {
    id: 1,
    make: 'Toyota',
    model: 'Supra',
    year: 1998,
    trim: 'Turbo',
    price: 85000,
    market_value: 85000,
    price_trend: 'up',
    mileage: 42000,
    image: '/placeholder-vehicle.jpg',
    location: 'Los Angeles, CA',
    added: 'yesterday',
    tags: ['classic', 'japanese', 'sports'],
    condition_rating: 8,
    vehicle_type: 'car',
    body_type: 'coupe',
    transmission: 'manual',
    drivetrain: 'RWD',
    rarity_score: 7,
    era: '90s',
    restoration_status: 'original',
    special_edition: false
  },
  {
    id: 2,
    make: 'Ford',
    model: 'Mustang',
    year: 1967,
    trim: 'Fastback',
    price: 120000,
    market_value: 125000,
    price_trend: 'stable',
    mileage: 89000,
    image: '/placeholder-vehicle.jpg',
    location: 'Chicago, IL',
    added: '2 weeks ago',
    tags: ['classic', 'american', 'muscle'],
    condition_rating: 7,
    vehicle_type: 'car',
    body_type: 'coupe',
    transmission: 'manual',
    drivetrain: 'RWD',
    rarity_score: 6,
    era: '60s',
    restoration_status: 'restored',
    special_edition: false
  }
];

// Add a new vehicle to the in-memory storage
export const addStoredVehicle = (vehicle: Vehicle) => {
  storedVehicles.push(vehicle);
  console.log('Vehicle added to mock storage:', vehicle);
  console.log('Total vehicles in mock storage:', storedVehicles.length);
};

// Get all stored vehicles
export const getStoredVehicles = (): Vehicle[] => {
  return storedVehicles;
};

// Get a specific vehicle by ID
export const getStoredVehicleById = (id: number): Vehicle | undefined => {
  return storedVehicles.find(vehicle => vehicle.id === id);
};
