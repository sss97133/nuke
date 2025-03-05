
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../types';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Info } from 'lucide-react';

interface OwnershipSectionProps {
  form: UseFormReturn<VehicleFormValues>;
}

export const OwnershipSection: React.FC<OwnershipSectionProps> = ({ form }) => {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Vehicle Ownership</h3>
          
          <FormField
            control={form.control}
            name="ownership_status"
            defaultValue="owned"
            render={({ field }) => (
              <FormItem className="space-y-3">
                <FormLabel>Do you own this vehicle or did you discover it?</FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    className="flex flex-col space-y-1"
                  >
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="owned" id="owned" />
                      <Label htmlFor="owned">I own this vehicle</Label>
                    </div>
                    <div className="flex items-center space-x-2">
                      <RadioGroupItem value="discovered" id="discovered" />
                      <Label htmlFor="discovered">I discovered this vehicle (don't own it)</Label>
                    </div>
                  </RadioGroup>
                </FormControl>
                
                <div className="bg-muted/50 p-3 rounded-md flex items-start gap-2">
                  <Info className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    <strong>Note:</strong> "Discovered" vehicles are those you've found but don't own.
                    They'll be added to the Discovered Vehicles section where they can be tracked and monitored.
                  </p>
                </div>
                
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </CardContent>
    </Card>
  );
};
