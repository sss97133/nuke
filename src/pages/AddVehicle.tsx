import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useToastContext } from '@/contexts/ToastContext';
import { OwnershipSection } from '@/components/vehicles/forms/components/OwnershipSection';
import { useVehicleForm } from '@/components/vehicles/forms/hooks/useVehicleForm';

export default function AddVehicle() {
  const navigate = useNavigate();
  const { success, error } = useToastContext();
  
  const { 
    form, 
    handleSubmit, 
    isSubmitting, 
    submitError 
  } = useVehicleForm({
    onSubmitSuccess: (data) => {
      // In a real app, you would save the data to your backend here
      console.log('Vehicle data submitted:', data);
      
      // Show success message
      success({ 
        title: 'Vehicle Added', 
        description: `${data.year} ${data.make} ${data.model} has been added to your collection.`,
        action: {
          label: 'View All Vehicles',
          onClick: () => navigate('/vehicles')
        }
      });
      
      // Navigate back to the vehicles list
      navigate('/vehicles');
    },
    onSubmitError: (errors) => {
      // Show error message
      error({ 
        title: 'Failed to add vehicle', 
        description: 'Please check the form for errors and try again.' 
      });
      
      console.error('Form submission errors:', errors);
    }
  });

  return (
    <div className="container max-w-4xl py-10">
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Add New Vehicle</h1>
        <p className="text-muted-foreground mt-2">
          Add a new vehicle to your collection by filling out the information below.
        </p>
      </div>
      
      <Form {...form}>
        <form onSubmit={handleSubmit} className="space-y-8">
          {/* Basic Information */}
          <Card>
            <CardHeader>
              <CardTitle>Basic Information</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField
                  control={form.control}
                  name="make"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Make</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Ford" {...field} />
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
                        <Input placeholder="e.g. Mustang" {...field} />
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
                        <Input
                          type="number"
                          min={1885}
                          max={new Date().getFullYear() + 1}
                          {...field}
                          onChange={(e) => field.onChange(e.target.value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="vin"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>VIN</FormLabel>
                      <FormControl>
                        <Input placeholder="Vehicle Identification Number" {...field} />
                      </FormControl>
                      <FormDescription>
                        17-character vehicle identification number (optional)
                      </FormDescription>
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
                        <Input placeholder="License plate number" {...field} />
                      </FormControl>
                      <FormDescription>
                        Current or last known license plate (optional)
                      </FormDescription>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>
          
          {/* Ownership Section */}
          <OwnershipSection form={form} />
          
          {/* Additional Details */}
          <Card>
            <CardHeader>
              <CardTitle>Additional Details</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="color"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Color</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Red" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="mileage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mileage</FormLabel>
                      <FormControl>
                        <Input 
                          type="number" 
                          min="0"
                          placeholder="Current mileage" 
                          {...field}
                          onChange={(e) => field.onChange(e.target.value)}
                        />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <div className="grid gap-4 sm:grid-cols-2">
                <FormField
                  control={form.control}
                  name="engine"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Engine</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. V8, 5.0L" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="transmission"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Transmission</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Automatic, 6-speed manual" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              
              <FormField
                control={form.control}
                name="public_notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Public Notes</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Additional information about this vehicle" 
                        className="min-h-[100px]"
                        {...field} 
                      />
                    </FormControl>
                    <FormDescription>
                      These notes will be visible to other users
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
                        placeholder="Private notes about this vehicle" 
                        className="min-h-[100px]"
                        {...field} 
                      />
                    </FormControl>
                    <FormDescription>
                      These notes will only be visible to you
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </CardContent>
          </Card>
          
          {/* Form submission error */}
          {submitError && (
            <div className="bg-destructive/10 text-destructive p-3 rounded-md text-sm">
              {submitError}
            </div>
          )}
          
          {/* Form Actions */}
          <div className="flex justify-end gap-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => navigate(-1)}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Add Vehicle'}
            </Button>
          </div>
        </form>
      </Form>
    </div>
  );
}
