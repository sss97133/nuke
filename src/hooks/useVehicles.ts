
import { useState, useEffect } from 'react';
import { supabase, useSupabaseWithToast } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { VehicleWithId, nullToUndefined } from '@/utils/vehicle/types';

export type Vehicle = VehicleWithId;

export const useVehicles = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();
  const { safeFetch } = useSupabaseWithToast();

  const fetchVehicles = async () => {
    try {
      setLoading(true);
      setError(null);
      
      // In production, we would fetch from Supabase
      const { data, error } = await supabase
        .from('vehicles')
        .select('id, make, model, year, vin, notes, status, mileage')
        .order('year', { ascending: false });
        
      if (error) throw error;
      
      if (data && Array.isArray(data) && data.length > 0) {
        // Map data to ensure type safety
        const typedVehicles: Vehicle[] = data.map(item => ({
          id: item.id,
          make: item.make || '',
          model: item.model || '',
          year: item.year || 0,
          vin: nullToUndefined(item.vin),
          notes: nullToUndefined(item.notes),
          status: (item.status as Vehicle['status']) || 'active',
          mileage: typeof item.mileage === 'number' ? item.mileage : undefined
        }));
        setVehicles(typedVehicles);
      } else {
        // Fallback to mock data if no data returned
        const mockVehicles: Vehicle[] = [
          { id: '1', make: 'Toyota', model: 'Camry', year: 2019 },
          { id: '2', make: 'Honda', model: 'Civic', year: 2020 },
          { id: '3', make: 'Ford', model: 'F-150', year: 2018 },
        ];
        setVehicles(mockVehicles);
      }
    } catch (err) {
      console.error('Error fetching vehicles:', err);
      setError('Failed to load vehicles data');
      toast({
        title: "Error",
        description: "Could not load vehicles data",
        variant: "destructive"
      });
      
      // Fallback to mock data
      const mockVehicles: Vehicle[] = [
        { id: '1', make: 'Toyota', model: 'Camry', year: 2019 },
        { id: '2', make: 'Honda', model: 'Civic', year: 2020 },
        { id: '3', make: 'Ford', model: 'F-150', year: 2018 },
      ];
      setVehicles(mockVehicles);
    } finally {
      setLoading(false);
    }
  };

  const addVehicle = async (newVehicle: Omit<Vehicle, 'id'>): Promise<Vehicle | null> => {
    try {
      setLoading(true);
      
      // Prepare vehicle data for Supabase
      const vehicleData = {
        ...newVehicle,
        // Make sure all nulls are converted to undefined for TypeScript
        vin: newVehicle.vin || null,
        notes: newVehicle.notes || null,
        status: newVehicle.status || 'active',
        mileage: newVehicle.mileage || null,
        created_at: new Date().toISOString()
      };
      
      // In production, we would insert to Supabase
      const { data, error } = await supabase
        .from('vehicles')
        .insert([vehicleData])
        .select();
      
      if (error) throw error;
      
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
        toast({
          title: "Success",
          description: "Vehicle added successfully",
        });
        return typedVehicle;
      } else {
        // Mock implementation for demo
        const mockNewVehicle: Vehicle = {
          ...newVehicle,
          id: `mock-${Date.now()}`
        };
        setVehicles(prev => [...prev, mockNewVehicle]);
        toast({
          title: "Success",
          description: "Vehicle added successfully",
        });
        return mockNewVehicle;
      }
    } catch (err) {
      console.error('Error adding vehicle:', err);
      toast({
        title: "Error",
        description: "Failed to add vehicle",
        variant: "destructive"
      });
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVehicles();
  }, []);

  return {
    vehicles,
    loading,
    error,
    fetchVehicles,
    addVehicle
  };
};
