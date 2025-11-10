/**
 * useVehiclePermissions Hook
 * Consolidates all ownership and permission checking logic
 * Single source of truth for vehicle access control
 */

import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

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
  const [isOwner, setIsOwner] = useState(false);
  const [hasContributorAccess, setHasContributorAccess] = useState(false);
  const [contributorRole, setContributorRole] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!session?.user || !vehicle || !vehicleId) {
      setIsOwner(false);
      setHasContributorAccess(false);
      setContributorRole(null);
      setLoading(false);
      return;
    }

    const checkPermissions = async () => {
      setLoading(true);

      try {
        // Check if user is the vehicle owner (uploaded_by or user_id)
        const isVehicleOwner = 
          vehicle.uploaded_by === session.user.id || 
          vehicle.user_id === session.user.id;
        
        setIsOwner(isVehicleOwner);

        // Check for contributor access (vehicle-level)
        const { data: vehicleContrib, error: vcError } = await supabase
          .from('vehicle_contributors')
          .select('role')
          .eq('vehicle_id', vehicleId)
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (!vcError && vehicleContrib) {
          const allowedRoles = ['owner', 'co_owner', 'restorer', 'moderator', 'consigner'];
          setHasContributorAccess(allowedRoles.includes(vehicleContrib.role));
          setContributorRole(vehicleContrib.role);
        } else {
          // Check for organization-level contributor access
          // Use a simpler query that definitely works
          const { data: orgContrib, error: ocError } = await supabase
            .from('organization_vehicles')
            .select('organization_id')
            .eq('vehicle_id', vehicleId)
            .limit(1)
            .maybeSingle();

          if (!ocError && orgContrib) {
            // Now check if user is contributor to this org
            const { data: userInOrg } = await supabase
              .from('organization_contributors')
              .select('role, status')
              .eq('organization_id', orgContrib.organization_id)
              .eq('user_id', session.user.id)
              .eq('status', 'active')
              .maybeSingle();

            if (userInOrg) {
              console.log('[useVehiclePermissions] User is org contributor:', userInOrg.role);
              setHasContributorAccess(true);
              setContributorRole(userInOrg.role);
            } else {
              console.log('[useVehiclePermissions] User not in org contributors');
              setHasContributorAccess(false);
              setContributorRole(null);
            }
          } else {
            setHasContributorAccess(false);
            setContributorRole(null);
          }
        }
      } catch (err) {
        console.error('[useVehiclePermissions] Error checking permissions:', err);
        setIsOwner(false);
        setHasContributorAccess(false);
        setContributorRole(null);
      } finally {
        setLoading(false);
      }
    };

    checkPermissions();
  }, [vehicleId, session?.user?.id, vehicle?.uploaded_by, vehicle?.user_id]);

  // Derived permissions
  const canEdit = isOwner || hasContributorAccess;
  const canUpload = isOwner || hasContributorAccess;
  const canDelete = isOwner; // Only owners can delete

  return {
    isOwner,
    hasContributorAccess,
    contributorRole,
    canEdit,
    canUpload,
    canDelete,
    loading
  };
};

