import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { PostgrestError } from '@supabase/supabase-js';

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  vin?: string;
  notes?: string;
  status: 'active' | 'inactive' | 'sold' | 'pending';
  mileage?: number;
}

export interface NewVehicle {
  make: string;
  model: string;
  year: number;
  vin?: string;
  notes?: string;
  status?: Vehicle['status'];
  mileage?: number;
}

// Handle null values from the database
const nullToUndefined = <T>(value: T | null): T | undefined => {
  return value === null ? undefined : value;
};

export const useVehicles = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<PostgrestError | null>(null);

  // Fetch all vehicles
  const fetchVehicles = async () => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .order('year', { ascending: false });

      if (error) {
        setError(error);
        console.error("Error fetching vehicles:", error);
        return;
      }

      if (data) {
        const typedVehicles: Vehicle[] = data.map(item => ({
          id: item.id,
          make: item.make || '',
          model: item.model || '',
          year: item.year || 0,
          vin: nullToUndefined(item.vin),
          notes: nullToUndefined(item.notes),
          status: item.status as Vehicle['status'] || 'active',
          mileage: typeof item.mileage === 'number' ? item.mileage : undefined
        }));
        setVehicles(typedVehicles);
      }
    } catch (err) {
      const error = err as Error;
      console.error("Error in fetchVehicles:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Add a new vehicle
  const addVehicle = async (newVehicle: NewVehicle) => {
    setIsLoading(true);
    setError(null);

    try {
      const vehicleData = {
        ...newVehicle,
        // Make sure all nulls are converted to undefined for TypeScript
        vin: newVehicle.vin || null,
        notes: newVehicle.notes || null,
        status: newVehicle.status || 'active',
        mileage: newVehicle.mileage || null,
        created_at: new Date().toISOString()
      };
      
      // Insert to Supabase
      const { data, error } = await supabase
        .from('vehicles')
        .insert([vehicleData])
        .select();
      
      if (error) {
        console.error("Database query error:", error);
        setError(error);
        return;
      }
      
      if (data && Array.isArray(data) && data.length > 0) {
        const typedVehicle: Vehicle = {
          id: data[0].id,
          make: data[0].make || '',
          model: data[0].model || '',
          year: data[0].year || 0,
          vin: nullToUndefined(data[0].vin),
          notes: nullToUndefined(data[0].notes),
          status: data[0].status as Vehicle['status'] || 'active',
          mileage: typeof data[0].mileage === 'number' ? data[0].mileage : undefined
        };
        setVehicles(prev => [...prev, typedVehicle]);
        return typedVehicle;
      }
    } catch (err) {
      const error = err as Error;
      console.error("Error in addVehicle:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Update an existing vehicle
  const updateVehicle = async (id: string, updates: Partial<NewVehicle>) => {
    setIsLoading(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from('vehicles')
        .update(updates)
        .eq('id', id)
        .select();
      
      if (error) {
        console.error("Database query error:", error);
        setError(error);
        return;
      }
      
      if (data && data.length > 0) {
        setVehicles(prev => 
          prev.map(vehicle => 
            vehicle.id === id 
              ? {
                  ...vehicle,
                  ...updates,
                  vin: nullToUndefined(updates.vin !== undefined ? updates.vin : vehicle.vin),
                  notes: nullToUndefined(updates.notes !== undefined ? updates.notes : vehicle.notes),
                  mileage: updates.mileage !== undefined ? updates.mileage : vehicle.mileage
                }
              : vehicle
          )
        );
        return data[0];
      }
    } catch (err) {
      const error = err as Error;
      console.error("Error in updateVehicle:", error);
    } finally {
      setIsLoading(false);
    }
  };

  // Delete a vehicle
  const deleteVehicle = async (id: string) => {
    setIsLoading(true);
    setError(null);

    try {
      const { error } = await supabase
        .from('vehicles')
        .delete()
        .eq('id', id);
      
      if (error) {
        console.error("Database query error:", error);
        setError(error);
        return false;
      }
      
      setVehicles(prev => prev.filter(vehicle => vehicle.id !== id));
      return true;
    } catch (err) {
      const error = err as Error;
      console.error("Error in deleteVehicle:", error);
      return false;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    vehicles,
    isLoading,
    error,
    fetchVehicles,
    addVehicle,
    updateVehicle,
    deleteVehicle
  };
};
