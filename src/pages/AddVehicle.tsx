
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from '@/hooks/use-auth';
import VehicleForm, { VehicleFormValues } from '@/components/vehicles/forms/VehicleForm';
import { useCreateVehicle } from '@/hooks/vehicles/useCreateVehicle';

const AddVehicle = () => {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { createVehicle } = useCreateVehicle();

  // Redirect to login if not authenticated
  if (!session) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <h1 className="text-2xl font-bold mb-4">Authentication Required</h1>
          <p className="mb-6">You need to be logged in to add a vehicle.</p>
          <button 
            className="px-4 py-2 bg-primary text-white rounded-md"
            onClick={() => navigate('/login', { state: { from: '/add-vehicle' } })}
          >
            Log In
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (data: VehicleFormValues) => {
    try {
      setIsSubmitting(true);
      
      // Process form data for submission
      const processedData = {
        ...data,
        // Convert comma-separated tags string to array if it exists
        tags: data.tags 
          ? data.tags.split(',')
              .map(tag => tag.trim())
              .filter(tag => tag.length > 0)
          : [],
        // Add current timestamp
        added: new Date().toISOString(),
        // Add user ID from session
        user_id: session.user.id,
        // Generate placeholder image if not provided
        image: data.image || import.meta.env.VITE_PLACEHOLDER_VEHICLE_IMAGE || '/placeholder-vehicle.jpg',
      };
      
      // Create the vehicle - pass as any to bypass the type check since we've processed the data
      await createVehicle(processedData as any);
      
      // Redirect to discovered vehicles page
      navigate('/discovered-vehicles');
    } catch (error) {
      console.error('Error creating vehicle:', error);
      throw error;
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container mx-auto p-6 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Add New Vehicle</h1>
          <p className="text-muted-foreground">
            Fill out the form below to add a new vehicle to your collection. 
            The more detailed information you provide, the better.
          </p>
        </div>
        
        <VehicleForm 
          onSubmit={handleSubmit} 
          isSubmitting={isSubmitting}
        />
      </div>
    </ScrollArea>
  );
};

export default AddVehicle;
