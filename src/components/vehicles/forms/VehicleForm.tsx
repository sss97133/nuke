
import React from 'react';
import { Button } from '@/components/ui/button';
import { 
  Form, 
  FormField, 
  FormItem, 
  FormLabel, 
  FormControl, 
  FormDescription, 
  FormMessage 
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { Card, CardContent } from '@/components/ui/card';

export interface VehicleFormValues {
  make: string;
  model: string;
  year: number;
  color?: string;
  vin?: string;
  mileage?: number;
  trim?: string;
  image?: string;
  tags?: string; // Keep as string for form input, will be processed to array later
  notes?: string;
}

interface VehicleFormProps {
  onSubmit: (data: VehicleFormValues) => Promise<void>;
  isSubmitting: boolean;
  initialValues?: Partial<VehicleFormValues>;
}

// Form validation schema
const formSchema = z.object({
  make: z.string().min(1, "Make is required"),
  model: z.string().min(1, "Model is required"),
  year: z.coerce.number().min(1900).max(new Date().getFullYear() + 1),
  color: z.string().optional(),
  vin: z.string().optional(),
  mileage: z.coerce.number().optional(),
  trim: z.string().optional(),
  image: z.string().optional(),
  tags: z.string().optional(),
  notes: z.string().optional(),
});

const VehicleForm: React.FC<VehicleFormProps> = ({ 
  onSubmit, 
  isSubmitting,
  initialValues = {}
}) => {
  // Ensure the required fields have default values
  const defaultValues = {
    make: initialValues.make || '',
    model: initialValues.model || '',
    year: initialValues.year || new Date().getFullYear(),
    color: initialValues.color || '',
    vin: initialValues.vin || '',
    mileage: initialValues.mileage,
    trim: initialValues.trim || '',
    image: initialValues.image || '',
    tags: initialValues.tags || '',
    notes: initialValues.notes || '',
  };

  const form = useForm<z.infer<typeof formSchema>>({
    resolver: zodResolver(formSchema),
    defaultValues,
  });

  const handleSubmit = async (values: z.infer<typeof formSchema>) => {
    await onSubmit(values);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Basic Information */}
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Basic Information</h3>
                
                <FormField
                  control={form.control}
                  name="make"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Make*</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Toyota" {...field} />
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
                      <FormLabel>Model*</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Corolla" {...field} />
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
                      <FormLabel>Year*</FormLabel>
                      <FormControl>
                        <Input type="number" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                
                <FormField
                  control={form.control}
                  name="trim"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Trim</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. SE" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>
          
          {/* Additional Details */}
          <Card>
            <CardContent className="pt-6">
              <div className="space-y-4">
                <h3 className="text-lg font-medium">Additional Details</h3>
                
                <FormField
                  control={form.control}
                  name="color"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Color</FormLabel>
                      <FormControl>
                        <Input placeholder="e.g. Blue" {...field} />
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
                  name="mileage"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Mileage</FormLabel>
                      <FormControl>
                        <Input type="number" placeholder="Current odometer reading" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
            </CardContent>
          </Card>
        </div>
        
        {/* Media and Tags */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Media & Tags</h3>
              
              <FormField
                control={form.control}
                name="image"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Image URL</FormLabel>
                    <FormControl>
                      <Input placeholder="URL to vehicle image" {...field} />
                    </FormControl>
                    <FormDescription>
                      Enter a URL for the vehicle's image or upload one later
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
              
              <FormField
                control={form.control}
                name="tags"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tags</FormLabel>
                    <FormControl>
                      <Input placeholder="e.g. classic, restored, project (comma separated)" {...field} />
                    </FormControl>
                    <FormDescription>
                      Enter tags separated by commas
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>
        
        {/* Notes */}
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <h3 className="text-lg font-medium">Notes</h3>
              
              <FormField
                control={form.control}
                name="notes"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Additional Notes</FormLabel>
                    <FormControl>
                      <Textarea 
                        placeholder="Any additional information about the vehicle"
                        className="min-h-[100px]" 
                        {...field} 
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
            </div>
          </CardContent>
        </Card>
        
        <div className="flex justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Add Vehicle'}
          </Button>
        </div>
      </form>
    </Form>
  );
};

export default VehicleForm;
