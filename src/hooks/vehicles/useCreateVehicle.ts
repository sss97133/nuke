
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { VehicleFormValues } from '@/components/vehicles/forms/VehicleForm';
import { useToast } from '@/hooks/use-toast';
import { Vehicle } from '@/components/vehicles/discovery/types';
import { addStoredVehicle } from './mockVehicleStorage';

interface Vehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  mileage?: number;
  image: string;
  added: string;
  [key: string]: any;
}

export const useCreateVehicle = () => {
  const [isLoading, setIsLoading] = useState(false);
  const { toast } = useToast();

  const createVehicle = async (data: VehicleFormValues & { 
    user_id: string;
    added: string;
    tags: string[];
  }) => {
    setIsLoading(true);
    
    try {
      console.log('Creating vehicle with data:', data);
      
      // For now, return a mock response
      const mockResponse = {
        id: `vehicle_${Date.now()}`,
        ...data,
        created_at: new Date().toISOString(),
        // Transform to match the Vehicle type from discovery/types
        price: 0,
        market_value: 0,
        price_trend: 'stable',
        image: data.image || '/placeholder-vehicle.jpg',
        location: 'Local',
        added: data.added,
        tags: data.tags || [],
        condition_rating: 5,
        vehicle_type: 'car',
        body_type: '',
        transmission: '',
        drivetrain: '',
        rarity_score: 0,
        era: '',
        restoration_status: '',
        special_edition: false
      };
      
      // Simulate API delay
      await new Promise(resolve => setTimeout(resolve, 800));
      
      // Add to our mock storage
      addStoredVehicle(mockResponse as unknown as Vehicle);
      
      toast({
        title: 'Vehicle added',
        description: `Successfully added ${data.year} ${data.make} ${data.model}`,
      });
      
      return mockResponse as unknown as Vehicle;
      
      /*
      // NOTE: Commented out until we have proper database tables
      const { data: vehicle, error } = await supabase
        .from('vehicles')
        .insert({
          make: data.make,
          model: data.model,
          year: data.year,
          trim: data.trim || null,
          color: data.color || null,
          vin: data.vin || null,
          mileage: data.mileage || 0,
          notes: data.notes || null,
          image: data.image || null,
          user_id: data.user_id,
          status: 'owned',
          added: new Date().toISOString()
        })
        .select()
        .single();

      if (error) {
        throw error;
      }

      // If tags were provided, save them
      if (data.tags && Array.isArray(data.tags) && data.tags.length > 0) {
        // Create tag entries
        const tagInserts = data.tags.map(tag => ({
          vehicle_id: vehicle.id,
          tag_name: tag.trim(),
          user_id: data.user_id
        }));

        const { error: tagError } = await supabase
          .from('vehicle_tags')
          .insert(tagInserts);

        if (tagError) {
          // Log but don't fail the entire operation
          console.error('Error saving vehicle tags:', tagError);
        }
      }

      toast({
        title: 'Vehicle added',
        description: `Successfully added ${vehicle.year} ${vehicle.make} ${vehicle.model}`,
      });

      return vehicle as Vehicle;
      */
    } catch (error) {
      console.error('Error creating vehicle:', error);
      toast({
        title: 'Error',
        description: 'Failed to add vehicle. Please try again.',
        variant: 'destructive',
      });
      throw error;
    } finally {
      setIsLoading(false);
    }
  };

  return {
    createVehicle,
    isLoading,
  };
};
