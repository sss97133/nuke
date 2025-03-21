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
import { supabase } from '@/lib/supabase';
import ImageUploader from '@/components/vehicle-images/ImageUploader';

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
  if (error) console.error("Database query error:", error);
        if (!user) {
          throw new Error('User not authenticated');
        }

        // Insert the vehicle data into the database
        const { data: vehicle, error } = await supabase
  if (error) console.error("Database query error:", error);
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
            image: primaryImageUrl, // Use the uploaded image URL
            tags: data.tags,
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }])
          .select()
          .single();

        // If we have a temporary image, update its vehicle ID
        if (primaryImageUrl && vehicle) {
          const oldPath = primaryImageUrl.split('/').pop(); // Get the filename
          const newPath = `${vehicle.id}/${oldPath}`;
          
          // Move the file to the correct vehicle folder
          const { error: moveError } = await supabase.storage
  if (error) console.error("Database query error:", error);
            
            .move(`${user.id}/${oldPath}`, newPath);

          if (moveError) {
            console.error('Error moving image:', moveError);
            // Don't throw here, we still want to create the vehicle
          }

          // Update the vehicle_images table
          const { error: imageError } = await supabase
  if (error) console.error("Database query error:", error);
            
            .update({ car_id: vehicle.id })
            .eq('image_url', primaryImageUrl);

          if (imageError) {
            console.error('Error updating image record:', imageError);
            // Don't throw here, we still want to create the vehicle
          }
        }

        if (error) {
          throw error;
        }

        console.log('Vehicle submitted:', vehicle);
        toast({
          title: 'Vehicle Added Successfully! 🚗',
          description: `Your ${data.year} ${data.make} ${data.model} has been added to your collection. Redirecting to vehicle details...`,
          variant: 'default',
          duration: 3000,
        });

        // Navigate to the new vehicle's detail page after showing the success message
        setTimeout(() => {
          navigate(`/vehicles/${vehicle.id}`, { replace: true });
        }, 2000);
      } catch (error) {
        console.error('Error submitting vehicle:', error);
        toast({
          title: 'Error',
          description: 'Failed to add vehicle. Please try again.',
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
    shouldPreventNavigation: isFormModified,
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
      setIsFormModified(true);
    });
    return () => subscription.unsubscribe();
  }, [form]);

  return (
    <div className="container mx-auto py-6">
      <Card>
        <CardHeader>
          <CardTitle>Add New Vehicle</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Fill out the details below to add a new vehicle to your collection.
            You'll be redirected to the vehicle's page once it's added.
          </p>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={handleSubmit} className="space-y-6" noValidate>
              {/* Loading overlay */}
              {isSubmitting && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                  <div className="bg-white p-6 rounded-lg shadow-xl text-center">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
                    <p className="text-lg font-medium">Adding your vehicle...</p>
                    <p className="text-sm text-muted-foreground">This may take a moment</p>
                  </div>
                </div>
              )}
              {/* Basic Information */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Basic Information</h3>
                <FormField
                  control={form.control}
                  name="make"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Make</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Toyota" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="model"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Model</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., Camry" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="year"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Year</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="e.g., 2020" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="vin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>VIN</FormLabel>
                      <FormControl>
                        <Input placeholder="Vehicle Identification Number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="license_plate"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>License Plate</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g., ABC123" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Vehicle Image */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Vehicle Image</h3>
                <FormItem>
                  <FormLabel>Upload Image</FormLabel>
                  <FormControl>
                    <ImageUploader
                      vehicleId="temp" // Will be replaced with actual ID after vehicle creation
                      onSuccess={handleImageUpload}
                      maxSizeMB={5}
                    />
                  </FormControl>
                  <FormDescription>
                    Upload a primary image for your vehicle. You can add more images after creating the vehicle.
                  </FormDescription>
                  <FormMessage />
                </FormItem>
              </div>

              {/* Ownership Details */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Ownership Details</h3>
                <FormField
                  control={form.control}
                  name="ownership_status"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Ownership Status</FormLabel>
                      <FormControl>
                        <select
                          {...field}
                          className="w-full rounded-md border border-input bg-background px-3 py-2"
                        >
                          <option value="owned">Owned</option>
                          <option value="claimed">Claimed</option>
                          <option value="discovered">Discovered</option>
                        </select>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="purchase_date"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Purchase Date</FormLabel>
                      <FormControl>
                        <Input type="date" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="purchase_price"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Purchase Price</FormLabel>
                      <FormControl>
                        <Input type="number" step="0.01" placeholder="0.00" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="claim_justification"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Claim Justification</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Please provide a detailed justification for your claim..."
                          className="min-h-[100px]"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        Required if ownership status is "Claimed"
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {/* Additional Notes */}
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Additional Notes</h3>
                <FormField
                  control={form.control}
                  name="public_notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Add any additional notes about the vehicle..."
                          className="min-h-[100px]"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        These notes will be visible to anyone who can view this vehicle.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="private_notes"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Private Notes</FormLabel>
                      <FormControl>
                        <Textarea
                          placeholder="Add any private notes about the vehicle..."
                          className="min-h-[100px]"
                          {...field}
                        />
                      </FormControl>
                      <FormDescription>
                        These notes will only be visible to you.
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              {submitError && (
                <div className="text-red-500 text-sm">
                  {submitError}
                </div>
              )}

              <div className="flex flex-col gap-4 sm:flex-row sm:justify-end sm:gap-4 mt-8">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleNavigation(-1)}
                  className="w-full sm:w-auto"
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button 
                  type="submit" 
                  disabled={isSubmitting}
                  className="w-full sm:w-auto min-w-[150px] relative"
                >
                  {isSubmitting ? (
                    <>
                      <div className="absolute left-4 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin rounded-full border-2 border-b-transparent" />
                      <span>Adding...</span>
                    </>
                  ) : (
                    'Add Vehicle'
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>

      <AlertDialog open={showExitDialog} onOpenChange={(open) => {
        if (!open) {
          cancelNavigation();
        }
      }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved Changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Would you like to save them before leaving?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={cancelNavigation}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction onClick={saveAndNavigate}>
              Save and Leave
            </AlertDialogAction>
            <AlertDialogAction onClick={confirmNavigation} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Leave Without Saving
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default AddVehicle;
