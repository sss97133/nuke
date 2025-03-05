
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { VehicleFormValues } from '@/components/vehicles/forms/VehicleForm';
import { Vehicle } from '@/components/vehicles/discovery/types';

export function useCreateVehicle() {
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  /**
   * Creates a new vehicle record in the database
   */
  const createVehicle = async (vehicleData: VehicleFormValues & { user_id: string, added: string, image: string }): Promise<Vehicle | null> => {
    try {
      setIsLoading(true);
      setError(null);

      // Prepare the data for insertion
      const vehicleRecord = {
        user_id: vehicleData.user_id,
        make: vehicleData.make,
        model: vehicleData.model,
        year: vehicleData.year,
        trim: vehicleData.trim || null,
        price: vehicleData.price || null,
        mileage: vehicleData.mileage,
        location: vehicleData.location,
        body_type: vehicleData.body_type || null,
        engine_type: vehicleData.engine_type || null,
        transmission: vehicleData.transmission || null,
        drivetrain: vehicleData.drivetrain || null,
        condition_rating: vehicleData.condition_rating,
        condition_description: vehicleData.condition_description || null,
        restoration_status: vehicleData.restoration_status || null,
        ownership_count: vehicleData.ownership_count || null,
        accident_history: vehicleData.accident_history,
        service_history: vehicleData.service_history,
        vehicle_type: vehicleData.vehicle_type,
        era: vehicleData.era || null,
        special_edition: vehicleData.special_edition,
        rarity_score: vehicleData.rarity_score || null,
        tags: vehicleData.tags || [],
        image_url: vehicleData.image,
        created_at: vehicleData.added,
        
        // Default values for marketplace functionality
        is_for_sale: false,
        is_verified: false,
        relevance_score: 50, // Default middle value
        views_count: 0,
        saves_count: 0,
        interested_users: 0,
        market_value: vehicleData.price || null,
        price_trend: 'stable' as const,
      };

      // Insert the vehicle data
      const { data, error: supabaseError } = await supabase
        .from('vehicles')
        .insert(vehicleRecord)
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      if (vehicleData.images) {
        // Here you would handle image uploads to storage
        // This is a simplified placeholder for actual image upload logic
        console.log('Would upload images:', vehicleData.images);
        
        // Actual implementation would include:
        // 1. Loop through images
        // 2. Upload each to storage bucket
        // 3. Get public URLs
        // 4. Update the vehicle record with image references
      }

      toast({
        title: "Vehicle Created",
        description: `Your ${vehicleData.year} ${vehicleData.make} ${vehicleData.model} has been successfully added.`,
      });

      return data as Vehicle;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to create vehicle';
      setError(errorMessage);
      
      toast({
        title: "Error Creating Vehicle",
        description: errorMessage,
        variant: "destructive",
      });
      
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Updates an existing vehicle record
   */
  const updateVehicle = async (id: number | string, vehicleData: Partial<VehicleFormValues>): Promise<Vehicle | null> => {
    try {
      setIsLoading(true);
      setError(null);

      // Process tags if provided
      let processedData = { ...vehicleData };
      if (typeof vehicleData.tags === 'string') {
        processedData.tags = vehicleData.tags.split(',').map(tag => tag.trim());
      }

      // Update the vehicle data
      const { data, error: supabaseError } = await supabase
        .from('vehicles')
        .update(processedData)
        .eq('id', id)
        .select()
        .single();

      if (supabaseError) {
        throw supabaseError;
      }

      toast({
        title: "Vehicle Updated",
        description: "Vehicle details have been successfully updated.",
      });

      return data as Vehicle;
    } catch (err: any) {
      const errorMessage = err.message || 'Failed to update vehicle';
      setError(errorMessage);
      
      toast({
        title: "Error Updating Vehicle",
        description: errorMessage,
        variant: "destructive",
      });
      
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    createVehicle,
    updateVehicle,
    isLoading,
    error
  };
}
