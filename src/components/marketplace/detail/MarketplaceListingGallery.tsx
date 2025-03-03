
import React, { useState, useEffect } from 'react';
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight } from 'lucide-react';

interface MarketplaceListingGalleryProps {
  listingId: string;
  images: { id: number; url: string; type: string }[];
}

const MarketplaceListingGallery: React.FC<MarketplaceListingGalleryProps> = ({ 
  listingId, 
  images 
}) => {
  const [currentIndex, setCurrentIndex] = useState(0);
  
  useEffect(() => {
    console.log("MarketplaceListingGallery mounted", { listingId, imageCount: images.length });
  }, [listingId, images]);
  
  const nextImage = () => {
    console.log("Next image clicked", { currentIndex, total: images.length });
    setCurrentIndex((prevIndex) => (prevIndex + 1) % images.length);
  };
  
  const prevImage = () => {
    console.log("Previous image clicked", { currentIndex, total: images.length });
    setCurrentIndex((prevIndex) => (prevIndex - 1 + images.length) % images.length);
  };
  
  if (images.length === 0) {
    console.log("No images available for gallery");
    return (
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="bg-muted h-64 flex items-center justify-center">
            <p className="text-muted-foreground">No images available</p>
          </div>
        </CardContent>
      </Card>
    );
  }
  
  console.log("Rendering gallery with current image:", currentIndex, images[currentIndex]);
  
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0 relative">
        {/* Main image */}
        <div className="relative">
          <div className="aspect-video w-full bg-muted">
            <img 
              src={images[currentIndex].url} 
              alt={images[currentIndex].type} 
              className="w-full h-full object-cover"
              onError={(e) => {
                console.error("Image failed to load:", images[currentIndex].url);
                e.currentTarget.src = 'https://via.placeholder.com/800x450?text=Image+Not+Available';
              }}
            />
          </div>
          
          {/* Image navigation buttons */}
          <div className="absolute inset-0 flex items-center justify-between p-2">
            <Button 
              variant="secondary" 
              size="icon" 
              className="opacity-80 hover:opacity-100"
              onClick={prevImage}
              disabled={images.length <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            
            <Button 
              variant="secondary" 
              size="icon"
              className="opacity-80 hover:opacity-100"
              onClick={nextImage}
              disabled={images.length <= 1}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          
          {/* Caption/info */}
          <div className="absolute bottom-2 left-2">
            <span className="bg-background/80 text-foreground px-2 py-1 rounded text-sm">
              {images[currentIndex].type} ({currentIndex + 1}/{images.length})
            </span>
          </div>
        </div>
        
        {/* Thumbnails */}
        {images.length > 1 && (
          <div className="p-2 flex gap-2 overflow-x-auto">
            {images.map((image, index) => (
              <div 
                key={image.id} 
                className={`w-16 h-16 flex-shrink-0 cursor-pointer transition-all rounded overflow-hidden
                  ${currentIndex === index ? 'ring-2 ring-primary' : 'opacity-70 hover:opacity-100'}`}
                onClick={() => {
                  console.log("Thumbnail clicked, switching to image index:", index);
                  setCurrentIndex(index);
                }}
              >
                <img 
                  src={image.url} 
                  alt={image.type}
                  className="w-full h-full object-cover"
                  onError={(e) => {
                    console.error("Thumbnail failed to load:", image.url);
                    e.currentTarget.src = 'https://via.placeholder.com/100?text=Error';
                  }}
                />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default MarketplaceListingGallery;
