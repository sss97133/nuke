
import { Vehicle } from '@/components/vehicles/discovery/types';

export interface VehicleGalleryProps {
  vehicle: Vehicle;
}

export interface GalleryHeaderProps {
  onOpenUploadModal: () => void;
}

export interface GalleryImagesProps {
  images: GalleryImage[];
  onOpenUploadModal: () => void;
}

export interface GalleryImage {
  id: number;
  url: string;
  type: string;
  user: {
    name: string | null;
    isVerified: boolean;
    avatar: string | null;
  };
  isVerified: boolean;
}

export interface EmptyGalleryProps {
  onOpenUploadModal: () => void;
}
