import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface OrphanedVehicleBannerProps {
  vehicle: any;
  session: any;
  permissions: any;
  onDismiss?: () => void;
}

const OrphanedVehicleBanner: React.FC<OrphanedVehicleBannerProps> = ({
  vehicle,
  session,
  permissions,
  onDismiss
}) => {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  // Check image count
  const [imageCount, setImageCount] = useState<number>(0);
  useEffect(() => {
    if (vehicle?.id) {
      supabase
        .from('vehicle_images')
        .select('id', { count: 'exact', head: true })
        .eq('vehicle_id', vehicle.id)
        .then(({ count }) => setImageCount(count || 0));
    }
  }, [vehicle?.id]);
  
  const hasVIN = vehicle?.vin && vehicle.vin.trim() !== '' && !vehicle.vin.startsWith('VIVA-');
  const hasImages = imageCount > 0;
  
  // Check if vehicle is orphaned or requires attention
  const isOrphaned = vehicle?.origin_metadata?.orphaned_vehicle === true ||
                     (!vehicle?.uploaded_by && !vehicle?.origin_organization_id && vehicle?.profile_origin === 'dropbox_import');
  
  const requiresAttention = vehicle?.origin_metadata?.requires_attention === true;
  
  // Also show if vehicle is pending with missing critical data (no VIN)
  const isPending = vehicle && ((vehicle as any).status === 'pending' || !hasVIN);
  const showBanner = isOrphaned || requiresAttention || (isPending && !hasVIN && vehicle?.origin_metadata?.orphaned_vehicle !== false);

  if (!showBanner) return null;
  if (dismissed) return null;

  const handleDismiss = () => {
    setDismissed(true);
    if (onDismiss) onDismiss();
  };

  const handleClaim = async () => {
    if (!session?.user?.id) {
      navigate('/login');
      return;
    }

    setIsClaiming(true);
    try {
      // Update vehicle to claim it
      const { error } = await supabase
        .from('vehicles')
        .update({
          uploaded_by: session.user.id,
          origin_metadata: {
            ...(vehicle.origin_metadata || {}),
            claimed_by: session.user.id,
            claimed_at: new Date().toISOString(),
            requires_attention: false
          }
        })
        .eq('id', vehicle.id);

      if (error) throw error;

      window.location.reload();
    } catch (error: any) {
      console.error('Error claiming vehicle:', error);
      alert('Failed to claim vehicle: ' + error.message);
    } finally {
      setIsClaiming(false);
    }
  };

  const handleCompleteProfile = () => {
    navigate(`/vehicle/${vehicle.id}/edit`);
  };

  const issues: string[] = [];
  if (!hasVIN) issues.push('Missing VIN');
  if (!hasImages) issues.push('No images');
  if (!vehicle?.uploaded_by && !vehicle?.origin_organization_id) issues.push('No owner or organization');

  return (
    <div
      style={{
        background: '#fef3c7',
        border: '1px solid #f59e0b',
        borderRadius: '4px',
        padding: '8px 12px',
        margin: '8px var(--space-2)',
        boxShadow: '0 1px 3px rgba(245, 158, 11, 0.15)',
        position: 'relative'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
          <span style={{ fontSize: '12px' }}>⚠️</span>
          <span style={{ fontSize: '9pt', fontWeight: 600, color: '#92400e' }}>
            Incomplete profile
          </span>
          {issues.length > 0 && (
            <span style={{ fontSize: '8pt', color: '#78350f' }}>
              • Missing: {issues.join(', ')}
            </span>
          )}
          
          <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto', flexWrap: 'wrap' }}>
            {!hasVIN && (
              <button
                onClick={handleCompleteProfile}
                style={{
                  background: '#f59e0b',
                  color: 'white',
                  border: 'none',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '8pt',
                  fontWeight: 600,
                  cursor: 'pointer',
                  whiteSpace: 'nowrap'
                }}
                onMouseOver={(e) => e.currentTarget.style.background = '#d97706'}
                onMouseOut={(e) => e.currentTarget.style.background = '#f59e0b'}
              >
                Add VIN
              </button>
            )}
            
            {session?.user?.id && !vehicle?.uploaded_by && (
              <button
                onClick={handleClaim}
                disabled={isClaiming}
                style={{
                  background: 'transparent',
                  color: '#92400e',
                  border: '1px solid #f59e0b',
                  padding: '4px 10px',
                  borderRadius: '4px',
                  fontSize: '8pt',
                  fontWeight: 600,
                  cursor: isClaiming ? 'wait' : 'pointer',
                  whiteSpace: 'nowrap'
                }}
                onMouseOver={(e) => !isClaiming && (e.currentTarget.style.background = '#fde68a')}
                onMouseOut={(e) => !isClaiming && (e.currentTarget.style.background = 'transparent')}
              >
                {isClaiming ? 'Claiming...' : 'Claim'}
              </button>
            )}
          </div>
        </div>

        <button
          onClick={handleDismiss}
          style={{
            background: 'transparent',
            border: 'none',
            color: '#92400e',
            fontSize: '16px',
            cursor: 'pointer',
            padding: '2px 4px',
            lineHeight: 1,
            opacity: 0.6,
            flexShrink: 0
          }}
          title="Dismiss"
        >
          ×
        </button>
      </div>
    </div>
  );
};

export default OrphanedVehicleBanner;

