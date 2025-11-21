import React from 'react';
import ImageGalleryV2 from '../../components/image/ImageGalleryV2';
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
  // Show upload if user is logged in AND (has contributor access OR is verified owner OR is db uploader)
  const canUpload = Boolean(
    session?.user && (
      permissions.hasContributorAccess || 
      permissions.isVerifiedOwner || 
      permissions.isDbUploader ||
      session.user?.id === vehicle.user_id
    )
  );

  // DEBUG: Log permissions
  console.log('[VehicleImageGallery] Upload permissions:', {
    hasSession: !!session?.user,
    userId: session?.user?.id,
    vehicleUserId: vehicle.user_id,
    hasContributorAccess: permissions.hasContributorAccess,
    isVerifiedOwner: permissions.isVerifiedOwner,
    isDbUploader: permissions.isDbUploader,
    canUpload,
    showUploadProp: canUpload
  });

  return (
    <div className="card" style={{ gridColumn: '2 / span 1' }}>
      <div className="card-body">
        <ImageGalleryV2
          vehicleId={vehicle.id}
          vehicleYMM={{ year: vehicle.year, make: vehicle.make, model: vehicle.model }}
          onImagesUpdated={onImageUpdate}
          showUpload={canUpload}
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