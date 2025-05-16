import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useVehicle } from '@/hooks/useVehicle';
import { ImageUpload } from '@/components/shared/ImageUpload';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { uploadImage, generateUniqueFilename } from '@/lib/upload/image-upload';
import { supabase } from '@/integrations/supabase/client';

export const VehicleDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { vehicle, loading, error } = useVehicle(id);
  const [isUploading, setIsUploading] = useState(false);
  const { toast } = useToast();

  const handleImageUpload = async (urls: string[]) => {
    if (!vehicle || !id) return;

    setIsUploading(true);
    try {
      // Process each uploaded image
      for (const url of urls) {
        // Convert blob URL to File object
        const response = await fetch(url);
        const blob = await response.blob();
        const file = new File([blob], generateUniqueFilename(url), { type: blob.type });

        const filename = generateUniqueFilename(url);
        const path = `${id}/${filename}`;

        // Upload to Supabase storage
        const result = await uploadImage(file, {
          bucket: 'vehicle-images',
          path
        });

        // Update vehicle record with new image
        const { error: updateError } = await supabase
          .from('vehicles')
          .update({
            images: [...(vehicle.images || []), result.url]
          })
          .eq('id', id);

        if (updateError) {
          throw updateError;
        }
      }

      toast({
        title: 'Success',
        description: 'Images uploaded successfully',
      });
    } catch (error) {
      console.error('Error uploading images:', error);
      toast({
        title: 'Error',
        description: 'Failed to upload images. Please try again.',
        variant: 'destructive',
      });
    } finally {
      setIsUploading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  if (error || !vehicle) {
    return (
      <div className="text-center py-8">
        <p className="text-destructive">Failed to load vehicle details</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Vehicle Images */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold">Vehicle Images</h2>
          <ImageUpload
            multiple
            maxFiles={10}
            maxSize={10 * 1024 * 1024} // 10MB
            onUploadComplete={handleImageUpload}
            onError={(errorMessage: string) => {
              console.error('Image upload error:', errorMessage);
              toast({
                title: 'Upload Error',
                description: errorMessage || 'Failed to upload image',
                variant: 'destructive',
              });
            }}
          />
        </div>

        {/* Image Gallery */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {vehicle.images?.map((image, index) => (
            <div key={index} className="relative aspect-square rounded-lg overflow-hidden">
              <img
                src={image}
                alt={`Vehicle image ${index + 1}`}
                className="w-full h-full object-cover"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Vehicle Details */}
      <div className="space-y-4">
        <h2 className="text-2xl font-bold">Vehicle Details</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <h3 className="font-semibold">Make</h3>
            <p>{vehicle.make}</p>
          </div>
          <div>
            <h3 className="font-semibold">Model</h3>
            <p>{vehicle.model}</p>
          </div>
          <div>
            <h3 className="font-semibold">Year</h3>
            <p>{vehicle.year}</p>
          </div>
          <div>
            <h3 className="font-semibold">VIN</h3>
            <p>{vehicle.vin}</p>
          </div>
        </div>
      </div>
    </div>
  );
}; 