import React from 'react';
import ImageGallery from '../../components/images/ImageGallery';
import VehicleVideos from '../../components/media/VehicleVideos';
import type { Vehicle, VehiclePermissions } from './types';

interface VehicleMediaTabProps {
  vehicle: Vehicle;
  vehicleImages: string[];
  fallbackListingImageUrls: string[];
  onImagesUpdated: () => void;
  session: any;
  permissions: VehiclePermissions;
}

const VehicleMediaTab: React.FC<VehicleMediaTabProps> = ({
  vehicle,
  vehicleImages,
  fallbackListingImageUrls,
  onImagesUpdated,
  session,
  permissions
}) => {
  return (
    <div>
      <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading gallery...</div>}>
        <ImageGallery
          vehicleId={vehicle.id}
          showUpload={true}
          fallbackImageUrls={vehicleImages.length > 0 ? [] : fallbackListingImageUrls}
          fallbackLabel={(vehicle as any)?.profile_origin === 'bat_import' ? 'BaT listing' : 'Listing'}
          fallbackSourceUrl={
            (vehicle as any)?.discovery_url ||
            (vehicle as any)?.bat_auction_url ||
            (vehicle as any)?.listing_url ||
            undefined
          }
          onImagesUpdated={onImagesUpdated}
        />
      </React.Suspense>

      {/* Unified Videos Section - all sources */}
      <VehicleVideos 
        vehicleId={vehicle.id} 
        userId={session?.user?.id}
      />
    </div>
  );
};

export default VehicleMediaTab;

