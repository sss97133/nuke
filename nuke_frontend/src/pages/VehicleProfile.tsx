import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useValuationIntel } from '../hooks/useValuationIntel';
import { useVehicleMemeDrops } from '../hooks/useVehicleMemeDrops';
import { TimelineEventService } from '../services/timelineEventService';
const AddEventWizard = React.lazy(() => import('../components/AddEventWizard'));
const VehicleHeader = React.lazy(() => import('./vehicle-profile/VehicleHeader'));
const VehicleHeroImage = React.lazy(() => import('./vehicle-profile/VehicleHeroImage'));
import '../styles/unified-design-system.css';
import '../styles/vehicle-profile.css';
const VehicleSubHeader = React.lazy(() => import('./vehicle-profile/VehicleSubHeader'));
const AddOrganizationRelationship = React.lazy(() => import('../components/vehicle/AddOrganizationRelationship'));
import { usePageTitle, getVehicleTitle } from '../hooks/usePageTitle';
const ValidationPopupV2 = React.lazy(() => import('../components/vehicle/ValidationPopupV2'));
import VehicleMemeOverlay from '../components/vehicle/VehicleMemeOverlay';
const VehicleOwnershipPanel = React.lazy(() => import('../components/ownership/VehicleOwnershipPanel'));
import { VehicleProfileProvider, useVehicleProfile } from './vehicle-profile/VehicleProfileContext';
const WorkspaceContent = React.lazy(() => import('./vehicle-profile/WorkspaceContent'));
const VehicleBanners = React.lazy(() => import('./vehicle-profile/VehicleBanners'));
const BarcodeTimeline = React.lazy(() => import('./vehicle-profile/BarcodeTimeline'));

const QuickStatsBar = React.lazy(() => import('./vehicle-profile/QuickStatsBar'));

