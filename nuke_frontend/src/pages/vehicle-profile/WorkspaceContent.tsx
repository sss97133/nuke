import React, { useState, useCallback } from 'react';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';
import type { Vehicle, VehiclePermissions, LiveSession } from './types';

// Lazy-load heavy components
const VehicleTimelineSection = React.lazy(() => import('./VehicleTimelineSection'));
const WorkMemorySection = React.lazy(() => import('./WorkMemorySection'));
const VehicleBasicInfo = React.lazy(() => import('./VehicleBasicInfo'));
const VehicleLedgerDocumentsCard = React.lazy(() => import('../../components/vehicle/VehicleLedgerDocumentsCard').then(m => ({ default: m.VehicleLedgerDocumentsCard })));
const VehicleDealJacketForensicsCard = React.lazy(() => import('../../components/vehicle/VehicleDealJacketForensicsCard'));
import WiringQueryContextBar from '../../components/wiring/WiringQueryContextBar';
const PartsQuoteGenerator = React.lazy(() => import('../../components/PartsQuoteGenerator').then(m => ({ default: m.PartsQuoteGenerator })));
const VehicleROISummaryCard = React.lazy(() => import('../../components/vehicle/VehicleROISummaryCard'));
const NukeEstimatePanel = React.lazy(() => import('../../components/vehicle/NukeEstimatePanel'));
const VehiclePricingValueCard = React.lazy(() => import('../../components/vehicle/VehiclePricingValueCard').then(m => ({ default: m.VehiclePricingValueCard })));
const ExternalListingCard = React.lazy(() => import('../../components/vehicle/ExternalListingCard'));
const VehicleReferenceLibrary = React.lazy(() => import('../../components/vehicle/VehicleReferenceLibrary'));
const VehicleDescriptionCard = React.lazy(() => import('../../components/vehicle/VehicleDescriptionCard'));
const VehicleCommentsSection = React.lazy(() => import('./VehicleCommentsSection'));
const BundleReviewQueue = React.lazy(() => import('../../components/images/BundleReviewQueue'));
const ImageGallery = React.lazy(() => import('../../components/images/ImageGallery'));
const VehicleVideoSection = React.lazy(() => import('../../components/vehicle/VehicleVideoSection'));
const VehicleScoresWidget = React.lazy(() => import('./VehicleScoresWidget'));
const ColumnDivider = React.lazy(() => import('./ColumnDivider'));

// Streamlined image gallery — no wrapper chrome
const ProfileGallery: React.FC<{
  vehicleId: string;
  vehicleImages: string[];
  fallbackListingImageUrls: string[];
  vehicle: any;
  onImagesUpdated: () => void;
}> = ({ vehicleId, vehicleImages, fallbackListingImageUrls, vehicle, onImagesUpdated }) => (
  <React.Suspense fallback={<div className="widget__label" style={{ padding: '10px 16px' }}>Loading gallery...</div>}>
    <ImageGallery
      vehicleId={vehicleId}
      showUpload={false}
      fallbackImageUrls={vehicleImages.length > 0 ? [] : fallbackListingImageUrls}
      fallbackLabel="Listing"
      fallbackSourceUrl={vehicle?.discovery_url || vehicle?.bat_auction_url || vehicle?.listing_url || undefined}
      onImagesUpdated={onImagesUpdated}
    />
  </React.Suspense>
);

// WorkspaceTabBar was removed — all sections render flat in left column.
// Keep the type alias so WorkspaceContentProps still compiles.
export type WorkspaceTabId = 'evidence' | 'gallery' | 'owner';

