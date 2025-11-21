import { useState, useEffect } from 'react';
import { OwnershipService } from '../services/ownershipService';

interface VehiclePermissions {
  isOwner: boolean;
  hasContributorAccess: boolean;
  contributorRole: string | null;
  canEdit: boolean;
  canUpload: boolean;
  canDelete: boolean;
  loading: boolean;
}

export const useVehiclePermissions = (
  vehicleId: string | null,
  session: any,
  vehicle: any
): VehiclePermissions => {
  const [permissions, setPermissions] = useState<VehiclePermissions>({
    isOwner: false,
    hasContributorAccess: false,
    contributorRole: null,
    canEdit: false,
    canUpload: false,
    canDelete: false,
    loading: true
  });

  useEffect(() => {
    if (!session?.user || !vehicleId) {
      setPermissions(prev => ({ ...prev, loading: false }));
      return;
    }

    const checkPermissions = async () => {
      try {
        const status = await OwnershipService.getOwnershipStatus(vehicleId, session);
        
        // Map OwnershipService status to hook permissions
        // IMPORTANT: We do NOT default to isOwner just because they are the uploader.
        // isLegalOwner means verified via ownership_verifications table.
        // contributor_owner means explicitly set as 'owner' role in vehicle_contributors.
        const isOwner = status.isLegalOwner || status.status === 'contributor_owner';
        
        // Debug logging
        console.log('[useVehiclePermissions] Status:', {
          vehicleId,
          status: status.status,
          hasContributorAccess: status.hasContributorAccess,
          isUploader: status.isUploader,
          contributorRole: status.contributorRole,
          permissionLevel: status.permissionLevel,
          isOwner
        });
        
        setPermissions({
          isOwner,
          hasContributorAccess: status.hasContributorAccess || status.isUploader,
          contributorRole: status.contributorRole || (status.isUploader ? 'uploader' : null),
          canEdit: status.permissionLevel === 'full' || status.permissionLevel === 'edit',
          canUpload: status.permissionLevel !== 'view',
          canDelete: status.permissionLevel === 'full',
          loading: false
        });
      } catch (err) {
        console.error('[useVehiclePermissions] Error checking permissions:', err);
        setPermissions(prev => ({ ...prev, loading: false }));
      }
    };

    checkPermissions();
  }, [vehicleId, session?.user?.id]);

  return permissions;
};
