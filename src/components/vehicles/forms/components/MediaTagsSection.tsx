
import React from 'react';
import { FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../types';
import { ImageUpload } from './image-upload/ImageUpload';
import { Info } from 'lucide-react';

interface MediaTagsSectionProps {
  form: UseFormReturn<VehicleFormValues>;
}

export const MediaTagsSection: React.FC<MediaTagsSectionProps> = ({ form }) => {
  return (
    <Card>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <h3 className="text-lg font-medium">Media & Tags</h3>
          
          <ImageUpload
            form={form}
            name="image"
            label="Vehicle Images"
            description="Upload or drag and drop images of your vehicle (max 5MB per image)"
            multiple={true}
          />
          
          <div className="bg-muted/50 p-3 rounded-md flex items-start gap-2">
            <Info className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
            <p className="text-sm text-muted-foreground">
              <strong>Note:</strong> Due to browser security restrictions, browsing your device's folder structure 
              is limited. Web applications can only access files you specifically select, not entire folder hierarchies. 
              For full folder access, consider using the native app version.
            </p>
          </div>
          
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
  );
};
