import { useState } from 'react';
import { SortDirection, SortField, Vehicle } from '../../components/vehicles/discovery/types';
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
import { PostgrestError } from '@supabase/supabase-js';
import { useToast } from '@/hooks/use-toast';

export function useVehiclesData(vehicleStatus: 'discovered' | 'owned' = 'discovered'): UseVehiclesDataResult {
  const { session } = useAuth();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState<string>("");
  const [selectedVehicles, setSelectedVehicles] = useState<number[]>([]);
  const [bulkActionOpen, setBulkActionOpen] = useState<boolean>(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>("grid");
  const [sortField, setSortField] = useState<SortField>("added");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [isActionLoading, setIsActionLoading] = useState<boolean>(false);
  
  // Use the vehicle fetcher hook to handle data fetching
  const { vehicles, isLoading, error } = useVehiclesFetcher(
    vehicleStatus,
    session,
    sortField,
    sortDirection
  );
  
  // Wrapper for toggle selection that includes the current state
  const toggleSelection = (id: number): void => {
    toggleVehicleSelection(id, selectedVehicles, setSelectedVehicles);
  };
  
  // Single vehicle action handlers
  const verifyVehicle = async (id: number): Promise<void> => {
    setIsActionLoading(true);
    try {
      await handleVerify(id);
      toast({
        title: "Success",
        description: "Vehicle verified successfully",
        variant: "success"
      });
    } catch (err) {
      const error = err as PostgrestError;
      toast({
        title: "Error",
        description: error.message || "Failed to verify vehicle",
        variant: "destructive"
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const editVehicle = async (id: number): Promise<void> => {
    setIsActionLoading(true);
    try {
      await handleEdit(id);
      toast({
        title: "Success",
        description: "Vehicle updated successfully",
        variant: "success"
      });
    } catch (err) {
      const error = err as PostgrestError;
      toast({
        title: "Error",
        description: error.message || "Failed to update vehicle",
        variant: "destructive"
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  const removeVehicle = async (id: number): Promise<void> => {
    setIsActionLoading(true);
    try {
      await handleRemove(id);
      toast({
        title: "Success",
        description: "Vehicle removed successfully",
        variant: "success"
      });
    } catch (err) {
      const error = err as PostgrestError;
      toast({
        title: "Error",
        description: error.message || "Failed to remove vehicle",
        variant: "destructive"
      });
    } finally {
      setIsActionLoading(false);
    }
  };
  
  // Bulk action handlers with cleanup
  const bulkVerify = async (): Promise<void> => {
    setIsActionLoading(true);
    try {
      await handleBulkVerify(selectedVehicles);
      setSelectedVehicles([]);
      setBulkActionOpen(false);
      toast({
        title: "Success",
        description: "Vehicles verified successfully",
        variant: "success"
      });
    } catch (err) {
      const error = err as PostgrestError;
      toast({
        title: "Error",
        description: error.message || "Failed to verify vehicles",
        variant: "destructive"
      });
    } finally {
      setIsActionLoading(false);
    }
  };
  
  const bulkAddToGarage = async (): Promise<void> => {
    setIsActionLoading(true);
    try {
      await handleBulkAddToGarage(selectedVehicles);
      setSelectedVehicles([]);
      setBulkActionOpen(false);
      toast({
        title: "Success",
        description: "Vehicles added to garage successfully",
        variant: "success"
      });
    } catch (err) {
      const error = err as PostgrestError;
      toast({
        title: "Error",
        description: error.message || "Failed to add vehicles to garage",
        variant: "destructive"
      });
    } finally {
      setIsActionLoading(false);
    }
  };
  
  const bulkRemove = async (): Promise<void> => {
    setIsActionLoading(true);
    try {
      await handleBulkRemove(selectedVehicles);
      setSelectedVehicles([]);
      setBulkActionOpen(false);
      toast({
        title: "Success",
        description: "Vehicles removed successfully",
        variant: "success"
      });
    } catch (err) {
      const error = err as PostgrestError;
      toast({
        title: "Error",
        description: error.message || "Failed to remove vehicles",
        variant: "destructive"
      });
    } finally {
      setIsActionLoading(false);
    }
  };

  return {
    vehicles,
    isLoading: isLoading || isActionLoading,
    error: error?.message || null,
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
    handleVerify: verifyVehicle,
    handleEdit: editVehicle,
    handleRemove: removeVehicle,
    toggleVehicleSelection: toggleSelection,
    handleBulkVerify: bulkVerify,
    handleBulkAddToGarage: bulkAddToGarage,
    handleBulkRemove: bulkRemove,
    vehicleStatus
  };
}
