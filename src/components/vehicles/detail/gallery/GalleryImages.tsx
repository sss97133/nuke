
import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { GalleryImagesProps } from './types';
import { EmptyGallery } from './EmptyGallery';
import { Skeleton } from '@/components/ui/skeleton';
import { ShieldCheck, Info } from 'lucide-react';
import { 
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

export const GalleryImages: React.FC<GalleryImagesProps> = ({ 
  images, 
  isLoading = false,
  onOpenUploadModal 
}) => {
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());
  
  const handleImageError = (url: string) => {
    setFailedImages(prev => new Set(prev).add(url));
  };
  
  if (isLoading) {
    return (
      <Card className="p-6">
        <div className="space-y-4">
          <Skeleton className="h-4 w-1/3" />
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-md" />
            ))}
          </div>
        </div>
      </Card>
    );
  }
  
  if (!images || images.length === 0) {
    return <EmptyGallery vehicle={{make: '', model: '', year: ''}} onOpenUploadModal={onOpenUploadModal} />;
  }
  
  // Filter out failed images
  const validImages = images.filter(image => !failedImages.has(image.url));
  
  if (validImages.length === 0) {
    return <EmptyGallery vehicle={{make: '', model: '', year: ''}} onOpenUploadModal={onOpenUploadModal} />;
  }
  
  return (
    <Card className="p-6">
      <div className="space-y-4">
        <h3 className="text-lg font-medium">Gallery ({validImages.length} images)</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {validImages.map((image, index) => (
            <div 
              key={`${image.id}-${index}`} 
              className="aspect-square rounded-md overflow-hidden border border-border hover:opacity-90 transition-opacity cursor-pointer relative group"
            >
              <img 
                src={image.url} 
                alt={`${image.type} view`} 
                className="w-full h-full object-cover"
                onError={() => handleImageError(image.url)}
              />
              
              {/* Image status indicators */}
              <div className="absolute top-2 right-2 flex space-x-1">
                {image.isVerified && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="bg-white/80 dark:bg-black/60 p-1 rounded-full">
                          <ShieldCheck className="h-4 w-4 text-green-600" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>Verified Image</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                
                {image.caption && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="bg-white/80 dark:bg-black/60 p-1 rounded-full">
                          <Info className="h-4 w-4 text-blue-600" />
                        </div>
                      </TooltipTrigger>
                      <TooltipContent>
                        <p>{image.caption}</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
              
              {/* Image type label */}
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2 text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity">
                {image.type.charAt(0).toUpperCase() + image.type.slice(1)} View
                {image.user?.name && <span className="block opacity-75">by {image.user.name}</span>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
};
