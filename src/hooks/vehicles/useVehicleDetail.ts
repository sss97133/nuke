
import { useState, useEffect } from 'react';
import { Vehicle } from '../../components/vehicles/discovery/types';
import { mockVehicles } from './mockVehicleData';
import { useToast } from "@/components/ui/use-toast";

/**
 * Hook for fetching a single vehicle by ID from mock data
 * In a real app, this would fetch from an API
 */
export function useVehicleDetail(id: number | string) {
  const [vehicle, setVehicle] = useState<Vehicle | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    const fetchVehicle = async () => {
      try {
        setLoading(true);
        setError(null);
        
        // Simulate API request latency
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Convert string ID to number if needed
        const vehicleId = typeof id === 'string' ? parseInt(id) : id;
        
        // Find the vehicle in our mock data
        const foundVehicle = mockVehicles.find(v => v.id === vehicleId);
        
        if (foundVehicle) {
          setVehicle(foundVehicle);
        } else {
          setError('Vehicle not found');
          toast({
            title: "Vehicle not found",
            description: "The requested vehicle could not be found.",
            variant: "destructive",
          });
        }
      } catch (err) {
        console.error("Error fetching vehicle:", err);
        setError('Failed to load vehicle details');
        toast({
          title: "Error",
          description: "Failed to load vehicle details. Please try again.",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      fetchVehicle();
    }
  }, [id, toast]);

  return { vehicle, loading, error };
}
