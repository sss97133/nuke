
import React, { useState } from 'react';
import { FormControl, FormField, FormItem, FormLabel, FormMessage, FormDescription } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Image, Upload, X } from 'lucide-react';
import { UseFormReturn } from 'react-hook-form';
import { VehicleFormValues } from '../types';
import { useToast } from '@/hooks/use-toast';

interface ImageUploadProps {
  form: UseFormReturn<VehicleFormValues>;
  name: keyof VehicleFormValues;
  label: string;
  description?: string;
}

export const ImageUpload: React.FC<ImageUploadProps> = ({
  form,
  name,
  label,
  description
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();
  
  // Handle file selection
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    
    // Validate file
    if (!file.type.startsWith('image/')) {
      toast({
        title: 'Invalid file type',
        description: 'Please upload an image file (JPEG, PNG, etc.)',
        variant: 'destructive',
      });
      return;
    }
    
    if (file.size > 5 * 1024 * 1024) { // 5MB limit
      toast({
        title: 'File too large',
        description: 'Please upload an image smaller than 5MB',
        variant: 'destructive',
      });
      return;
    }
    
    // Create a preview URL
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    
    // Simulate uploading
    setIsUploading(true);
    
    // In a real implementation, you would upload the file to your storage here
    // For now, we'll simulate the upload with a timeout
    setTimeout(() => {
      // After "upload", set the URL in the form
      form.setValue(name as any, url);
      setIsUploading(false);
      
      toast({
        title: 'Image uploaded',
        description: 'Your image has been uploaded successfully',
      });
    }, 1500);
  };
  
  // Clear the image
  const clearImage = () => {
    form.setValue(name as any, '');
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
    }
  };
  
  return (
    <FormField
      control={form.control}
      name={name as any}
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <div className="space-y-4">
              {/* Preview Area */}
              {(previewUrl || field.value) && (
                <div className="relative w-full h-48 border rounded-md overflow-hidden group">
                  <img 
                    src={previewUrl || field.value as string} 
                    alt="Vehicle preview" 
                    className="w-full h-full object-cover"
                  />
                  <Button
                    type="button"
                    variant="destructive"
                    size="icon"
                    className="absolute top-2 right-2 h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={clearImage}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
              
              {/* Upload Controls */}
              {!previewUrl && !field.value ? (
                <div className="border-2 border-dashed rounded-lg p-6 text-center hover:bg-muted/50 transition-colors">
                  <Input
                    type="file"
                    id={`${name}-upload`}
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                    disabled={isUploading}
                  />
                  <label 
                    htmlFor={`${name}-upload`}
                    className="cursor-pointer block"
                  >
                    <div className="flex flex-col items-center justify-center gap-2 py-4">
                      <Image className="h-10 w-10 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {isUploading ? 'Uploading...' : 'Click to upload an image'}
                      </p>
                      <Button 
                        type="button" 
                        variant="outline" 
                        size="sm" 
                        className="mt-2"
                        onClick={() => document.getElementById(`${name}-upload`)?.click()}
                      >
                        <Upload className="h-4 w-4 mr-2" />
                        Select Image
                      </Button>
                    </div>
                  </label>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => document.getElementById(`${name}-upload`)?.click()}
                  disabled={isUploading}
                >
                  <Upload className="h-4 w-4 mr-2" />
                  Change Image
                  <Input
                    type="file"
                    id={`${name}-upload`}
                    accept="image/*"
                    className="hidden"
                    onChange={handleFileChange}
                    disabled={isUploading}
                  />
                </Button>
              )}
              
              {/* URL Input - as fallback/alternative */}
              <div className="mt-2">
                <div className="text-sm text-muted-foreground mb-2">Or enter image URL directly:</div>
                <Input 
                  placeholder="https://example.com/image.jpg"
                  {...field}
                  onChange={(e) => {
                    field.onChange(e);
                    // Clear the preview URL if we're setting a direct URL
                    if (previewUrl) {
                      URL.revokeObjectURL(previewUrl);
                      setPreviewUrl(null);
                    }
                  }}
                />
              </div>
            </div>
          </FormControl>
          {description && <FormDescription>{description}</FormDescription>}
          <FormMessage />
        </FormItem>
      )}
    />
  );
};
