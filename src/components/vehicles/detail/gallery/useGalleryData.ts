
import { useState } from 'react';
import { Vehicle } from '@/components/vehicles/discovery/types';
import { GalleryImage } from './types';
import { useToast } from "@/components/ui/use-toast";

export const useGalleryData = (vehicle: Vehicle) => {
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const { toast } = useToast();
  
  // In a real app, this would be actual gallery data from an API
  const mockImages: GalleryImage[] = [
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

  return {
    images: mockImages,
    isUploadModalOpen,
    setIsUploadModalOpen,
    handleImageUpload
  };
};