export interface WorkspaceContentProps {
  vehicle: Vehicle;
  session: any;
  permissions: VehiclePermissions;
  activeWorkspaceTab?: WorkspaceTabId;
  isMobile: boolean;
  isRowOwner: boolean;
  isVerifiedOwner: boolean;
  hasContributorAccess: boolean;
  canEdit: boolean;
  isAdminUser: boolean;
  canTriggerProofAnalysis: boolean;
  timelineEvents: any[];
  vehicleImages: string[];
  fallbackListingImageUrls: string[];
  totalCommentCount: number;
  isPublic: boolean;
  vehicleHeaderHeight: number;
  liveSession: LiveSession | null;
  referenceLibraryRefreshKey: number;
  auctionPulse: any;
  valuationIntel: any;
  readinessSnapshot: any;
  onAddEventClick: () => void;
  onDataPointClick: (event: React.MouseEvent, dataType: string, dataValue: string, label: string) => void;
  onEditClick: () => void;
  onLoadLiveSession: () => void;
  onLoadVehicle: () => void;
  onLoadTimelineEvents: () => void;
  onLoadVehicleImages: () => void;
  onUpdatePrivacy: () => void;
  onSetIsPublic: (value: boolean) => void;
  onSetReferenceLibraryRefreshKey: (fn: (v: number) => number) => void;
}

const DEFAULT_LEFT_PCT = 30;

