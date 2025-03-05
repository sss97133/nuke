
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
