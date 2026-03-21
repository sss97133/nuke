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
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '2px 12px',
        fontSize: '9px',
        fontFamily: 'Arial, sans-serif',
        fontWeight: 600,
        textTransform: 'uppercase' as const,
        letterSpacing: '0.04em',
        color: 'var(--text-secondary)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span style={{ color: 'var(--warning)', fontSize: '10px' }}>&#9650;</span>
      <span>{issues.join(' \u00B7 ')}</span>
      <div style={{ display: 'flex', gap: '6px', marginLeft: 'auto' }}>
        {!hasVIN && (
          <button
            onClick={handleCompleteProfile}
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              padding: '1px 6px', fontSize: '8px',
              fontWeight: 600,
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              textTransform: 'uppercase' as const,
              letterSpacing: '0.04em',
              fontFamily: 'Arial, sans-serif',
            }}
          >
            ADD VIN
          </button>
        )}
        {session?.user?.id && !vehicle?.uploaded_by && (
          <button
            onClick={handleClaim}
            disabled={isClaiming}
            style={{
              background: 'transparent',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
              padding: '1px 6px', fontSize: '8px',
              fontWeight: 600,
              cursor: isClaiming ? 'wait' : 'pointer',
              whiteSpace: 'nowrap',
              textTransform: 'uppercase' as const,
              letterSpacing: '0.04em',
              fontFamily: 'Arial, sans-serif',
            }}
          >
            {isClaiming ? 'CLAIMING...' : 'CLAIM'}
          </button>
        )}
      </div>
      <button
        onClick={handleDismiss}
        style={{
          background: 'transparent',
          border: 'none',
          color: 'var(--text-disabled)',
          fontSize: '10px',
          cursor: 'pointer',
          padding: '0 2px',
          lineHeight: 1,
        }}
        title="Dismiss"
      >
        &#215;
      </button>
    </div>
  );
};

export default OrphanedVehicleBanner;

