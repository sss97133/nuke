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
import { ImageIcon, LinkIcon } from 'lucide-react';
import { supabase } from '@/lib/supabase';

function AddVehicle() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [isFormModified, setIsFormModified] = useState(false);
  const [imagePreview, setImagePreview] = useState<string | null>(null);

  const {
    form,
    handleSubmit,
    isSubmitting,
    submitError,
  } = useVehicleForm({
    onSubmitSuccess: async (data) => {
      try {
        // Insert the vehicle data into the database
        const { data: vehicle, error } = await supabase
          .from('vehicles')
          .insert([{
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
            image: data.image,
            tags: data.tags,
          }])
          .select()
          .single();

        if (error) {
          throw error;
        }

        console.log('Vehicle submitted:', vehicle);
        toast({
          title: 'Success',
          description: 'Vehicle added successfully',
        });

        // Navigate back to vehicles list after a short delay
        setTimeout(() => {
          navigate(-1);
        }, 1000);
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

  // Handle file upload
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setImagePreview(reader.result as string);
        form.setValue('image', reader.result as string);
        setIsFormModified(true);
      };
      reader.readAsDataURL(file);
    }
  };

  // Handle URL input
  const handleUrlInput = (event: React.ChangeEvent<HTMLInputElement>) => {
    const url = event.target.value;
    setImagePreview(url);
    form.setValue('image', url);
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
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={handleSubmit} className="space-y-6">
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
                <Tabs defaultValue="upload" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="upload" className="flex items-center gap-2">
                      <ImageIcon className="h-4 w-4" />
                      Upload Image
                    </TabsTrigger>
                    <TabsTrigger value="url" className="flex items-center gap-2">
                      <LinkIcon className="h-4 w-4" />
                      Image URL
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent value="upload">
                    <FormItem>
                      <FormLabel>Upload Image</FormLabel>
                      <FormControl>
                        <Input
                          type="file"
                          accept="image/*"
                          onChange={handleFileUpload}
                        />
                      </FormControl>
                      <FormDescription>
                        Upload an image of your vehicle (JPG, PNG, GIF)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  </TabsContent>
                  <TabsContent value="url">
                    <FormItem>
                      <FormLabel>Image URL</FormLabel>
                      <FormControl>
                        <Input
                          type="url"
                          placeholder="https://example.com/image.jpg"
                          onChange={handleUrlInput}
                        />
                      </FormControl>
                      <FormDescription>
                        Enter a URL to an image of your vehicle
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  </TabsContent>
                </Tabs>
                {imagePreview && (
                  <div className="mt-4">
                    <img
                      src={imagePreview}
                      alt="Vehicle preview"
                      className="max-w-full h-auto rounded-lg shadow-md"
                    />
                  </div>
                )}
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

              <div className="flex justify-end space-x-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => handleNavigation(-1)}
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Adding...' : 'Add Vehicle'}
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
