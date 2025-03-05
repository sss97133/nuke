
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../types';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Info, ShieldCheck, Search, FileCheck } from 'lucide-react';

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
                <FormLabel>What is your relationship with this vehicle?</FormLabel>
                <FormControl>
                  <RadioGroup
                    onValueChange={field.onChange}
                    defaultValue={field.value}
                    className="flex flex-col space-y-2"
                  >
                    <div className="flex items-center space-x-2 p-2 rounded hover:bg-muted/50">
                      <RadioGroupItem value="owned" id="owned" />
                      <Label htmlFor="owned" className="flex items-center gap-2 cursor-pointer">
                        <ShieldCheck className="h-4 w-4 text-primary" />
                        <span>I own this vehicle (verified)</span>
                      </Label>
                    </div>
                    
                    <div className="flex items-center space-x-2 p-2 rounded hover:bg-muted/50">
                      <RadioGroupItem value="claimed" id="claimed" />
                      <Label htmlFor="claimed" className="flex items-center gap-2 cursor-pointer">
                        <FileCheck className="h-4 w-4 text-amber-500" />
                        <span>I claim this vehicle (unverified)</span>
                      </Label>
                    </div>
                    
                    <div className="flex items-center space-x-2 p-2 rounded hover:bg-muted/50">
                      <RadioGroupItem value="discovered" id="discovered" />
                      <Label htmlFor="discovered" className="flex items-center gap-2 cursor-pointer">
                        <Search className="h-4 w-4 text-blue-500" />
                        <span>I discovered this vehicle (don't own it)</span>
                      </Label>
                    </div>
                  </RadioGroup>
                </FormControl>
                
                <div className="bg-muted/50 p-3 rounded-md flex items-start gap-2">
                  <Info className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <p className="text-sm text-muted-foreground">
                    <strong>Note:</strong> "Claimed" vehicles are ones you own but haven't verified with documentation yet.
                    "Discovered" vehicles are those you've found but don't own.
                    Both will be tracked in their respective sections.
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
