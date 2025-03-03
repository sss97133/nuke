
import React, { useState, useEffect } from 'react';
import { 
  Carousel,
  CarouselContent,
  CarouselItem,
  CarouselNext,
  CarouselPrevious,
} from "@/components/ui/carousel";
import { Card, CardContent } from "@/components/ui/card";
import { AspectRatio } from "@/components/ui/aspect-ratio";

interface MarketplaceListingGalleryProps {
  listingId: string;
  images: string[];
  onImageSelect?: (index: number) => void;
}

const MarketplaceListingGallery: React.FC<MarketplaceListingGalleryProps> = ({ 
  listingId, 
  images,
  onImageSelect
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  
  useEffect(() => {
    console.log("MarketplaceListingGallery mounted with ID:", listingId);
    console.log("Gallery images:", images);
    
    // Check if images are loading correctly
    if (images.length > 0) {
      const img = new Image();
      img.onload = () => console.log("First image loaded successfully");
      img.onerror = (e) => console.error("Error loading first image:", e);
      img.src = images[0];
    }
    
    return () => {
      console.log("MarketplaceListingGallery unmounted");
    };
  }, [listingId, images]);

  // Update parent component when selected image changes
  useEffect(() => {
    if (onImageSelect) {
      onImageSelect(selectedIndex);
    }
  }, [selectedIndex, onImageSelect]);

  if (!images || images.length === 0) {
    console.log("No images provided for gallery");
    return (
      <Card>
        <CardContent className="p-1">
          <AspectRatio ratio={16/9}>
            <div className="flex items-center justify-center h-full bg-muted">
              <p className="text-muted-foreground">No images available</p>
            </div>
          </AspectRatio>
        </CardContent>
      </Card>
    );
  }

  console.log("Rendering gallery with", images.length, "images");
  
  return (
    <Card>
      <CardContent className="p-1">
        <Carousel
          opts={{
            loop: true,
          }}
          className="w-full"
          onSelect={(index) => setSelectedIndex(index)}
        >
          <CarouselContent>
            {images.map((image, index) => (
              <CarouselItem key={`${listingId}-image-${index}`}>
                <AspectRatio ratio={16/9}>
                  <img
                    src={image}
                    alt={`Vehicle image ${index + 1}`}
                    className="object-cover w-full h-full rounded-sm"
                    onLoad={() => console.log(`Image ${index + 1} loaded successfully`)}
                    onError={(e) => console.error(`Error loading image ${index + 1}:`, e)}
                  />
                </AspectRatio>
              </CarouselItem>
            ))}
          </CarouselContent>
          <CarouselPrevious className="left-2" />
          <CarouselNext className="right-2" />
        </Carousel>
        
        <div className="flex mt-2 overflow-x-auto gap-2 px-1 py-2">
          {images.map((image, index) => (
            <div 
              key={`thumb-${index}`}
              className={`relative cursor-pointer transition-all duration-200 ${
                selectedIndex === index 
                  ? 'ring-2 ring-primary ring-offset-2' 
                  : 'opacity-70 hover:opacity-100'
              }`}
              onClick={() => setSelectedIndex(index)}
            >
              <AspectRatio ratio={16/9} className="w-20">
                <img
                  src={image}
                  alt={`Thumbnail ${index + 1}`}
                  className="object-cover w-full h-full rounded-sm"
                />
              </AspectRatio>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};

export default MarketplaceListingGallery;
