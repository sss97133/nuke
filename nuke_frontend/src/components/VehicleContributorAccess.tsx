import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import VINPhotoValidator from './VINPhotoValidator';

interface VehicleContributorAccessProps {
  vehicleId: string;
  vehicleVin?: string | null;
  isOwner: boolean;
  onAccessGranted: () => void;
}

interface UserPermission {
  id: string;
  user_id: string;
  vehicle_id: string;
  role: 'owner' | 'sales_agent' | 'moderator' | 'public_contributor' | 'verified_contributor';
  granted_at: string;
  expires_at: string | null;
  is_active: boolean;
}

interface VINValidation {
  id: string;
  validation_status: 'pending' | 'approved' | 'rejected' | 'expired';
  expires_at: string;
  submitted_vin: string;
}

const VehicleContributorAccess: React.FC<VehicleContributorAccessProps> = ({
  vehicleId,
  vehicleVin,
  isOwner,
  onAccessGranted
}) => {
  const [userPermissions, setUserPermissions] = useState<UserPermission[]>([]);
  const [vinValidations, setVinValidations] = useState<VINValidation[]>([]);
  const [showVinValidator, setShowVinValidator] = useState(false);
  const [hasValidAccess, setHasValidAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    checkAuth();
    if (!isOwner) {
      checkUserAccess();
    } else {
      setHasValidAccess(true);
      setLoading(false);
    }
  }, [vehicleId, isOwner]);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    setSession(session);
  };

  const checkUserAccess = async () => {
    if (!session?.user?.id) {
      setLoading(false);
      return;
    }

    try {
      // Check for existing permissions
      const { data: permissions } = await supabase
        .from('vehicle_user_permissions')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('user_id', session.user.id)
        .eq('is_active', true);

      if (permissions) {
        setUserPermissions(permissions);
        
        // Check if any permission is still valid
        const validPermission = permissions.find(p => 
          !p.expires_at || new Date(p.expires_at) > new Date()
        );
        
        if (validPermission) {
          setHasValidAccess(true);
          onAccessGranted();
        }
      }

      // Check for VIN validations
      const { data: validations } = await supabase
        .from('vin_validations')
        .select('*')
        .eq('vehicle_id', vehicleId)
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false });

      if (validations) {
        setVinValidations(validations);
        
        // Check if any VIN validation is approved and not expired
        const validVin = validations.find(v => 
          v.validation_status === 'approved' && 
          new Date(v.expires_at) > new Date()
        );
        
        if (validVin) {
          setHasValidAccess(true);
          onAccessGranted();
        }
      }

    } catch (error) {
      console.error('Error checking user access:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleVinValidationComplete = async (success: boolean, validationId?: string) => {
    setShowVinValidator(false);
    
    if (success && validationId) {
      setHasValidAccess(true);
      onAccessGranted();
      
      // Refresh validations
      await checkUserAccess();
    }
  };

  const requestAccess = () => {
    if (!vehicleVin) {
      alert('VIN validation is not available for this vehicle. Please contact the vehicle owner for access.');
      return;
    }
    
    setShowVinValidator(true);
  };

  const formatTimeRemaining = (expiresAt: string) => {
    const now = new Date();
    const expires = new Date(expiresAt);
    const diff = expires.getTime() - now.getTime();
    
    if (diff <= 0) return 'Expired';
    
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
    
    if (hours > 0) {
      return `${hours}h ${minutes}m remaining`;
    } else {
      return `${minutes}m remaining`;
    }
  };

  if (loading) {
    return (
      <div className="contributor-access-loading">
        <div className="loading-spinner"></div>
        <p>Checking access permissions...</p>
      </div>
    );
  }

  if (isOwner) {
    return (
      <div className="contributor-access owner">
        <div className="access-status">
          <span className="badge badge-success">Vehicle Owner</span>
          <span className="text-small text-muted">Full access to all features</span>
        </div>
      </div>
    );
  }

  if (hasValidAccess) {
    const activePermission = userPermissions.find(p => 
      p.is_active && (!p.expires_at || new Date(p.expires_at) > new Date())
    );
    
    const activeValidation = vinValidations.find(v => 
      v.validation_status === 'approved' && new Date(v.expires_at) > new Date()
    );

    return (
      <div className="contributor-access granted">
        <div className="access-status">
          <span className="badge badge-success">Contributor Access</span>
          {activePermission && (
            <div className="access-details">
              <span className="text-small">Role: {activePermission.role}</span>
              {activePermission.expires_at && (
                <span className="text-small text-muted">
                  {formatTimeRemaining(activePermission.expires_at)}
                </span>
              )}
            </div>
          )}
          {activeValidation && !activePermission && (
            <div className="access-details">
              <span className="text-small">VIN Verified</span>
              <span className="text-small text-muted">
                {formatTimeRemaining(activeValidation.expires_at)}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="contributor-access login-required">
        <div className="card">
          <div className="card-body text-center">
            <h3 className="text-large font-bold" style={{ marginBottom: '16px' }}>
              Contributor Access Required
            </h3>
            <p className="text-muted" style={{ marginBottom: '24px' }}>
              To contribute to this vehicle's profile, please log in and verify your access.
            </p>
            <button 
              className="button button-primary"
              onClick={() => {/* Implement login flow */}}
            >
              Sign In to Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="contributor-access request">
      <div className="card">
        <div className="card-body">
          <h3 className="text-large font-bold" style={{ marginBottom: '16px' }}>
            Request Contributor Access
          </h3>
          <p className="text-muted" style={{ marginBottom: '24px' }}>
            To contribute to this vehicle's profile, you need to verify your access by uploading 
            a photo of the vehicle's VIN tag.
          </p>

          {vinValidations.length > 0 && (
            <div className="previous-validations" style={{ marginBottom: '24px' }}>
              <h4 className="text font-bold" style={{ marginBottom: '12px' }}>
                Previous Validation Attempts
              </h4>
              {vinValidations.map(validation => (
                <div key={validation.id} className="validation-item" style={{ 
                  padding: '12px', 
                  border: '1px solid #e5e7eb', 
                  borderRadius: '6px',
                  marginBottom: '8px'
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <span className={`badge ${
                        validation.validation_status === 'approved' ? 'badge-success' :
                        validation.validation_status === 'pending' ? 'badge-warning' :
                        validation.validation_status === 'rejected' ? 'badge-danger' :
                        'badge-secondary'
                      }`}>
                        {validation.validation_status}
                      </span>
                      <span className="text-small text-muted" style={{ marginLeft: '8px' }}>
                        VIN: {validation.submitted_vin}
                      </span>
                    </div>
                    <span className="text-small text-muted">
                      {validation.validation_status === 'approved' && new Date(validation.expires_at) > new Date() 
                        ? formatTimeRemaining(validation.expires_at)
                        : new Date(validation.expires_at) < new Date() 
                        ? 'Expired' 
                        : 'Pending'
                      }
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="access-options">
            <button 
              className="button button-primary"
              onClick={requestAccess}
              disabled={!vehicleVin}
            >
              Verify VIN Access
            </button>
            {!vehicleVin && (
              <p className="text-small text-muted" style={{ marginTop: '8px' }}>
                VIN verification not available for this vehicle
              </p>
            )}
          </div>
        </div>
      </div>

      {showVinValidator && (
        <VINPhotoValidator
          vehicleId={vehicleId}
          onValidationComplete={handleVinValidationComplete}
          onCancel={() => setShowVinValidator(false)}
        />
      )}
    </div>
  );
};

export default VehicleContributorAccess;
