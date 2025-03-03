
import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Vehicle } from '@/components/vehicles/discovery/types';
import { Button } from '@/components/ui/button';
import { Camera, View, Upload, CheckCircle2 } from 'lucide-react';
import { Badge } from "@/components/ui/badge";
import { ImageUploadModal } from './image-upload/ImageUploadModal';
import { useToast } from "@/components/ui/use-toast";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";

interface VehicleGalleryProps {
  vehicle: Vehicle;
}

const VehicleGallery: React.FC<VehicleGalleryProps> = ({ vehicle }) => {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const { toast } = useToast();
  
  // In a real app, this would be actual gallery data
  // Using placeholders for now with additional user metadata
  const mockImages = [
    { 
      id: 1, 
      url: vehicle.image, 
      type: 'exterior',
      user: { name: 'Owner', isVerified: true, avatar: null },
      isVerified: true
    },
    { 
      id: 2, 
      url: vehicle.image, 
      type: 'interior',
      user: { name: 'Car Show Visitor', isVerified: false, avatar: null },
      isVerified: false 
    },
    { 
      id: 3, 
      url: vehicle.image, 
      type: 'engine',
      user: { name: 'PTZ Garage', isVerified: true, avatar: null },
      isVerified: true 
    },
    { 
      id: 4, 
      url: vehicle.image, 
      type: 'exterior',
      user: { name: 'Owner', isVerified: true, avatar: null },
      isVerified: true 
    },
    { 
      id: 5, 
      url: vehicle.image, 
      type: 'exterior',
      user: { name: 'Car Enthusiast', isVerified: false, avatar: null },
      isVerified: false 
    },
    { 
      id: 6, 
      url: vehicle.image, 
      type: 'interior',
      user: { name: 'PTZ Inspector', isVerified: true, avatar: null },
      isVerified: true 
    },
  ];

  const handleImageUpload = (files: FileList | null, type: string, description: string) => {
    if (!files || files.length === 0) return;
    
    // In a real app, we would upload the file to storage here
    console.log('Uploading images:', files, 'Type:', type, 'Description:', description);
    
    toast({
      title: "Images submitted",
      description: "Your images have been submitted and are pending verification.",
    });
    
    setIsUploadModalOpen(false);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle>Vehicle Gallery</CardTitle>
        <div className="flex gap-2">
          <Button size="sm" variant="outline">
            <View className="h-4 w-4 mr-2" />
            View All
          </Button>
          <Button 
            size="sm" 
            variant="outline"
            onClick={() => setIsUploadModalOpen(true)}
          >
            <Upload className="h-4 w-4 mr-2" />
            Upload
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {mockImages.length > 0 ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {mockImages.map((image) => (
              <div key={image.id} className="aspect-video relative overflow-hidden rounded-md group">
                <img 
                  src={image.url} 
                  alt={`${vehicle.make} ${vehicle.model} ${image.type}`}
                  className="w-full h-full object-cover hover:scale-105 transition-transform"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-2">
                  <div className="flex justify-between items-center">
                    <Badge variant="secondary" className="text-xs">
                      {image.type}
                    </Badge>
                    
                    <div className="flex items-center gap-1">
                      {image.isVerified && (
                        <CheckCircle2 className="h-3 w-3 text-green-400" />
                      )}
                      <Avatar className="h-4 w-4">
                        <AvatarImage src={image.user.avatar || undefined} />
                        <AvatarFallback className="text-[8px]">{image.user.name?.charAt(0) || '?'}</AvatarFallback>
                      </Avatar>
                      <span className="text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity">
                        {image.user.name}
                      </span>
                    </div>
                  </div>
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
            <Button 
              variant="outline"
              onClick={() => setIsUploadModalOpen(true)}
            >
              Upload Images
            </Button>
          </div>
        )}
      </CardContent>
      
      <ImageUploadModal 
        open={isUploadModalOpen} 
        onOpenChange={setIsUploadModalOpen}
        onUpload={handleImageUpload}
        vehicleInfo={{
          make: vehicle.make,
          model: vehicle.model,
          year: vehicle.year
        }}
      />
    </Card>
  );
};

export default VehicleGallery;
