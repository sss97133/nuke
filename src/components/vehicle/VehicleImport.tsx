import React, { useState } from 'react';
import { useVehicle } from '@/providers/VehicleProvider';
import { supabase } from '@/lib/supabase-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/components/ui/use-toast';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';

// Define the schema for vehicle import
const vehicleImportSchema = z.object({
  make: z.string().min(1, { message: 'Make is required' }),
  model: z.string().min(1, { message: 'Model is required' }),
  year: z.string().regex(/^\d{4}$/, { message: 'Year must be 4 digits' }),
  vin: z.string().optional(),
  color: z.string().optional(),
  import_source: z.string().min(1, { message: 'Source is required' }),
  additional_details: z.string().optional(),
});

type VehicleImportFormValues = z.infer<typeof vehicleImportSchema>;

interface VehicleImportProps {
  onComplete?: (vehicleId: string) => void;
}

const VehicleImport: React.FC<VehicleImportProps> = ({ onComplete }) => {
  const { addVehicle, vehicles } = useVehicle();
  const [loading, setLoading] = useState(false);
  
  // Initialize the form
  const form = useForm<VehicleImportFormValues>({
    resolver: zodResolver(vehicleImportSchema),
    defaultValues: {
      make: '',
      model: '',
      year: new Date().getFullYear().toString(),
      vin: '',
      color: '',
      import_source: 'manual',
      additional_details: '',
    },
  });
  
  const onSubmit = async (values: VehicleImportFormValues) => {
    setLoading(true);
    
    try {
      // Add the vehicle using the provider
      const result = await addVehicle({
        make: values.make,
        model: values.model,
        year: parseInt(values.year),
        color: values.color || null,
        vin: values.vin || null,
      });
      
      if (result.error) throw new Error(result.error.message);
      
      // Add to vehicle timeline using the add_vehicle_import_event function
      const { data: timelineData, error: timelineError } = await supabase.rpc(
        'add_vehicle_import_event',
        {
          vehicle_id: result.vehicle.id,
          import_source: values.import_source,
          import_data: {
            method: 'manual entry',
            details: values.additional_details,
            timestamp: new Date().toISOString(),
          }
        }
      );
      
      if (timelineError) {
        console.error('Error adding import to timeline:', timelineError);
        // We still proceed since the vehicle was created
      }
      
      toast({
        title: 'Vehicle Added',
        description: `Your ${values.year} ${values.make} ${values.model} has been added successfully.`,
      });
      
      // Reset the form
      form.reset();
      
      // Call the onComplete callback if provided
      if (onComplete && result.vehicle?.id) {
        onComplete(result.vehicle.id);
      }
    } catch (error: any) {
      toast({
        title: 'Error Adding Vehicle',
        description: error.message || 'Failed to add vehicle',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };
  
  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle>Import Vehicle</CardTitle>
        <CardDescription>
          Add a new vehicle to your collection
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <FormField
                control={form.control}
                name="make"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Make</FormLabel>
                    <FormControl>
                      <Input placeholder="Toyota, Honda, etc." {...field} />
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
                      <Input placeholder="Corolla, Civic, etc." {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <FormField
                control={form.control}
                name="year"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Year</FormLabel>
                    <FormControl>
                      <Input placeholder="2023" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="color"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Color</FormLabel>
                    <FormControl>
                      <Input placeholder="White, Black, etc." {...field} />
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
                    <FormLabel>VIN (Optional)</FormLabel>
                    <FormControl>
                      <Input placeholder="Vehicle Identification Number" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
            
            <FormField
              control={form.control}
              name="import_source"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Source</FormLabel>
                  <Select 
                    onValueChange={field.onChange} 
                    defaultValue={field.value}
                  >
                    <FormControl>
                      <SelectTrigger>
                        <SelectValue placeholder="Select import source" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="manual">Manual Entry</SelectItem>
                      <SelectItem value="documents">Documents</SelectItem>
                      <SelectItem value="dealer">Dealer</SelectItem>
                      <SelectItem value="service_records">Service Records</SelectItem>
                      <SelectItem value="other">Other</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <FormField
              control={form.control}
              name="additional_details"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Additional Details (Optional)</FormLabel>
                  <FormControl>
                    <Textarea 
                      placeholder="Enter any additional information about this vehicle"
                      className="resize-none" 
                      {...field} 
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />
            
            <Button 
              type="submit" 
              className="w-full"
              disabled={loading}
            >
              {loading ? 'Processing...' : 'Add Vehicle'}
            </Button>
          </form>
        </Form>
      </CardContent>
    </Card>
  );
};

export default VehicleImport;
