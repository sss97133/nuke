
export interface GalleryImage {
  id: string | number;
  url: string;
  type: string;
  user?: {
    name: string;
    avatar?: string;
  };
  isVerified?: boolean;
}

export interface VehicleGalleryProps {
  vehicle: {
    id: string | number;
    make: string;
    model: string;
    year: number | string;
    mileage?: number;
    image?: string;
    location?: string;
    added?: string;
    [key: string]: any;
  };
}

export interface GalleryHeaderProps {
  vehicle: {
    make: string;
    model: string;
    year: number | string;
  };
  totalImages: number;
  onOpenUploadModal?: () => void;
}

export interface GalleryImagesProps {
  images: GalleryImage[];
  isLoading?: boolean;
  onOpenUploadModal?: () => void;
}

export interface EmptyGalleryProps {
  vehicle: {
    make: string;
    model: string;
    year: number | string;
  };
  onOpenUploadModal?: () => void;
}
