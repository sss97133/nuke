import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../../lib/supabase';

interface OrphanedVehicleBannerProps {
  vehicle: any;
  session: any;
  permissions: any;
  onDismiss?: () => void;
}

const VehicleNotice: React.FC<OrphanedVehicleBannerProps> = ({
  vehicle,
  session,
  permissions,
  onDismiss
}) => {
  const navigate = useNavigate();
  const [dismissed, setDismissed] = useState(false);
  const [isClaiming, setIsClaiming] = useState(false);

  const hasVIN = vehicle?.vin && vehicle.vin.trim() !== '' && !vehicle.vin.startsWith('VIVA-');

  // Check if vehicle is orphaned or requires attention
  const isOrphaned = vehicle?.origin_metadata?.orphaned_vehicle === true ||
                     (!vehicle?.uploaded_by && !vehicle?.origin_organization_id && vehicle?.profile_origin === 'dropbox_import');

  const requiresAttention = vehicle?.origin_metadata?.requires_attention === true;

  // Also show if vehicle is pending with missing critical data (no VIN)
  const isPending = vehicle && ((vehicle as any).status === 'pending' || !hasVIN);
  const showBanner = isOrphaned || requiresAttention || (isPending && !hasVIN && vehicle?.origin_metadata?.orphaned_vehicle !== false);

  // Only a banner that renders needs to know whether the vehicle has any image, and only whether it has one: ask for
  // one row, not an exact count (which runs the image row policy over every photo of the vehicle for every visitor).
  const [imageStatus, setImageStatus] = useState<'pending' | 'present' | 'empty' | 'unavailable'>('pending');
  const [imageAttempt, setImageAttempt] = useState(0);
  useEffect(() => {
    if (!showBanner || !vehicle?.id) return;
    let cancelled = false;
    setImageStatus('pending');
    void (async () => {
      try {
        const { data, error } = await supabase.from('vehicle_images')
          .select('id').eq('vehicle_id', vehicle.id).limit(1);
        if (!cancelled) setImageStatus(error || !Array.isArray(data) ? 'unavailable' : data.length > 0 ? 'present' : 'empty');
      } catch {
        if (!cancelled) setImageStatus('unavailable');
      }
    })();
    return () => { cancelled = true; };
  }, [showBanner, vehicle?.id, imageAttempt]);

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
  if (imageStatus === 'empty') issues.push('No images visible');
  if (!vehicle?.uploaded_by && !vehicle?.origin_organization_id) issues.push('No owner or organization');

  return (
    <div className="vp-attention-banner">
      <span className="vp-attention-banner__icon" aria-hidden="true">&#9650;</span>
      <div>
        <span>{issues.join(' \u00B7 ')}</span>
        {imageStatus === 'pending' && <div role="status">Checking images…</div>}
        {imageStatus === 'unavailable' && <div role="status">Image status unavailable. Missing images have not been established.</div>}
      </div>
      <div className="vp-attention-banner__actions">
        {imageStatus === 'unavailable' && <button type="button" className="vp-attention-banner__action" onClick={() => setImageAttempt(attempt => attempt + 1)}>Retry image check</button>}
        {!hasVIN && (
          <button
            onClick={handleCompleteProfile}
            className="vp-attention-banner__action"
          >
            Add VIN
          </button>
        )}
        {session?.user?.id && !vehicle?.uploaded_by && (
          <button
            onClick={handleClaim}
            disabled={isClaiming}
            className="vp-attention-banner__action"
          >
            {isClaiming ? 'Claiming…' : 'Claim'}
          </button>
        )}
      </div>
      <button
        onClick={handleDismiss}
        className="vp-attention-banner__dismiss"
        aria-label="Dismiss vehicle notice"
        title="Dismiss"
      >
        &#215;
      </button>
    </div>
  );
};

// Keep notice dismissal and asynchronous reads scoped to the actual vehicle and viewer.
const OrphanedVehicleBanner: React.FC<OrphanedVehicleBannerProps> = props => (
  <VehicleNotice key={`${props.vehicle?.id || ''}:${props.session?.user?.id || 'public'}`} {...props} />
);

export default OrphanedVehicleBanner;