const WorkspaceContent: React.FC<WorkspaceContentProps> = ({
  vehicle,
  session,
  permissions,
  isMobile,
  isRowOwner,
  isVerifiedOwner,
  hasContributorAccess,
  canEdit,
  timelineEvents,
  vehicleImages,
  fallbackListingImageUrls,
  totalCommentCount,
  isPublic,
  vehicleHeaderHeight,
  liveSession,
  referenceLibraryRefreshKey,
  auctionPulse,
  valuationIntel,
  readinessSnapshot,
  onAddEventClick,
  onDataPointClick,
  onEditClick,
  onLoadVehicle,
  onLoadTimelineEvents,
  onLoadVehicleImages,
  onUpdatePrivacy,
  onSetIsPublic,
  onSetReferenceLibraryRefreshKey,
}) => {
  const [galleryCols, setGalleryCols] = useState(3);
  const [leftPct, setLeftPct] = useState(DEFAULT_LEFT_PCT);

  const handleResize = useCallback((pct: number) => setLeftPct(pct), []);
  const handleReset = useCallback(() => setLeftPct(DEFAULT_LEFT_PCT), []);

  const importMeta = (vehicle as any)?.import_metadata || {};
  const evidenceUrls = Array.isArray(importMeta.evidence_urls) ? importMeta.evidence_urls : [];
  const rawSources = [
    importMeta.listing_url,
    (vehicle as any)?.discovery_url,
    (vehicle as any)?.platform_url,
    (vehicle as any)?.bat_auction_url,
    ...(evidenceUrls || [])
  ];
  const dataSources = Array.from(
    new Set(
      rawSources
        .map((u) => String(u || '').trim())
        .filter((u) => u.startsWith('http'))
    )
  );
  const sourceLabel = (url: string) => {
    try {
      const parsed = new URL(url);
      const path = parsed.pathname && parsed.pathname !== '/' ? parsed.pathname : '';
      return `${parsed.hostname}${path}`;
    } catch {
      return url;
    }
  };

  // Use CSS variables for sticky positioning
  const paneHeight = `calc(100vh - var(--vp-sticky-top))`;

  return (
    <div style={{ paddingBottom: paneHeight }}>
      <div
        className="vp-columns"
        style={{
          position: 'sticky',
          top: 'var(--vp-sticky-top)',
          height: paneHeight,
        }}
      >
        {/* LEFT COLUMN */}
        <div
          className="vp-col-left vehicle-profile-left-column"
          style={{ width: `${leftPct}%` }}
        >
          {/* Work Memory */}
          {(isRowOwner || isVerifiedOwner || hasContributorAccess) && (
            <React.Suspense fallback={null}>
              <WorkMemorySection vehicleId={vehicle.id} permissions={permissions} />
            </React.Suspense>
          )}

          {/* Vehicle Information */}
          <React.Suspense fallback={<div className="widget__label" style={{ padding: '10px 16px' }}>Loading...</div>}>
            <VehicleBasicInfo
              vehicle={vehicle}
              session={session}
              permissions={permissions}
              onDataPointClick={onDataPointClick}
              onEditClick={onEditClick}
            />
          </React.Suspense>

          {/* Description */}
          <VehicleDescriptionCard
            vehicleId={vehicle.id}
            initialDescription={vehicle.description}
            isEditable={canEdit}
            onUpdate={() => {}}
          />

          {/* Pricing & Value */}
          <VehiclePricingValueCard
            vehicle={vehicle}
            auctionPulse={auctionPulse}
            valuationIntel={valuationIntel as any}
            readinessSnapshot={readinessSnapshot as any}
          />

          {/* Timeline — hide when no events */}
          {timelineEvents.length > 0 && (
            <CollapsibleWidget variant="profile" title="Timeline" defaultCollapsed={false}
              badge={<span className="widget__count">{timelineEvents.length}</span>}
            >
              <VehicleTimelineSection vehicle={vehicle} session={session} permissions={permissions} onAddEventClick={onAddEventClick} />
            </CollapsibleWidget>
          )}

          {/* Engine Bay Analysis */}
          {(vehicle as any)?.origin_metadata?.engine_bay_analysis?.engine_family && (
            <CollapsibleWidget variant="profile" title="Engine Bay Analysis" defaultCollapsed={true}
              badge={<span className="widget__count">{(vehicle as any).origin_metadata.engine_bay_analysis.engine_family}</span>}
            >
              {(() => {
                const eba = (vehicle as any).origin_metadata.engine_bay_analysis;
                const confPct = eba.engine_family_confidence != null ? Math.round(eba.engine_family_confidence * 100) : null;
                return (
                  <div style={{ fontFamily: 'var(--vp-font-sans)', fontSize: '9px', lineHeight: '1.6' }}>
                    <div style={{ fontWeight: 700, fontSize: '9px', marginBottom: '4px' }}>
                      {eba.engine_family}{eba.estimated_displacement ? ` ${eba.estimated_displacement}` : ''}
                      {confPct != null && (
                        <span style={{ marginLeft: '8px', padding: '2px 6px', fontFamily: 'var(--vp-font-mono)', fontSize: '8px', fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase' as const,
                          border: '1px solid var(--vp-ink)',
                          color: confPct >= 80 ? 'var(--vp-brg)' : confPct >= 50 ? 'var(--vp-gulf-orange)' : 'var(--vp-martini-red)',
                        }}>{confPct}%</span>
                      )}
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px', fontSize: '8px' }}>
                      {eba.fuel_system_type && (<><span style={{ color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Fuel System</span><span>{eba.fuel_system_brand && eba.fuel_system_brand !== 'unknown' ? `${eba.fuel_system_brand} ` : ''}{eba.fuel_system_type.replace(/_/g, ' ')}</span></>)}
                      {eba.ignition_type && (<><span style={{ color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Ignition</span><span>{eba.ignition_brand && eba.ignition_brand !== 'unknown' ? `${eba.ignition_brand.replace(/_/g, ' ')} ` : ''}{eba.ignition_type.replace(/_/g, ' ')}</span></>)}
                      {eba.headers && eba.headers !== 'unknown' && (<><span style={{ color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Exhaust</span><span>{eba.headers.replace(/_/g, ' ')}</span></>)}
                      {eba.condition && eba.condition !== 'unknown' && (<><span style={{ color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Condition</span><span>{eba.condition.replace(/_/g, ' ')}</span></>)}
                      {eba.modifications?.length > 0 && (<><span style={{ color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Modifications</span><span>{eba.modifications.length} identified</span></>)}
                    </div>
                  </div>
                );
              })()}
            </CollapsibleWidget>
          )}

          {/* Detail sections */}
          <CollapsibleWidget variant="profile" title="Deal Jacket Forensics" defaultCollapsed={true}>
            <VehicleDealJacketForensicsCard vehicleId={vehicle.id} />
          </CollapsibleWidget>
          <VehicleROISummaryCard vehicleId={vehicle.id} />
          <CollapsibleWidget variant="profile" title="Nuke Estimate" defaultCollapsed={true}>
            <NukeEstimatePanel vehicleId={vehicle.id} vehicle={{ year: vehicle.year, make: vehicle.make, model: vehicle.model }} />
          </CollapsibleWidget>
          <CollapsibleWidget variant="profile" title="Auction History" defaultCollapsed={true}>
            <ExternalListingCard vehicleId={vehicle.id} />
          </CollapsibleWidget>

          {/* Comments & Bids — hide when empty */}
          {totalCommentCount > 0 && (
            <CollapsibleWidget variant="profile" title="Comments & Bids" defaultCollapsed={false}
              badge={<span className="widget__count">{totalCommentCount}</span>}
            >
              <React.Suspense fallback={null}>
                <VehicleCommentsSection vehicleId={vehicle.id} />
              </React.Suspense>
            </CollapsibleWidget>
          )}

          {/* Owner-only tools */}
          {(isRowOwner || isVerifiedOwner) && (
            <>
              <CollapsibleWidget variant="profile" title="Wiring Harness" defaultCollapsed={true}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  <a
                    href={`/vehicle/${vehicle.id}/wiring`}
                    className="button-win95"
                    style={{ display: 'inline-block', textAlign: 'center', fontWeight: 700, textDecoration: 'none', color: 'inherit' }}
                  >
                    OPEN HARNESS BUILDER
                  </a>
                  <WiringQueryContextBar vehicleId={vehicle.id} vehicleInfo={{ year: vehicle.year, make: vehicle.make, model: vehicle.model }} onQuoteGenerated={() => {}} />
                </div>
              </CollapsibleWidget>
              <CollapsibleWidget variant="profile" title="AI Parts Quote Generator" defaultCollapsed={true}>
                <PartsQuoteGenerator vehicleId={vehicle.id} vehicleInfo={{ year: vehicle.year, make: vehicle.make, model: vehicle.model }} />
              </CollapsibleWidget>
            </>
          )}
          {(isVerifiedOwner || hasContributorAccess) && (
            <CollapsibleWidget variant="profile" title="Ledger Documents" defaultCollapsed={true}>
              <VehicleLedgerDocumentsCard vehicleId={vehicle.id} canManage={Boolean(isVerifiedOwner || hasContributorAccess)} />
            </CollapsibleWidget>
          )}
          <CollapsibleWidget variant="profile" title="Reference Library" defaultCollapsed={true}>
            <VehicleReferenceLibrary vehicleId={vehicle.id} userId={session?.user?.id} year={vehicle.year} make={vehicle.make} series={(vehicle as any).series} model={vehicle.model} bodyStyle={(vehicle as any).body_style} refreshKey={referenceLibraryRefreshKey} onUploadComplete={() => { onLoadVehicle(); onSetReferenceLibraryRefreshKey((v) => v + 1); }} />
          </CollapsibleWidget>
          <CollapsibleWidget variant="profile" title="Data Sources" defaultCollapsed={true}
            badge={dataSources.length > 0 ? <span className="widget__count">{dataSources.length}</span> : undefined}
          >
            <div>
              {(importMeta.builder || importMeta.seller) && (
                <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', marginBottom: '8px' }}>
                  {importMeta.builder ? `Builder: ${importMeta.builder}` : null}
                  {importMeta.builder && importMeta.seller ? ' · ' : null}
                  {importMeta.seller ? `Seller: ${importMeta.seller}` : null}
                </div>
              )}
              {dataSources.length === 0 ? (
                <div style={{ fontSize: '9px', color: 'var(--vp-pencil)' }}>No external sources attached yet.</div>
              ) : (
                <ul style={{ margin: '0', paddingLeft: '18px', fontSize: '9px' }}>
                  {dataSources.map((url) => (
                    <li key={url}><a href={url} target="_blank" rel="noreferrer">{sourceLabel(url)}</a></li>
                  ))}
                </ul>
              )}
            </div>
          </CollapsibleWidget>
          {!vehicle.isAnonymous && session && (
            <CollapsibleWidget variant="profile" title="Privacy Settings" defaultCollapsed={true}
              badge={<span className="widget__count">{isPublic ? 'PUBLIC' : 'PRIVATE'}</span>}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px' }}>
                <span style={{ color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '8px' }}>Visibility</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>{isPublic ? 'Public' : 'Private'}</span>
                  <label style={{ display: 'flex', alignItems: 'center' }}>
                    <input type="checkbox" checked={isPublic} onChange={(e) => { onSetIsPublic(e.target.checked); onUpdatePrivacy(); }} />
                  </label>
                </div>
              </div>
            </CollapsibleWidget>
          )}
        </div>

        {/* COLUMN DIVIDER */}
        <React.Suspense fallback={<div style={{ width: '4px', flexShrink: 0 }} />}>
          <ColumnDivider onResize={handleResize} onReset={handleReset} />
        </React.Suspense>

        {/* RIGHT COLUMN */}
        <div
          className="vp-col-right vehicle-profile-right-column"
          style={{
            width: `${100 - leftPct}%`,
            ['--vp-gallery-cols' as any]: galleryCols,
          }}
        >
          {/* Session Review Queue */}
          {session && (
            <React.Suspense fallback={null}>
              <BundleReviewQueue vehicleId={vehicle.id} onComplete={() => onLoadTimelineEvents()} />
            </React.Suspense>
          )}

          {/* Gallery toolbar */}
          <div className="widget__header gallery-header" style={{ position: 'sticky', top: 0, zIndex: 100, background: 'var(--vp-bg)', flexShrink: 0, flexWrap: 'wrap' }}>
            <div className="widget__header-left">
              <span className="widget__label">Images</span>
              <span className="widget__count">{vehicleImages.length || '—'}</span>
            </div>
            <div className="widget__controls" style={{ flexWrap: 'wrap', gap: '4px' }}>
              <div className="gallery-toolbar">
                {['ZONES', 'GRID', 'FULL', 'INFO', 'SESSIONS', 'CATEGORY', 'CHRONO', 'SOURCE'].map((view) => (
                  <button
                    key={view}
                    className={`gallery-btn ${view === 'CATEGORY' ? 'gallery-btn--active' : ''}`}
                  >
                    {view}
                  </button>
                ))}
              </div>
              <div className="gallery-slider-row">
                <span className="gallery-slider-label">COLS</span>
                <input
                  className="gallery-slider"
                  type="range"
                  min={1}
                  max={8}
                  value={galleryCols}
                  onChange={e => setGalleryCols(Number(e.target.value))}
                />
                <span className="gallery-slider-val">{galleryCols}</span>
              </div>
            </div>
          </div>

          {/* Image Gallery */}
          <ProfileGallery
            vehicleId={vehicle.id}
            vehicleImages={vehicleImages}
            fallbackListingImageUrls={fallbackListingImageUrls}
            vehicle={vehicle}
            onImagesUpdated={() => { onLoadVehicle(); onLoadTimelineEvents(); onLoadVehicleImages(); }}
          />

          {/* Vehicle Scores */}
          <React.Suspense fallback={null}>
            <VehicleScoresWidget vehicle={vehicle} />
          </React.Suspense>

          {/* Videos */}
          <CollapsibleWidget variant="profile" title="Videos" defaultCollapsed={true}>
            <VehicleVideoSection vehicleId={vehicle.id} defaultCollapsed={false} />
          </CollapsibleWidget>
        </div>
      </div>
    </div>
  );
};

export default WorkspaceContent;
