import { SortDirection, SortField } from '../../components/vehicles/discovery/types';
import { Vehicle } from '../../components/vehicles/discovery/types';

export interface UseVehiclesDataResult {
  vehicles: Vehicle[];
  isLoading: boolean;
  error: string | null;
  searchTerm: string;
  setSearchTerm: React.Dispatch<React.SetStateAction<string>>;
  selectedVehicles: number[];
  setSelectedVehicles: React.Dispatch<React.SetStateAction<number[]>>;
  bulkActionOpen: boolean;
  setBulkActionOpen: React.Dispatch<React.SetStateAction<boolean>>;
  viewMode: 'grid' | 'list';
  setViewMode: React.Dispatch<React.SetStateAction<'grid' | 'list'>>;
  sortField: SortField;
  setSortField: React.Dispatch<React.SetStateAction<SortField>>;
  sortDirection: SortDirection;
  setSortDirection: React.Dispatch<React.SetStateAction<SortDirection>>;
  handleVerify: (id: number) => Promise<void>;
  handleEdit: (id: number) => Promise<void>;
  handleRemove: (id: number) => Promise<void>;
  toggleVehicleSelection: (id: number) => void;
  handleBulkVerify: () => Promise<void>;
  handleBulkAddToGarage: () => Promise<void>;
  handleBulkRemove: () => Promise<void>;
  vehicleStatus: 'discovered' | 'owned';
}

// Feature flag interface
export interface FeatureFlags {
  vehicles: boolean;
}

// Define a Vehicle interface for our app (consistent with Vehicle type from discovery/types.ts)
export interface VehicleType {
  id: number | string;
  make: string;
  model: string;
  year: number;
  price?: number;
  market_value?: number;
  price_trend?: string;
  mileage?: number;
  image?: string;
  location?: string;
  added?: string;
  tags?: string[];
  condition_rating?: number;
  vehicle_type?: string;
  body_type?: string;
  transmission?: string;
  drivetrain?: string;
  rarity_score?: number;
  era?: string;
  restoration_status?: string;
  special_edition?: boolean;
  status?: string;
  source?: string;
  source_url?: string;
  vin?: string; // Make vin optional with string type, not nullable
}
