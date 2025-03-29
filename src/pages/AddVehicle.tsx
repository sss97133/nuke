import type { Database } from '../types';
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/components/ui/use-toast';
import { useVehicleForm } from '@/components/vehicles/forms/hooks/useVehicleForm';
import { useNavigationProtection } from '@/hooks/useNavigationProtection';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase, handleDatabaseError } from '@/integrations/supabase/client';
import ImageUploader from '@/components/vehicle-images/ImageUploader';
import VehicleForm from '@/components/vehicles/forms/VehicleForm';

function AddVehicle() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isFormModified, setIsFormModified] = useState(false);
  const [primaryImageUrl, setPrimaryImageUrl] = useState<string | null>(null);

  const {
    form,
    handleSubmit,
    isSubmitting,
    submitError,
  } = useVehicleForm({
    onSubmitSuccess: async (data) => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
          throw new Error('User not authenticated');
        }

        // Insert the vehicle data into the database
        const { data: vehicle, error } = await supabase
          .from('vehicles')
          .insert([{
            user_id: user.id,
            make: data.make,
            model: data.model,
            year: data.year,
            vin: data.vin,
            license_plate: data.license_plate,
            ownership_status: data.ownership_status,
            purchase_date: data.purchase_date,
            purchase_price: data.purchase_price,
            purchase_location: data.purchase_location,
            claim_justification: data.claim_justification,
            discovery_date: data.discovery_date,
            discovery_location: data.discovery_location,
            discovery_notes: data.discovery_notes,
            color: data.color,
            trim: data.trim,
            body_style: data.body_style,
            transmission: data.transmission,
            engine: data.engine,
            fuel_type: data.fuel_type,
            mileage: data.mileage,
            condition: data.condition,
            category: data.category,
            rarity: data.rarity,
            significance: data.significance,
            public_notes: data.public_notes,
            private_notes: data.private_notes,
            image: primaryImageUrl,
            tags: data.tags,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }])
          .select()
          .single();

        if (error) {
          console.error('Error inserting vehicle:', error);
          throw new Error(handleDatabaseError(error));
        }

        // If we have a temporary image, update its vehicle ID
        if (primaryImageUrl && vehicle) {
          const oldPath = primaryImageUrl.split('/').pop();
          const newPath = `${vehicle.id}/${oldPath}`;
          
          // Move the file to the correct vehicle folder
          const { error: moveError } = await supabase.storage
            .move(`${user.id}/${oldPath}`, newPath);

          if (moveError) {
            console.error('Error moving image:', moveError);
            // Don't throw here, we still want to create the vehicle
          }

          // Update the vehicle_images table
          const { error: imageError } = await supabase
            .from('car_images')
            .update({ car_id: vehicle.id })
            .eq('image_url', primaryImageUrl);

          if (imageError) {
            console.error('Error updating image record:', imageError);
            // Don't throw here, we still want to create the vehicle
          }
        }

        console.log('Vehicle submitted:', vehicle);
        setIsFormModified(false);
        
        toast({
          title: 'Vehicle Added Successfully! 🚗',
          description: (
            <div className="flex flex-col gap-2">
              <div>Your {data.year} {data.make} {data.model} has been added to your collection.</div>
              <Button 
                className="mt-2" 
                size="sm" 
                onClick={() => navigate(`/vehicles/${vehicle.id}`)}
              >
                View Vehicle Details
              </Button>
            </div>
          ),
          variant: 'default',
          duration: 5000,
        });
        
        navigate('/vehicles', { state: { fromAdd: true, newVehicleId: vehicle.id } });
      } catch (error) {
        console.error('Error submitting vehicle:', error);
        toast({
          title: 'Error',
          description: error instanceof Error ? error.message : 'Failed to add vehicle. Please try again.',
          variant: 'destructive',
        });
      }
    },
    onSubmitError: (error) => {
      console.error('Error submitting vehicle:', error);
      toast({
        title: 'Error',
        description: 'Failed to add vehicle. Please try again.',
        variant: 'destructive',
      });
    },
  });

  const {
    showExitDialog,
    handleNavigation,
    confirmNavigation,
    cancelNavigation,
    saveAndNavigate,
  } = useNavigationProtection({
    shouldPreventNavigation: isFormModified && !form.formState.isSubmitSuccessful,
    onSave: () => {
      // If the form is valid, submit it before navigating
      if (form.formState.isValid) {
        handleSubmit();
      }
    },
  });

  const handleImageUpload = (imageUrls: string[]) => {
    // Use the first image as the primary image
    const primaryUrl = imageUrls[0];
    setPrimaryImageUrl(primaryUrl);
    form.setValue('image', primaryUrl);
    setIsFormModified(true);
  };

  // Detect form changes
  useEffect(() => {
    const subscription = form.watch(() => {
      if (!form.formState.isSubmitSuccessful) {
        setIsFormModified(true);
      }
    });
    return () => subscription.unsubscribe();
  }, [form, form.formState.isSubmitSuccessful]);

  return (
    <div className="container mx-auto py-6">
      <Card>
        <CardHeader>
          <CardTitle>Add New Vehicle</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Fill out the details below to add a new vehicle to your collection.
            After adding, you'll be able to view it in your vehicles list or go to the detail page to add more information.
          </p>
        </CardHeader>
        <CardContent>
          <VehicleForm 
            onSubmit={handleSubmit}
            initialValues={{
              image: primaryImageUrl
            }}
          />
        </CardContent>
      </Card>

      <AlertDialog 
        open={showExitDialog} 
        onOpenChange={(open) => {
          if (!open) {
            cancelNavigation();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Would you like to save them before leaving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelNavigation}>Don't Save</AlertDialogCancel>
            <AlertDialogAction onClick={saveAndNavigate}>Save & Leave</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default AddVehicle;
