import { useState, useEffect } from 'react';
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
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/use-auth';
import { Vehicle } from '../../components/vehicles/discovery/types';
import { getStoredVehicles, getVehiclesByRelationship } from './mockVehicleStorage';

// Feature flag for gradual migration
const USE_REAL_DATA = {
  vehicles: true
};

// Adapter function to map database fields to component-expected schema
function adaptVehicleFromDB(dbVehicle: any): Vehicle {
  return {
    id: dbVehicle.id,
    make: dbVehicle.make || '',
    model: dbVehicle.model || '',
    year: dbVehicle.year || 0,
    price: dbVehicle.price || 0,
    market_value: dbVehicle.market_value || dbVehicle.price || 0,
    price_trend: dbVehicle.price_trend || 'stable',
    mileage: dbVehicle.mileage || 0,
    image: dbVehicle.image_url || '/placeholder.png',
    location: dbVehicle.location || '',
    added: dbVehicle.created_at ? getRelativeTimeString(new Date(dbVehicle.created_at)) : '',
    tags: dbVehicle.tags || [],
    condition_rating: dbVehicle.condition_rating || 5,
    vehicle_type: dbVehicle.vehicle_type || '',
    body_type: dbVehicle.body_type || '',
    transmission: dbVehicle.transmission || '',
    drivetrain: dbVehicle.drivetrain || '',
    rarity_score: dbVehicle.rarity_score || 0,
    era: dbVehicle.era || '',
    restoration_status: dbVehicle.restoration_status || 'original',
    special_edition: dbVehicle.special_edition || false
  };
}

// Helper function to convert timestamp to "X days ago" format
function getRelativeTimeString(date: Date): string {
  const now = new Date();
  const diffInMs = now.getTime() - date.getTime();
  const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24));
  
  if (diffInDays === 0) return 'today';
  if (diffInDays === 1) return 'yesterday';
  if (diffInDays < 7) return `${diffInDays} days ago`;
  if (diffInDays < 30) return `${Math.floor(diffInDays / 7)} weeks ago`;
  return `${Math.floor(diffInDays / 30)} months ago`;
}

export function useVehiclesData() {
  const { session } = useAuth();
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedVehicles, setSelectedVehicles] = useState<number[]>([]);
  const [bulkActionOpen, setBulkActionOpen] = useState(false);
  const [viewMode, setViewMode] = useState("grid");
  const [sortField, setSortField] = useState<SortField>("added");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  
  // Add state for vehicles data
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Fetch vehicles data
  useEffect(() => {
    let isMounted = true;
    
    async function fetchVehicles() {
      try {
        setIsLoading(true);
        console.log('Fetching vehicles...');
        
        if (USE_REAL_DATA.vehicles) {
          // Try to get authenticated user
          const userId = session?.user?.id;
          
          if (!userId) {
            console.log('User not authenticated, using mock data');
            if (isMounted) {
              // Use getStoredVehicles to get mock vehicles
              const mockVehicles = getStoredVehicles();
              console.log('Loaded mock vehicles:', mockVehicles.length);
              setVehicles(mockVehicles);
              setIsLoading(false);
            }
            return;
          }
          
          // Real implementation would fetch from database with relationship filter
          // This would fetch vehicles from the database based on user-vehicle relationships
          try {
            /*
            // This would be the real implementation with the database
            const { data: relationships, error: relError } = await supabase
              .from('vehicle_relationships')
              .select('vehicle_id')
              .eq('user_id', userId)
              .eq('relationship_type', 'discovered');
              
            if (relError) throw relError;
            
            const vehicleIds = relationships.map(rel => rel.vehicle_id);
            
            if (vehicleIds.length > 0) {
              const { data: vehiclesData, error: vehicleError } = await supabase
                .from('vehicles')
                .select('*')
                .in('id', vehicleIds);
                
              if (vehicleError) throw vehicleError;
              
              if (isMounted) {
                const adaptedVehicles = vehiclesData.map(adaptVehicleFromDB);
                setVehicles(adaptedVehicles);
              }
            } else {
              if (isMounted) {
                setVehicles([]);
              }
            }
            */
            
            // Mock implementation using our in-memory storage
            const discoveredVehicles = getVehiclesByRelationship(userId, 'discovered');
            if (isMounted) {
              setVehicles(discoveredVehicles);
            }
          } catch (err) {
            console.error('Error fetching relationships:', err);
            if (isMounted) {
              setError('Failed to fetch vehicle relationships');
              
              // Fall back to mock data
              const mockVehicles = getVehiclesByRelationship('mock-user-1', 'discovered');
              console.log('Loaded mock vehicles (fallback):', mockVehicles.length);
              setVehicles(mockVehicles);
            }
          }
        } else {
          // Use mock data directly when feature flag is off
          if (isMounted) {
            // Use mock data with relationship filter
            const mockVehicles = getVehiclesByRelationship('mock-user-1', 'discovered');
            console.log('Loaded mock vehicles:', mockVehicles.length);
            setVehicles(mockVehicles);
          }
        }
      } catch (err) {
        console.error('Error fetching vehicles:', err);
        
        if (isMounted) {
          // Set error message
          setError(err.message || 'Failed to fetch vehicles');
          
          // Fall back to mock data
          const mockVehicles = getVehiclesByRelationship('mock-user-1', 'discovered');
          console.log('Loaded mock vehicles (fallback):', mockVehicles.length);
          setVehicles(mockVehicles);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }
    
    fetchVehicles();
    
    // Cleanup function
    return () => {
      isMounted = false;
    };
  }, [session, sortField, sortDirection]);
  
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
    handleBulkRemove: bulkRemove
  };
}
