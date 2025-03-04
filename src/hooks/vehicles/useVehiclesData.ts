
import { useState, useEffect } from 'react';
import { SortDirection, SortField, Vehicle } from '../../components/vehicles/discovery/types';
import { supabase } from "@/integrations/supabase/client";
import { 
  handleVerify, 
  handleEdit, 
  handleRemove, 
  handleBulkVerify,
  handleBulkAddToGarage,
  handleBulkRemove,
  toggleVehicleSelection
} from './vehicleActions';
import { toast } from "sonner";

export function useVehiclesData() {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedVehicles, setSelectedVehicles] = useState<number[]>([]);
  const [bulkActionOpen, setBulkActionOpen] = useState(false);
  const [viewMode, setViewMode] = useState("grid");
  const [sortField, setSortField] = useState<SortField>("added");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  
  // Fetch real vehicles data from Supabase
  useEffect(() => {
    async function fetchVehicles() {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('vehicles')
          .select('*')
          .order(sortField, { ascending: sortDirection === 'asc' });
          
        if (error) {
          throw error;
        }
        
        // Map Supabase data to the Vehicle type
        const mappedVehicles: Vehicle[] = data.map((item: any, index: number) => ({
          id: index + 1, // Use index+1 for compatibility with existing code
          supabaseId: item.id, // Store the actual Supabase UUID
          make: item.make,
          model: item.model,
          year: item.year,
          trim: item.trim || undefined,
          price: item.price || 0,
          market_value: item.market_value || 0,
          price_trend: item.price_trend as 'up' | 'down' | 'stable' || 'stable',
          mileage: item.mileage || 0,
          image: item.image || 'https://placehold.co/600x400?text=No+Image',
          location: item.location?.city || 'Unknown',
          added: new Date(item.added || item.created_at).toLocaleDateString(),
          tags: item.tags || [],
          body_type: item.body_type,
          engine_type: item.engine_type,
          transmission: item.transmission,
          drivetrain: item.drivetrain,
          condition_rating: item.condition_rating || 5,
          condition_description: item.condition_description,
          vehicle_type: item.vehicle_type || 'car',
          era: item.era,
          special_edition: item.special_edition || false,
          rarity_score: item.rarity_score || 1,
          relevance_score: item.relevance_score || 50
        }));
        
        setVehicles(mappedVehicles);
      } catch (err) {
        console.error("Error fetching vehicles:", err);
        setError(err.message);
        toast.error("Failed to load vehicles data");
      } finally {
        setLoading(false);
      }
    }
    
    fetchVehicles();
  }, [sortField, sortDirection]);
  
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
    handleRemove,
    toggleVehicleSelection: toggleSelection,
    handleBulkVerify: bulkVerify,
    handleBulkAddToGarage: bulkAddToGarage,
    handleBulkRemove: bulkRemove
  };
}
