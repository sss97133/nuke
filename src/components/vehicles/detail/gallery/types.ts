
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
}

export interface GalleryImagesProps {
  images: GalleryImage[];
  isLoading?: boolean;
}

export interface EmptyGalleryProps {
  vehicle: {
    make: string;
    model: string;
    year: number | string;
  };
}
