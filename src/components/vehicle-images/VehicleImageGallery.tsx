import React, { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { AspectRatio } from '@/components/ui/aspect-ratio';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { Image, ImageOff } from 'lucide-react';
import ImageUploader from './ImageUploader';

interface VehicleImageGalleryProps {
  vehicleId: string;
}

interface VehicleImage {
  id: string;
  car_id: string;
  image_url: string;
  uploaded_at: string;
}

const VehicleImageGallery: React.FC<VehicleImageGalleryProps> = ({ vehicleId }) => {
  const [images, setImages] = useState<VehicleImage[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchImages = async () => {
      if (!vehicleId) return;
      
      try {
        setLoading(true);
        console.log('Fetching images for vehicle:', vehicleId);
        const { data, error } = await supabase
          .from('vehicle_images')
          .select('*')
          .eq('car_id', vehicleId)
          .order('uploaded_at', { ascending: false });
        
        if (error) throw error;
        
        console.log('Fetched vehicle images:', data);
        setImages(data || []);
        if (data && data.length > 0) {
          setSelectedImage(data[0].image_url);
        }
      } catch (err) {
        console.error('Error fetching vehicle images:', err);
        setError('Failed to load vehicle images');
      } finally {
        setLoading(false);
      }
    };
    
    fetchImages();
  }, [vehicleId]);

  const handleNewImage = (imageUrl: string) => {
    console.log('New image uploaded:', imageUrl);
    // Refetch images to ensure we have the latest data
    supabase
      .from('vehicle_images')
      .select('*')
      .eq('car_id', vehicleId)
      .order('uploaded_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) {
          console.error('Error refreshing images:', error);
          return;
        }
        
        if (data) {
          console.log('Refreshed image list:', data);
          setImages(data);
          setSelectedImage(imageUrl);
        }
      });
  };

  return (
    <div className="space-y-6">
      <div className="rounded-lg overflow-hidden border border-border bg-card">
        {loading ? (
          <Skeleton className="w-full aspect-video" />
        ) : images.length > 0 && selectedImage ? (
          <AspectRatio ratio={16 / 9}>
            <img 
              src={selectedImage} 
              alt="Vehicle" 
              className="w-full h-full object-cover"
              onError={(e) => {
                e.currentTarget.src = '/placeholder.svg';
              }}
            />
          </AspectRatio>
        ) : (
          <div className="w-full aspect-video flex flex-col items-center justify-center bg-muted">
            <ImageOff className="h-16 w-16 text-muted-foreground mb-2" />
            <p className="text-muted-foreground">No images available</p>
          </div>
        )}
      </div>
      
      {/* Thumbnails */}
      {images.length > 0 && (
        <div className="grid grid-cols-5 gap-2">
          {images.map((image) => (
            <div 
              key={image.id}
              className={cn(
                "cursor-pointer rounded-md overflow-hidden border-2",
                selectedImage === image.image_url 
                  ? "border-primary" 
                  : "border-transparent hover:border-border"
              )}
              onClick={() => setSelectedImage(image.image_url)}
            >
              <AspectRatio ratio={1}>
                <img 
                  src={image.image_url} 
                  alt="Vehicle thumbnail" 
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    e.currentTarget.src = '/placeholder.svg';
                  }}
                />
              </AspectRatio>
            </div>
          ))}
        </div>
      )}
      
      {/* Image Uploader */}
      <ImageUploader 
        vehicleId={vehicleId}
        onSuccess={handleNewImage}
        maxSizeMB={2}
      />
      
      {error && (
        <div className="p-4 bg-destructive/15 border border-destructive rounded-md">
          <p className="text-sm text-destructive">{error}</p>
        </div>
      )}
    </div>
  );
};

export default VehicleImageGallery;
