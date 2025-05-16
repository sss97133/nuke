import type { Database } from '@/types/database';
import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Vehicle } from '@/components/vehicles/discovery/types';
import { getStoredVehicleById, getRelationshipsForVehicle } from './mockVehicleStorage';
import { PostgrestError } from '@supabase/supabase-js';

interface VehicleRelationship {
  id: string;
  vehicle_id: string;
  related_vehicle_id: string;
  relationship_type: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

export const useVehicleDetail = (id: string) => {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [relationships, setRelationships] = useState<VehicleRelationship[]>([]);

  useEffect(() => {
    const fetchVehicleDetail = async () => {
      setLoading(true);
      try {
        // First try to fetch from real data in Supabase
        const { data: vehicleData, error: vehicleError } = await supabase
          .from('vehicles')
          .select('*')
          .eq('id', id)
          .single();
        
        if (vehicleData && !vehicleError) {
          console.log('Vehicle found in Supabase:', vehicleData);
          
          // Get relationships for this vehicle if they exist
          const { data: relationshipsData, error: relationshipsError } = await supabase
            .from('vehicle_relationships')
            .select('*')
            .eq('vehicle_id', id);
          
          if (!relationshipsError) {
            setRelationships(relationshipsData || []);
          }
          
          setVehicle(adaptVehicleFromDB(vehicleData));
          setError(null);
          return;
        }
        
        // If not found in Supabase, fallback to mock data
        // Check if ID is numeric for mock data
        const numericId = parseInt(id, 10);
        if (!isNaN(numericId)) {
          const mockVehicle = getStoredVehicleById(numericId);
          
          if (mockVehicle) {
            console.log('Vehicle found in mock storage:', mockVehicle);
            const mockRelationships = getRelationshipsForVehicle(numericId);
            setVehicle(mockVehicle);
            setRelationships(mockRelationships as unknown as VehicleRelationship[]);
            setError(null);
            return;
          }
        }
        
        // If we get here, no vehicle was found
        throw new Error('Vehicle not found');
        
      } catch (err) {
        const error = err as Error;
        console.error('Error fetching vehicle details:', error);
        setError(error.message || 'Failed to load vehicle details');
        setVehicle(null);
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchVehicleDetail();
    }
  }, [id]);

  return { vehicle, loading, error, relationships };
};

// Helper function to adapt database vehicle format to our app's Vehicle type
const adaptVehicleFromDB = (dbVehicle: Database['public']['Tables']['vehicles']['Row']): Vehicle => {
  return {
    id: Number(dbVehicle.id),
    make: dbVehicle.make,
    model: dbVehicle.model,
    year: dbVehicle.year,
    mileage: dbVehicle.mileage || 0,
    image: '', // We'll need to fetch this from vehicle_images table
    location: dbVehicle.purchase_location || '',
    added: dbVehicle.created_at,
    condition_rating: 5, // Default value
    vehicle_type: 'car', // Default value
    price: dbVehicle.current_value,
    market_value: dbVehicle.current_value,
    price_trend: 'stable' as const,
    tags: dbVehicle.tags || [],
    body_type: '', // Not in DB
    engine_type: dbVehicle.engine_type || '',
    transmission: '', // Not in DB
    drivetrain: '', // Not in DB
    condition_description: dbVehicle.notes || '',
    restoration_status: 'original' as const,
    notable_issues: [],
    ownership_count: 0,
    accident_history: false,
    service_history: false,
    last_service_date: undefined,
    era: determineEra(dbVehicle.year),
    special_edition: false,
    rarity_score: 0,
    market_trends: undefined,
    relevance_score: undefined,
    views_count: undefined,
    saves_count: undefined,
    interested_users: undefined,
    status: (dbVehicle.status || 'discovered') as 'owned' | 'claimed' | 'discovered' | 'verified' | 'unverified',
    source: 'database',
    source_url: ''
  };
};

// Helper to format the "added" date
const formatAddedDate = (dateString: string): string => {
  if (!dateString) return '';
  
  const date = new Date(dateString);
  const now = new Date();
  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24));
  
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays} days ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} weeks ago`;
  
  return date.toLocaleDateString();
};

// Helper to determine the "era" based on year
const determineEra = (year: number): string => {
  if (!year) return '';
  
  if (year < 1920) return 'pre-war';
  if (year < 1930) return '20s';
  if (year < 1940) return '30s';
  if (year < 1950) return '40s';
  if (year < 1960) return '50s';
  if (year < 1970) return '60s';
  if (year < 1980) return '70s';
  if (year < 1990) return '80s';
  if (year < 2000) return '90s';
  if (year < 2010) return '00s';
  if (year < 2020) return '10s';
  
  return 'modern';
};
