
import { Vehicle } from '@/components/vehicles/discovery/types';

// Relationship types between users and vehicles
export type VehicleRelationshipType = 'discovered' | 'claimed' | 'verified';

// Vehicle relationship interface representing connections between users and vehicles
export interface VehicleRelationship {
  id: string;
  userId: string;
  vehicleId: number;
  relationshipType: VehicleRelationshipType;
  createdAt: string;
  updatedAt: string;
  verificationData?: {
    titleVerified?: boolean;
    identityVerified?: boolean;
    verificationDate?: string;
    verifiedBy?: string;
  };
}

// In-memory storage for mock vehicles
const storedVehicles: Vehicle[] = [
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

// Mock storage for user-vehicle relationships
const storedRelationships: VehicleRelationship[] = [
  {
    id: '1',
    userId: 'mock-user-1',
    vehicleId: 1,
    relationshipType: 'discovered',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  },
  {
    id: '2',
    userId: 'mock-user-1',
    vehicleId: 2,
    relationshipType: 'claimed',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    verificationData: {
      titleVerified: false,
      identityVerified: false,
    }
  }
];

// Add a new vehicle to the in-memory storage
export const addStoredVehicle = (vehicle: Vehicle) => {
  storedVehicles.push(vehicle);
  console.log('Vehicle added to mock storage:', vehicle);
  console.log('Total vehicles in mock storage:', storedVehicles.length);
  return vehicle;
};

// Add a new relationship between user and vehicle
export const addVehicleRelationship = (userId: string, vehicleId: number, relationshipType: VehicleRelationshipType = 'discovered') => {
  const relationship: VehicleRelationship = {
    id: `rel-${Date.now()}`,
    userId,
    vehicleId,
    relationshipType,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    verificationData: relationshipType !== 'discovered' ? {
      titleVerified: relationshipType === 'verified',
      identityVerified: relationshipType === 'verified',
      verificationDate: relationshipType === 'verified' ? new Date().toISOString() : undefined
    } : undefined
  };
  
  storedRelationships.push(relationship);
  console.log(`Added ${relationshipType} relationship between user ${userId} and vehicle ${vehicleId}`);
  return relationship;
};

// Update an existing relationship
export const updateVehicleRelationship = (relationshipId: string, updates: Partial<VehicleRelationship>) => {
  const index = storedRelationships.findIndex(rel => rel.id === relationshipId);
  if (index !== -1) {
    storedRelationships[index] = {
      ...storedRelationships[index],
      ...updates,
      updatedAt: new Date().toISOString()
    };
    return storedRelationships[index];
  }
  return null;
};

// Get all stored vehicles
export const getStoredVehicles = (): Vehicle[] => {
  return storedVehicles;
};

// Get vehicles by relationship type for a specific user
export const getVehiclesByRelationship = (userId: string, relationshipType?: VehicleRelationshipType): Vehicle[] => {
  const relevantRelationships = relationshipType 
    ? storedRelationships.filter(rel => rel.userId === userId && rel.relationshipType === relationshipType)
    : storedRelationships.filter(rel => rel.userId === userId);
  
  const vehicleIds = relevantRelationships.map(rel => rel.vehicleId);
  return storedVehicles.filter(vehicle => vehicleIds.includes(vehicle.id));
};

// Get a specific vehicle by ID
export const getStoredVehicleById = (id: number): Vehicle | undefined => {
  return storedVehicles.find(vehicle => vehicle.id === id);
};

// Get relationships for a specific vehicle
export const getRelationshipsForVehicle = (vehicleId: number): VehicleRelationship[] => {
  return storedRelationships.filter(rel => rel.vehicleId === vehicleId);
};

// Record an ownership transfer
export const recordOwnershipTransfer = (
  vehicleId: number, 
  fromUserId: string, 
  toUserId: string, 
  verificationData?: VehicleRelationship['verificationData']
) => {
  // Update the old owner's relationship
  const oldOwnerRelationship = storedRelationships.find(
    rel => rel.vehicleId === vehicleId && 
    rel.userId === fromUserId && 
    (rel.relationshipType === 'verified' || rel.relationshipType === 'claimed')
  );
  
  if (oldOwnerRelationship) {
    updateVehicleRelationship(oldOwnerRelationship.id, {
      relationshipType: 'discovered', // Downgrade to discovered
      verificationData: undefined
    });
  }
  
  // Create a new ownership relationship for the new owner
  const newRelationship = addVehicleRelationship(toUserId, vehicleId, 'verified');
  
  if (verificationData) {
    updateVehicleRelationship(newRelationship.id, {
      verificationData: {
        ...verificationData,
        verificationDate: new Date().toISOString()
      }
    });
  }
  
  console.log(`Ownership of vehicle ${vehicleId} transferred from ${fromUserId} to ${toUserId}`);
  return newRelationship;
};
