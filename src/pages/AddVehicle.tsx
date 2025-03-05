
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAuth } from '@/hooks/use-auth';
import VehicleForm from '@/components/vehicles/forms/VehicleForm';
import { VehicleFormValues } from '@/components/vehicles/forms/types';
import { useCreateVehicle } from '@/hooks/vehicles/useCreateVehicle';
import { useToast } from '@/hooks/use-toast';

const AddVehicle = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
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
        // Handle image(s) - use the first image as the main image if it's an array
        image: Array.isArray(data.image) 
          ? (data.image.length > 0 ? data.image[0] : import.meta.env.VITE_PLACEHOLDER_VEHICLE_IMAGE || '/placeholder-vehicle.jpg')
          : (data.image || import.meta.env.VITE_PLACEHOLDER_VEHICLE_IMAGE || '/placeholder-vehicle.jpg'),
        // Add additional images array if multiple images were uploaded
        additional_images: Array.isArray(data.image) && data.image.length > 1 
          ? data.image.slice(1) 
          : [],
      };
      
      // Create the vehicle - pass as any to bypass the type check since we've processed the data
      await createVehicle(processedData as any);
      
      // Get appropriate message and redirect based on ownership status
      let successMessage = '';
      let redirectPath = '';
      
      switch (data.ownership_status) {
        case 'owned':
          successMessage = `Your ${data.make} ${data.model} has been added to your garage.`;
          redirectPath = '/garage';
          break;
        case 'claimed':
          successMessage = `Your claimed ${data.make} ${data.model} has been added. You can verify ownership later.`;
          redirectPath = '/garage';
          break;
        case 'discovered':
          successMessage = `The discovered ${data.make} ${data.model} has been added to your discoveries.`;
          redirectPath = '/discovered-vehicles';
          break;
      }
      
      // Display success message
      toast({
        title: "Vehicle added successfully",
        description: successMessage,
      });
      
      // Redirect based on ownership status
      navigate(redirectPath);
    } catch (error) {
      console.error('Error creating vehicle:', error);
      toast({
        title: "Error adding vehicle",
        description: "There was a problem adding your vehicle. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <ScrollArea className="h-[calc(100vh-4rem)]">
      <div className="container mx-auto p-6 max-w-6xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">Add Vehicle</h1>
          <p className="text-muted-foreground">
            Add a vehicle you own, claim, or have discovered. Provide as much detail as possible for accurate tracking.
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
