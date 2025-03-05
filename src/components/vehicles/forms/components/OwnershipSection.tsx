
import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../types';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Info, ShieldCheck, Search, FileCheck, User, Flag } from 'lucide-react';

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
                        <span>I own this vehicle (verified with documentation)</span>
                      </Label>
                    </div>
                    
                    <div className="flex items-center space-x-2 p-2 rounded hover:bg-muted/50">
                      <RadioGroupItem value="claimed" id="claimed" />
                      <Label htmlFor="claimed" className="flex items-center gap-2 cursor-pointer">
                        <User className="h-4 w-4 text-amber-500" />
                        <span>I claim this vehicle (acting on owner's behalf)</span>
                      </Label>
                    </div>
                    
                    <div className="flex items-center space-x-2 p-2 rounded hover:bg-muted/50">
                      <RadioGroupItem value="discovered" id="discovered" />
                      <Label htmlFor="discovered" className="flex items-center gap-2 cursor-pointer">
                        <Search className="h-4 w-4 text-blue-500" />
                        <span>I discovered this vehicle (tracking only)</span>
                      </Label>
                    </div>
                  </RadioGroup>
                </FormControl>
                
                <div className="bg-muted/50 p-3 rounded-md flex items-start gap-2">
                  <Info className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-muted-foreground space-y-2">
                    <p><strong>Ownership (Verified):</strong> You have proof of title in your name and can provide documentation if needed. This is the highest level of verification.</p>
                    
                    <p><strong>Claim (Unverified):</strong> You represent the owner (as a broker, collection manager, family member) or the title is not yet in your name but the vehicle is in your possession.</p>
                    
                    <p><strong>Discovery (Tracking):</strong> You've found this vehicle elsewhere (online listing, in person) and want to track it for reference. Source information is required for discovered vehicles.</p>
                  </div>
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
