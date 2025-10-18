import React from 'react';
import ImageGallery from '../../components/images/ImageGallery';
import VehicleContributors from '../../components/VehicleContributors';
import type { VehicleImageGalleryProps } from './types';

const VehicleImageGallery: React.FC<VehicleImageGalleryProps> = ({
  vehicle,
  session,
  permissions,
  showMap,
  onToggleMap,
  onImageUpdate
}) => {
  return (
    <div className="card" style={{ gridColumn: '2 / span 1' }}>
      <div className="card-body">
        <ImageGallery
          vehicleId={vehicle.id}
          onImagesUpdated={onImageUpdate}
          showUpload={session && (permissions.hasContributorAccess || permissions.isVerifiedOwner)}
        />

        {/* Contributors section */}
        <div className="mt-4">
          <VehicleContributors vehicleId={vehicle.id} />
        </div>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <button className="button button-small" onClick={onToggleMap}>
              {showMap ? 'Hide Map' : 'Show Map'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VehicleImageGallery;