
import { useState } from 'react';
import { SortDirection, SortField } from '../../components/vehicles/discovery/types';
import { useSupabaseVehicles } from './useSupabaseVehicles';
import { 
  handleVerify, 
  handleEdit, 
  handleRemove, 
  handleBulkVerify,
  handleBulkAddToGarage,
  handleBulkRemove,
  toggleVehicleSelection
} from './vehicleActions';

export function useVehiclesData() {
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedVehicles, setSelectedVehicles] = useState<number[]>([]);
  const [bulkActionOpen, setBulkActionOpen] = useState(false);
  const [viewMode, setViewMode] = useState("grid");
  const [sortField, setSortField] = useState<SortField>("added");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  
  // Use the Supabase hook to get real vehicle data
  const { 
    vehicles, 
    loading, 
    error, 
    fetchVehicles, 
    addVehicle, 
    updateVehicle, 
    deleteVehicle 
  } = useSupabaseVehicles();
  
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

  // Wrap remove function to use deleteVehicle from Supabase
  const removeVehicle = (id: number) => {
    handleRemove(id);
    deleteVehicle(id);
  };

  return {
    vehicles,
    loading,
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
    handleRemove: removeVehicle,
    toggleVehicleSelection: toggleSelection,
    handleBulkVerify: bulkVerify,
    handleBulkAddToGarage: bulkAddToGarage,
    handleBulkRemove: bulkRemove,
    refreshVehicles: fetchVehicles,
    addVehicle,
    updateVehicle
  };
}
