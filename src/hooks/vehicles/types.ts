
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
  viewMode: string;
  setViewMode: React.Dispatch<React.SetStateAction<string>>;
  sortField: SortField;
  setSortField: React.Dispatch<React.SetStateAction<SortField>>;
  sortDirection: SortDirection;
  setSortDirection: React.Dispatch<React.SetStateAction<SortDirection>>;
  handleVerify: (id: number) => void;
  handleEdit: (id: number) => void;
  handleRemove: (id: number) => void;
  toggleVehicleSelection: (id: number) => void;
  handleBulkVerify: () => void;
  handleBulkAddToGarage: () => void;
  handleBulkRemove: () => void;
  vehicleStatus: 'discovered' | 'owned';
}

// Feature flag interface
export interface FeatureFlags {
  vehicles: boolean;
}
