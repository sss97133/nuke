
import { useState } from 'react';
import { SortDirection, SortField } from '../../components/vehicles/discovery/types';
import { 
  handleVerify, 
  handleEdit, 
  handleRemove, 
  handleBulkVerify,
  handleBulkAddToGarage,
  handleBulkRemove,
  toggleVehicleSelection
} from './vehicleActions';
import { useAuth } from '@/hooks/use-auth';
import { useVehiclesFetcher } from './useVehiclesFetcher';
import { UseVehiclesDataResult } from './types';

export function useVehiclesData(vehicleStatus: 'discovered' | 'owned' = 'discovered'): UseVehiclesDataResult {
  const { session } = useAuth();
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedVehicles, setSelectedVehicles] = useState<number[]>([]);
  const [bulkActionOpen, setBulkActionOpen] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<string>("grid");
  const [sortField, setSortField] = useState<SortField>("added");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  
  // Use the vehicle fetcher hook to handle data fetching
  const { vehicles, isLoading, error } = useVehiclesFetcher(
    vehicleStatus,
    session,
    sortField,
    sortDirection
  );
  
  // Wrapper for toggle selection that includes the current state
  const toggleSelection = (id: number) => {
    toggleVehicleSelection(id, selectedVehicles, setSelectedVehicles);
  };
  
  // Bulk action handlers with cleanup
  const bulkVerify = () => {
    handleBulkVerify(selectedVehicles);
    setSelectedVehicles([]);
    setBulkActionOpen(false);
  };
  
  const bulkAddToGarage = () => {
    handleBulkAddToGarage(selectedVehicles);
    setSelectedVehicles([]);
    setBulkActionOpen(false);
  };
  
  const bulkRemove = () => {
    handleBulkRemove(selectedVehicles);
    setSelectedVehicles([]);
    setBulkActionOpen(false);
  };

  return {
    vehicles,
    isLoading,
    error,
    searchTerm,
    setSearchTerm,
    selectedVehicles,
    setSelectedVehicles,
    bulkActionOpen,
    setBulkActionOpen,
    viewMode,
    setViewMode,
    sortField,
    setSortField,
    sortDirection,
    setSortDirection,
    handleVerify,
    handleEdit,
    handleRemove,
    toggleVehicleSelection: toggleSelection,
    handleBulkVerify: bulkVerify,
    handleBulkAddToGarage: bulkAddToGarage,
    handleBulkRemove: bulkRemove,
    vehicleStatus
  };
}