const VehicleProfileInner: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const ctx = useVehicleProfile();

  // Aliases from context — single source of truth
  const { vehicleId, vehicle, session, vehicleImages, auctionPulse, isRowOwner, isVerifiedOwner, canEdit, hasContributorAccess, isAdminUser: isAdmin, canTriggerProofAnalysis, userOwnershipClaim, permissions, isPublic } = ctx;

  // Local-only state (not in context)
  const [referenceLibraryRefreshKey, setReferenceLibraryRefreshKey] = useState(0);
  const [showAddEvent, setShowAddEvent] = useState(false);
  const vehicleHeaderRef = React.useRef<HTMLDivElement | null>(null);

  // Measure VehicleHeader height for sticky positioning
  useEffect(() => {
    const el = vehicleHeaderRef.current;
    if (!el) return;
    const update = () => ctx.setVehicleHeaderHeight(el.offsetHeight);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [vehicle, auctionPulse]); // eslint-disable-line react-hooks/exhaustive-deps

  const [showAddOrgRelationship, setShowAddOrgRelationship] = useState(false);
  const [showOwnershipClaim, setShowOwnershipClaim] = useState(false);
  const [batAutoImportStatus, setBatAutoImportStatus] = useState<'idle' | 'running' | 'done' | 'failed'>('idle');
  const { lastMemeDrop } = useVehicleMemeDrops(vehicle?.id);

  // Fallback listing images handled by VehicleProfileContext

  // Left column: make all cards collapsible by clicking the header bar.
  // This avoids rewriting every individual card component while keeping behavior consistent.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    if (!vehicle?.id) return;

    const container = document.querySelector('.vehicle-profile-left-column');
    if (!container) return;

    const onClick = (e: Event) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Don't collapse when interacting with controls in the header (buttons, links, inputs, etc.).
      if (target.closest('button, a, input, select, textarea, label, [role="button"]')) return;

      const header = target.closest('.card-header') as HTMLElement | null;
      if (!header) return;

      const card = header.closest('.card') as HTMLElement | null;
      if (!card) return;

      // Only collapse top-level cards in the left column (ignore nested cards inside a card body).
      let p: HTMLElement | null = card.parentElement;
      while (p && p !== container) {
        if (p.classList.contains('card')) return;
        p = p.parentElement;
      }
      if (p !== container) return;

      card.classList.toggle('is-collapsed');
    };

    container.addEventListener('click', onClick);
    return () => {
      container.removeEventListener('click', onClick);
    };
  }, [vehicle?.id]);

  // PAGE TITLE MANAGEMENT
  usePageTitle(() => getVehicleTitle(vehicle));

  // URL-driven claim flow fallback: /vehicle/:id?claim=1 opens the ownership modal
  // This makes "Claim this vehicle" work even if onClick handlers are flaky on some devices.
  useEffect(() => {
    try {
      const params = new URLSearchParams(location.search || '');
      if (params.get('claim') === '1') {
        setShowOwnershipClaim(true);
        params.delete('claim');
        const nextSearch = params.toString();
        const nextUrl = `${location.pathname}${nextSearch ? `?${nextSearch}` : ''}`;
        // Replace so refresh doesn't re-open forever
        navigate(nextUrl, { replace: true });
      }
    } catch {
      // ignore
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search, location.pathname]);

  const { valuation: valuationIntel, readiness: readinessSnapshot } = useValuationIntel(vehicle?.id || null);

  // Permissions, ownership, admin status all provided by VehicleProfileContext

  // Auth bootstrap + initial load + ownership verifications handled by VehicleProfileContext

  // Auto-create bundle events when owner views their vehicle
  // Fire-and-forget: idempotent, safe to run on every load
  useEffect(() => {
    if (!vehicleId || !canEdit) return;
    const token = session?.access_token;
    if (!token) return;
    fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/auto-create-bundle-events`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ vehicle_id: vehicleId }),
    }).catch(() => {}); // intentionally silent — not critical path
  }, [vehicleId, canEdit, session?.access_token]);

  // Event listeners for vehicle_images_updated and timeline_updated handled by VehicleProfileContext

  // Post-vehicle-load side effects (unique to VehicleProfile.tsx — context handles images/timeline/comments/observations/orgs/responsible)
  useEffect(() => {
    if (vehicle?.id) recordView();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id]);

  // Realtime vehicles, vehicle_images, auction pulse all handled by VehicleProfileContext

  // Listen for timeline events created from image uploads to prompt review
  useEffect(() => {
    const onEventsCreated = (e: any) => {
      if (!vehicle?.id) return;
      const { vehicleId: vid, count, dates } = e?.detail || {};
      if (vid && vid === vehicle.id) {
        ctx.reloadTimeline();
      }
    };
    window.addEventListener('timeline_events_created', onEventsCreated as any);
    return () => window.removeEventListener('timeline_events_created', onEventsCreated as any);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id]);


  // loadResponsible handled by VehicleProfileContext


  // Heartbeat: upsert current user presence
  useEffect(() => {
    let t: any;
    const beat = async () => {
      try {
        if (!vehicle?.id) return;
        const { data: auth } = await supabase.auth.getUser();
        const uid = auth?.user?.id || null;
        // Presence tracking - silently ignore all errors as table may not exist
        const { error } = await supabase
          .from('user_presence')
          .upsert({ vehicle_id: vehicle.id, user_id: uid, last_seen_at: new Date().toISOString() }, { onConflict: 'vehicle_id,user_id' });
        // Intentionally ignore error - presence is non-critical
      } catch {
        // Silently ignore all presence tracking failures
      }
    };
    if (vehicle) {
      beat();
      t = setInterval(beat, 60 * 1000);
      return () => clearInterval(t);
    }
  }, [vehicle]);

  // loadLiveSession, checkAuth, loadTimelineEvents, loadVehicle all handled by VehicleProfileContext

  const updatePrivacy = async () => {
    if (!vehicle || vehicle.isAnonymous) return;

    try {
      const oldVehicle = { ...vehicle };
      const { error } = await supabase
        .from('vehicles')
        .update({ is_public: isPublic })
        .eq('id', vehicle.id);

      if (error) {
        console.error('Error updating vehicle visibility:', error);
        return;
      }

      // Create timeline event for visibility change
      await TimelineEventService.createVehicleEditEvent(
        vehicle.id,
        oldVehicle,
        { ...vehicle, is_public: isPublic, isPublic },
        vehicle.uploaded_by || undefined,
        {
          reason: `Vehicle visibility changed to ${isPublic ? 'public' : 'private'}`,
          source: 'manual_edit'
        }
      );
    } catch (error) {
      console.error('Error updating privacy:', error);
    }
  };

  // Record view (fire-and-forget)
  const recordView = useCallback(async () => {
    if (!vehicleId) return;
    try {
      await supabase.from('vehicle_views').insert({ vehicle_id: vehicleId, user_id: session?.user?.id || null, viewed_at: new Date().toISOString() });
    } catch { /* silent */ }
  }, [vehicleId, session?.user?.id]);

  // Granular validation popup state
  const [validationPopup, setValidationPopup] = useState<{
    open: boolean;
    fieldName: string;
    fieldValue: string;
  }>({
    open: false,
    fieldName: '',
    fieldValue: ''
  });

  const handleDataPointClick = (event: React.MouseEvent, dataType: string, dataValue: string, label: string) => {
    event.preventDefault();
    // Show granular validation popup
    setValidationPopup({
      open: true,
      fieldName: dataType,
      fieldValue: dataValue
    });
  };

  const handleEditClick = () => ctx.reloadVehicle();

  // loadLinkedOrgs handled by VehicleProfileContext

  const handleSetPrimaryImage = async (imageId: string) => {
    if (!vehicle || !isAdmin) {
      return; // Admin privileges required
    }

    try {
      // Clear all primary flags for this vehicle
      await supabase
        .from('vehicle_images')
        .update({ is_primary: false })
        .eq('vehicle_id', vehicle.id);

      // Set the selected image as primary
      const { error: updateError } = await supabase
        .from('vehicle_images')
        .update({ is_primary: true })
        .eq('id', imageId);

      if (updateError) throw updateError;

      // Also update vehicle's primary_image_url if the image has a URL
      const { data: imageData } = await supabase
        .from('vehicle_images')
        .select('image_url, large_url, medium_url')
        .eq('id', imageId)
        .single();

      if (imageData) {
        const imageUrl = imageData.large_url || imageData.medium_url || imageData.image_url;
        if (imageUrl) {
          await supabase
            .from('vehicles')
            .update({ primary_image_url: imageUrl })
            .eq('id', vehicle.id);
        }
      }

      ctx.reloadImages();
      // Primary image updated
    } catch (error: any) {
      console.error('Error setting primary image:', error);
      // Failed to set primary image
    }
  };

  // Auto-run BaT import once for bat_import vehicles that have no images / broken identity.
  useEffect(() => {
    (async () => {
      try {
        if (!vehicle?.id) return;
        // Context loads vehicle only after auth — if vehicle exists, auth is done.
        if (!session?.user?.id) return;

        const origin = String((vehicle as any)?.profile_origin || '');
        const discoveryUrl = String((vehicle as any)?.discovery_url || '');
        const isBat = origin === 'bat_import' || discoveryUrl.includes('bringatrailer.com/listing/');
        if (!isBat) return;

        // Guard: don't spam imports for the same vehicle.
        const key = `bat_auto_import_attempted_${vehicle.id}`;
        const attempted = typeof window !== 'undefined' ? window.localStorage.getItem(key) : null;
        if (attempted) return;

        const make = String((vehicle as any)?.make || '');
        const model = String((vehicle as any)?.model || '');
        const looksBadIdentity = /mile/i.test(make) || /bring a trailer/i.test(model) || /on\s+bat\s+auctions/i.test(model) || model.length > 80;

        // If we already have images and identity looks fine, do nothing.
        const hasAnyImages = Array.isArray(vehicleImages) && vehicleImages.length > 0;
        if (hasAnyImages && !looksBadIdentity) return;

        // Mark attempted once we are actually going to call the function (prevents anon 401 from poisoning retries).
        window.localStorage.setItem(key, new Date().toISOString());
        setBatAutoImportStatus('running');

        const batUrl =
          discoveryUrl ||
          String((vehicle as any)?.bat_auction_url || '') ||
          String((vehicle as any)?.listing_url || '');
        if (!batUrl.includes('bringatrailer.com/listing/')) {
          setBatAutoImportStatus('failed');
          return;
        }

        const { data, error } = await supabase.functions.invoke('complete-bat-import', {
          body: { bat_url: batUrl, vehicle_id: vehicle.id }
        });

        if (error || !data) {
          console.warn('BaT auto-import failed:', error);
          // Allow retry next time.
          try { window.localStorage.removeItem(key); } catch { /* ignore */ }
          setBatAutoImportStatus('failed');
          return;
        }

        // Refresh vehicle + images + timeline after import
        ctx.reloadVehicle();
        ctx.reloadTimeline();
        ctx.reloadImages();
        setBatAutoImportStatus('done');
      } catch (e) {
        console.warn('BaT auto-import exception:', e);
        // Allow retry next time.
        try {
          if (vehicle?.id) window.localStorage.removeItem(`bat_auto_import_attempted_${vehicle.id}`);
        } catch { /* ignore */ }
        try { setBatAutoImportStatus('failed'); } catch { /* ignore */ }
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vehicle?.id, session?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (ctx.loading) {
    return (
        <div className="loading-container">
          <div className="loading-spinner"></div>
          <p>Loading vehicle...</p>
        </div>
    );
  }

  if (!vehicle) {
    return (
        <div className="card">
          <div className="card-body text-center">
            <h2 className="text font-bold" style={{ marginBottom: '12px' }}>Vehicle Not Found</h2>
            <p className="text-small text-muted" style={{ marginBottom: '16px' }}>
              The requested vehicle could not be found.
            </p>
            <button
              className="button button-primary"
              onClick={() => navigate('/vehicles')}
            >
              View All Vehicles
            </button>
          </div>
        </div>
    );
  }
  
  // readinessScore removed - was computed but never used in render

  // renderWorkspaceContent extracted to WorkspaceContent.tsx

  // Render vehicle profile (responsive for mobile and desktop)
  return (
      <div className="vehicle-profile-page">
        {/* Vehicle Sub-Header with Price — sticky, z-900 per V3 spec */}
        <div ref={vehicleHeaderRef} className="vehicle-profile-sub-header" style={{ position: 'sticky', top: 'var(--header-height, 40px)', zIndex: 900, background: 'var(--surface)', borderBottom: '2px solid var(--border)' }}>
          <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading header...</div>}>
            <VehicleHeader
              onClaimClick={() => setShowOwnershipClaim(true)}
            />
          </React.Suspense>
        </div>

        {/* Vehicle Sub-Header — sticky badge bar */}
        <React.Suspense fallback={null}>
          <VehicleSubHeader />
        </React.Suspense>

        {/* Banners: BaT data flag, live auction, external auction, orphaned vehicle, merge proposals */}
        <React.Suspense fallback={null}>
          <VehicleBanners
            onMergeComplete={() => ctx.reloadVehicle()}
          />
        </React.Suspense>

        {/* Barcode Timeline — sticky, 10px collapsed, expandable to heatmap */}
        <React.Suspense fallback={null}>
          <BarcodeTimeline />
        </React.Suspense>

        {/* Hero Image Section */}
        <div id="vehicle-hero" className="hero" style={{ scrollMarginTop: 'calc(var(--header-height, 40px) + 88px)' }}>
          <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading hero image...</div>}>
            <VehicleHeroImage
              overlayNode={<VehicleMemeOverlay lastEvent={lastMemeDrop} />}
            />
          </React.Suspense>
        </div>

        <React.Suspense fallback={null}><QuickStatsBar /></React.Suspense>

        {/* Add Organization Relationship Modal */}
        {showAddOrgRelationship && vehicle && session?.user?.id && (
          <React.Suspense fallback={null}>
            <AddOrganizationRelationship
              vehicleId={vehicle.id}
              vehicleName={`${vehicle.year} ${vehicle.make} ${vehicle.model}`}
              userId={session.user.id}
              onSuccess={() => {
                ctx.reloadLinkedOrgs();
                setShowAddOrgRelationship(false);
              }}
              onClose={() => setShowAddOrgRelationship(false)}
            />
          </React.Suspense>
        )}

        {/* Workspace tab bar removed — all content renders flat */}

        {/* Main Content */}
        <div style={{ marginTop: '0' }}>
          <React.Suspense fallback={<div style={{ padding: '10px 16px', textAlign: 'center', color: '#888', fontFamily: 'Arial, Helvetica, sans-serif', fontSize: '8px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Loading...</div>}>
            {vehicle ? (
              <WorkspaceContent
                valuationIntel={valuationIntel}
                readinessSnapshot={readinessSnapshot}
                referenceLibraryRefreshKey={referenceLibraryRefreshKey}
                onAddEventClick={() => setShowAddEvent(true)}
                onDataPointClick={handleDataPointClick}
                onEditClick={handleEditClick}
                onUpdatePrivacy={updatePrivacy}
                onSetReferenceLibraryRefreshKey={setReferenceLibraryRefreshKey}
              />
            ) : (
              <div className="card">
                <div className="card-body">
                  Vehicle data is still loading...
                </div>
              </div>
            )}
          </React.Suspense>
        </div>

        {/* Granular Validation Popup */}
        {validationPopup.open && vehicle && (
          <React.Suspense fallback={null}><ValidationPopupV2
            vehicleId={vehicle.id}
            fieldName={validationPopup.fieldName}
            fieldValue={validationPopup.fieldValue}
            vehicleYear={vehicle.year}
            vehicleMake={vehicle.make}
            onClose={() => setValidationPopup(prev => ({ ...prev, open: false }))}
          /></React.Suspense>
        )}

      {/* Add Event Wizard Modal */}
      {showAddEvent && (
        <React.Suspense fallback={null}><AddEventWizard
          vehicleId={vehicle.id}
          onClose={() => {
            setShowAddEvent(false);
            window.dispatchEvent(new CustomEvent('vehicle_images_updated', {
              detail: { vehicleId: vehicle.id }
            }));
          }}
          onEventAdded={() => {
            setShowAddEvent(false);
            window.dispatchEvent(new CustomEvent('vehicle_images_updated', {
              detail: { vehicleId: vehicle.id }
            }));
          }}
          currentUser={session?.user || null}
        /></React.Suspense>
      )}

      {/* Ownership Claim Modal */}
      {showOwnershipClaim && vehicle && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
          }}
          onClick={() => setShowOwnershipClaim(false)}
        >
          <div
            style={{
              backgroundColor: 'var(--surface)',
              borderRadius: '8px',
              maxWidth: '600px',
              width: '100%',
              maxHeight: '90vh',
              overflow: 'auto',
              position: 'relative'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ padding: '16px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '14px', fontWeight: 700 }}>Claim Vehicle Ownership</h3>
              <button
                onClick={() => setShowOwnershipClaim(false)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontSize: '20px',
                  cursor: 'pointer',
                  padding: '0',
                  width: '24px',
                  height: '24px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                ×
              </button>
            </div>
            <div style={{ padding: '16px' }}>
              <React.Suspense fallback={<div style={{ padding: '12px', color: 'var(--text-muted)' }}>Loading...</div>}>
                <VehicleOwnershipPanel
                  vehicle={vehicle}
                  session={session}
                  isOwner={isRowOwner || isVerifiedOwner}
                  hasContributorAccess={hasContributorAccess}
                  contributorRole={permissions.contributorRole ?? undefined}
                />
              </React.Suspense>
            </div>
          </div>
        </div>
      )}
      </div>
  );
};

/** Wraps VehicleProfileInner with the shared context provider. */
const VehicleProfile: React.FC = () => (
  <VehicleProfileProvider>
    <VehicleProfileInner />
  </VehicleProfileProvider>
);

export default VehicleProfile;