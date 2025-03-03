
import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Vehicle } from '@/components/vehicles/discovery/types';
import { Button } from '@/components/ui/button';
import { Camera, View, Upload } from 'lucide-react';

interface VehicleGalleryProps {
  vehicle: Vehicle;
}

const VehicleGallery: React.FC<VehicleGalleryProps> = ({ vehicle }) => {
  // In a real app, this would be actual gallery data
  // Using placeholders for now
  const mockImages = [
    { id: 1, url: vehicle.image, type: 'exterior' },
    { id: 2, url: vehicle.image, type: 'interior' },
    { id: 3, url: vehicle.image, type: 'engine' },
    { id: 4, url: vehicle.image, type: 'exterior' },
    { id: 5, url: vehicle.image, type: 'exterior' },
    { id: 6, url: vehicle.image, type: 'interior' },
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Vehicle Gallery</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline">
            <View className="h-4 w-4 mr-2" />
            View All
          </Button>
          <Button size="sm" variant="outline">
            <Upload className="h-4 w-4 mr-2" />
            Upload
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {mockImages.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {mockImages.map((image) => (
              <div key={image.id} className="aspect-video relative overflow-hidden rounded-md">
                <img 
                  src={image.url} 
                  alt={`${vehicle.make} ${vehicle.model} ${image.type}`}
                  className="w-full h-full object-cover hover:scale-105 transition-transform"
                />
                <div className="absolute bottom-2 left-2">
                  <Badge variant="secondary" className="text-xs">
                    {image.type}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 text-center">
            <Camera className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-medium mb-2">No Images Available</h3>
            <p className="text-muted-foreground mb-4">
              There are no images available for this vehicle yet.
            </p>
            <Button variant="outline">Upload Images</Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

// Missing Badge component import
import { Badge } from "@/components/ui/badge";

export default VehicleGallery;
