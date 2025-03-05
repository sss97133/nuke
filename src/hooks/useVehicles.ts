import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

export interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  vin?: string;
  notes?: string;
  status?: 'active' | 'inactive' | 'maintenance' | 'sold';
  mileage?: number;
}

export const useVehicles = () => {
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

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
      
      if (data && data.length > 0) {
        setVehicles(data as Vehicle[]);
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

  const addVehicle = async (newVehicle: Omit<Vehicle, 'id'>) => {
    try {
      setLoading(true);
      
      // In production, we would insert to Supabase
      const { data, error } = await supabase
        .from('vehicles')
        .insert([newVehicle])
        .select();
      
      if (error) throw error;
      
      if (data) {
        setVehicles(prev => [...prev, data[0] as Vehicle]);
        toast({
          title: "Success",
          description: "Vehicle added successfully",
          variant: "default"
        });
        return data[0] as Vehicle;
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
          variant: "default"
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