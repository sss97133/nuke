import React, { useState, useCallback } from 'react';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';
import { useVehicleProfile } from './VehicleProfileContext';
import { useBuildProfile } from './hooks/useBuildProfile';
import { useBuildStatus } from './hooks/useBuildStatus';

// Lazy-load heavy components
const WorkMemorySection = React.lazy(() => import('./WorkMemorySection'));
const VehicleDossierPanel = React.lazy(() => import('./VehicleDossierPanel'));
const VehicleLedgerDocumentsCard = React.lazy(() => import('../../components/vehicle/VehicleLedgerDocumentsCard').then(m => ({ default: m.VehicleLedgerDocumentsCard })));
// Deal Jacket Forensics removed — no pipeline exists yet, re-add when data available
import WiringQueryContextBar from '../../components/wiring/WiringQueryContextBar';
const PartsQuoteGenerator = React.lazy(() => import('../../components/PartsQuoteGenerator').then(m => ({ default: m.PartsQuoteGenerator })));
const VehicleROISummaryCard = React.lazy(() => import('../../components/vehicle/VehicleROISummaryCard'));
const NukeEstimatePanel = React.lazy(() => import('../../components/vehicle/NukeEstimatePanel'));
const BuyerQuestionPreview = React.lazy(() => import('../../components/vehicle/BuyerQuestionPreview'));
const VehiclePricingValueCard = React.lazy(() => import('../../components/vehicle/VehiclePricingValueCard').then(m => ({ default: m.VehiclePricingValueCard })));
const ExternalListingCard = React.lazy(() => import('../../components/vehicle/ExternalListingCard'));
const VehicleReferenceLibrary = React.lazy(() => import('../../components/vehicle/VehicleReferenceLibrary'));
const VehicleDescriptionCard = React.lazy(() => import('../../components/vehicle/VehicleDescriptionCard'));
const VehicleCommentsCard = React.lazy(() => import('../../components/vehicle/VehicleCommentsCard').then(m => ({ default: m.VehicleCommentsCard })));
const BundleReviewQueue = React.lazy(() => import('../../components/images/BundleReviewQueue'));
const ImageGallery = React.lazy(() => import('../../components/images/ImageGallery'));
const VehicleVideoSection = React.lazy(() => import('../../components/vehicle/VehicleVideoSection'));
const AnalysisSignalsSection = React.lazy(() => import('./AnalysisSignalsSection'));
const VehicleIntelligencePanel = React.lazy(() => import('./VehicleIntelligencePanel'));
const VehicleScoresWidget = React.lazy(() => import('./VehicleScoresWidget'));
const AuctionReadinessPanel = React.lazy(() => import('./AuctionReadinessPanel'));
const ColumnDivider = React.lazy(() => import('./ColumnDivider'));
const BuildManifestPanel = React.lazy(() => import('./BuildManifestPanel'));
const BuildTimelineChart = React.lazy(() => import('./BuildTimelineChart'));
const BuildSpendSummary = React.lazy(() => import('./BuildSpendSummary'));
const VehicleListingDetailsCard = React.lazy(() => import('../../components/vehicle/VehicleListingDetailsCard'));
const SimilarSalesSection = React.lazy(() => import('../../components/vehicle/SimilarSalesSection').then(m => ({ default: m.SimilarSalesSection })));
const ObservationTimeline = React.lazy(() => import('./ObservationTimeline'));
const OwnerIdentityCard = React.lazy(() => import('./OwnerIdentityCard'));
const BuildStatusPanel = React.lazy(() => import('./BuildStatusPanel'));
// BuildLog removed — work sessions now surface via BarcodeTimeline Day Card popups
const GenerateBill = React.lazy(() => import('./GenerateBill'));
const WorkOrderProgress = React.lazy(() => import('./WorkOrderProgress'));

const fmt = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });

export type GalleryViewMode = 'ZONES' | 'GRID' | 'FULL' | 'INFO' | 'SESSIONS' | 'CATEGORY' | 'CHRONO' | 'SOURCE';

// Streamlined image gallery — no wrapper chrome
const ProfileGallery: React.FC<{
  vehicleId: string;
  vehicleImages: string[];
  fallbackListingImageUrls: string[];
  leadImageUrl?: string | null;
  vehicle: any;
  onImagesUpdated: () => void;
  galleryView?: GalleryViewMode;
  galleryFilter?: import('./VehicleProfileContext').GalleryFilter | null;
}> = ({ vehicleId, vehicleImages, fallbackListingImageUrls, leadImageUrl, vehicle, onImagesUpdated, galleryView = 'GRID', galleryFilter }) => {
  // Build fallback chain: context images → listing images → hero URL → primary_image_url
  let fallback = vehicleImages.length > 0 ? vehicleImages : fallbackListingImageUrls;
  if (fallback.length === 0 && leadImageUrl) {
    fallback = [leadImageUrl];
  }
  if (fallback.length === 0 && vehicle?.primary_image_url) {
    fallback = [vehicle.primary_image_url];
  }
  return (
  <React.Suspense fallback={null}>
    <ImageGallery
      vehicleId={vehicleId}
      showUpload={false}
      fallbackImageUrls={fallback}
      fallbackLabel="Listing"
      fallbackSourceUrl={vehicle?.discovery_url || vehicle?.bat_auction_url || vehicle?.listing_url || undefined}
      onImagesUpdated={onImagesUpdated}
      galleryView={galleryView}
      galleryFilter={galleryFilter}
    />
  </React.Suspense>
  );
};

// WorkspaceTabBar was removed — all sections render flat in left column.
// Keep the type alias so WorkspaceContentProps still compiles.
export type WorkspaceTabId = 'evidence' | 'gallery' | 'owner';

/** Props that can't come from context (callbacks into VehicleProfile modals, non-context data). */
export interface WorkspaceContentProps {
  valuationIntel: any;
  readinessSnapshot: any;
  referenceLibraryRefreshKey: number;
  onAddEventClick: () => void;
  onDataPointClick: (event: React.MouseEvent, dataType: string, dataValue: string, label: string) => void;
  onEditClick: () => void;
  onOpenVINProofImages?: () => void;
  onUpdatePrivacy: () => void;
  onSetReferenceLibraryRefreshKey: (fn: (v: number) => number) => void;
}

const DEFAULT_LEFT_PCT = 38;

const WorkspaceContent: React.FC<WorkspaceContentProps> = ({
  valuationIntel,
  readinessSnapshot,
  referenceLibraryRefreshKey,
  onAddEventClick,
  onDataPointClick,
  onEditClick,
  onOpenVINProofImages,
  onUpdatePrivacy,
  onSetReferenceLibraryRefreshKey,
}) => {
  // All data comes from context — no more prop drilling
  const {
    vehicle,
    session,
    permissions,
    isRowOwner,
    isVerifiedOwner,
    hasContributorAccess,
    canEdit,
    vehicleImages,
    fallbackListingImageUrls,
    leadImageUrl,
    totalCommentCount,
    observationCount,
    isPublic,
    auctionPulse,
    galleryFilter,
    setGalleryFilter,
    reloadVehicle,
    reloadImages,
    reloadTimeline,
    setIsPublic,
  } = useVehicleProfile();
  const [galleryCols, setGalleryCols] = useState(3);
  const [leftPct, setLeftPct] = useState(DEFAULT_LEFT_PCT);
  const [galleryView, setGalleryView] = useState<GalleryViewMode>('GRID');
  const { manifestByCategory, manifestStats, snapshots, spendProfile, loading: buildLoading } = useBuildProfile(vehicle?.id);
  const { data: buildStatus } = useBuildStatus(vehicle?.id);

  const handleResize = useCallback((pct: number) => setLeftPct(pct), []);
  const handleReset = useCallback(() => setLeftPct(DEFAULT_LEFT_PCT), []);

  if (!vehicle) return null;

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
    <div>
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

          {/* Vehicle Dossier — provenance-rich field panel */}
          <React.Suspense fallback={null}>
            <VehicleDossierPanel />
          </React.Suspense>

          {/* Analysis Signals — computed alerts from analysis engine */}
          <React.Suspense fallback={null}>
            <AnalysisSignalsSection vehicleId={vehicle.id} />
          </React.Suspense>

          {/* Intelligence — community + description + apparitions */}
          <React.Suspense fallback={null}>
            <VehicleIntelligencePanel />
          </React.Suspense>

          {/* Owner Identity — the throne */}
          {buildStatus?.dealJacket?.contact && (
            <React.Suspense fallback={null}>
              <OwnerIdentityCard
                dealJacket={buildStatus.dealJacket}
                isOwnerView={isRowOwner || isVerifiedOwner || hasContributorAccess}
              />
            </React.Suspense>
          )}

          {/* Description */}
          <VehicleDescriptionCard
            vehicleId={vehicle.id}
            initialDescription={vehicle.description}
            isEditable={canEdit}
            onUpdate={() => {}}
          />

          {/* Comments & Bids — right after description for natural reading flow */}
          {totalCommentCount > 0 && (
            <CollapsibleWidget variant="profile" title="Comments & Bids" defaultCollapsed={false}
              badge={<span className="widget__count">{totalCommentCount}</span>}
            >
              <React.Suspense fallback={null}>
                <VehicleCommentsCard vehicleId={vehicle.id} session={session} collapsed={false} />
              </React.Suspense>
            </CollapsibleWidget>
          )}

          {/* Buyer Questions — what buyers will ask about this vehicle */}
          <React.Suspense fallback={null}>
            <CollapsibleWidget variant="profile" title="Buyer Questions" defaultCollapsed={true}>
              <BuyerQuestionPreview vehicleId={vehicle.id} make={vehicle.make} />
            </CollapsibleWidget>
          </React.Suspense>

          {/* Listing Details — highlights, equipment, modifications, flaws, service history */}
          <React.Suspense fallback={null}>
            <VehicleListingDetailsCard vehicle={vehicle} />
          </React.Suspense>

          {/* Comparable Sales */}
          {vehicle.year && vehicle.make && vehicle.model && (
            <CollapsibleWidget variant="profile" title="Comparable Sales" defaultCollapsed={true}>
              <React.Suspense fallback={null}>
                <SimilarSalesSection
                  vehicleId={vehicle.id}
                  vehicleYear={vehicle.year}
                  vehicleMake={vehicle.make}
                  vehicleModel={vehicle.model}
                />
              </React.Suspense>
            </CollapsibleWidget>
          )}

          {/* Observation History — all observations for this vehicle, chronological */}
          {observationCount > 0 && (
            <CollapsibleWidget variant="profile" title="Observation History" defaultCollapsed={true}>
              <React.Suspense fallback={null}>
                <ObservationTimeline />
              </React.Suspense>
            </CollapsibleWidget>
          )}

          {/* Pricing & Value — self-guarding: returns null when no price data */}
          <VehiclePricingValueCard
            vehicle={vehicle}
            auctionPulse={auctionPulse}
            valuationIntel={valuationIntel as any}
            readinessSnapshot={readinessSnapshot as any}
          />

          {/* Build Intelligence — owner/contributor only */}
          {(isRowOwner || isVerifiedOwner || hasContributorAccess) && !buildLoading && manifestStats.total > 0 && (
            <>
              <CollapsibleWidget variant="profile" title="Build Manifest" defaultCollapsed={true}
                badge={<span className="widget__count">{manifestStats.purchased}/{manifestStats.total}</span>}
              >
                <React.Suspense fallback={null}>
                  {spendProfile && <BuildSpendSummary spendProfile={spendProfile} manifestStats={manifestStats} />}
                  <div style={{ marginTop: '8px' }}>
                    <BuildManifestPanel manifestByCategory={manifestByCategory} manifestStats={manifestStats} />
                  </div>
                </React.Suspense>
              </CollapsibleWidget>
              {snapshots.length > 0 && (
                <CollapsibleWidget variant="profile" title="Build Timeline" defaultCollapsed={true}
                  badge={<span className="widget__count">{snapshots.length} MONTHS</span>}
                >
                  <React.Suspense fallback={null}>
                    <BuildTimelineChart snapshots={snapshots} />
                  </React.Suspense>
                </CollapsibleWidget>
              )}
            </>
          )}

          {/* Build Status — work order accounting + invoice generation */}
          {buildStatus?.hasData && buildStatus.workOrders.length > 0 && (
            <CollapsibleWidget variant="profile" title="Build Status" defaultCollapsed={false}
              badge={
                <span className="widget__count" style={{
                  color: buildStatus.totals.balance > 0 ? 'var(--vp-martini-red)' : 'var(--vp-brg)',
                }}>
                  {buildStatus.totals.balance > 0 ? fmt(buildStatus.totals.balance) + ' DUE' : 'PAID'}
                </span>
              }
            >
              <React.Suspense fallback={null}>
                <BuildStatusPanel
                  workOrders={buildStatus.workOrders}
                  totals={buildStatus.totals}
                  isOwnerView={isRowOwner || isVerifiedOwner || hasContributorAccess}
                />
              </React.Suspense>
              {/* Work Order Sign-off — line item checklist (owner view) */}
              {(isRowOwner || isVerifiedOwner || hasContributorAccess) && (
                <React.Suspense fallback={null}>
                  <WorkOrderProgress vehicleId={vehicle.id} isOwnerView={isRowOwner || isVerifiedOwner || hasContributorAccess} />
                </React.Suspense>
              )}
              {/* Generate Bill — same data, document render. The bill is a button. */}
              {(isRowOwner || isVerifiedOwner || hasContributorAccess) && buildStatus.totals.orderCount > 0 && (
                <React.Suspense fallback={null}>
                  <GenerateBill
                    vehicleId={vehicle.id}
                    workOrders={buildStatus.workOrders}
                    totals={buildStatus.totals}
                    contact={buildStatus.dealJacket?.contact}
                    vehicle={vehicle}
                    isOwnerView={isRowOwner || isVerifiedOwner || hasContributorAccess}
                  />
                </React.Suspense>
              )}
            </CollapsibleWidget>
          )}

          {/* Build Log removed — work sessions now surface through BarcodeTimeline.
               Click a day on the timeline to open a Day Card popup with full-resolution detail.
               Build Status panel (above) shows work order accounting + Generate Bill. */}

          {/* Engine Bay Analysis */}
          {(vehicle as any)?.origin_metadata?.engine_bay_analysis?.engine_family && (
            <CollapsibleWidget variant="profile" title="Engine Bay Analysis" defaultCollapsed={true}
              badge={<span className="widget__count" style={{ cursor: 'pointer' }} onClick={(e) => { e.stopPropagation(); setGalleryFilter({ zone: 'engine_bay' }); }}>{(vehicle as any).origin_metadata.engine_bay_analysis.engine_family}</span>}
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

          {/* ROI Summary — self-guarding: returns null when no data */}
          <VehicleROISummaryCard vehicleId={vehicle.id} />

          {/* Nuke Estimate — self-guarding: returns null when no estimate + not owner */}
          <React.Suspense fallback={null}>
            <NukeEstimatePanel vehicleId={vehicle.id} vehicle={{ year: vehicle.year, make: vehicle.make, model: vehicle.model }} canCompute={isRowOwner || isVerifiedOwner || hasContributorAccess} />
          </React.Suspense>

          {/* Auction History — ExternalListingCard self-guards: returns null when no listings */}
          <React.Suspense fallback={null}>
            <ExternalListingCard vehicleId={vehicle.id} />
          </React.Suspense>

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

          {/* Reference Library — component handles its own CollapsibleWidget + null guard */}
          <React.Suspense fallback={null}>
            <VehicleReferenceLibrary vehicleId={vehicle.id} userId={session?.user?.id} year={vehicle.year} make={vehicle.make} series={(vehicle as any).series} model={vehicle.model} bodyStyle={(vehicle as any).body_style} refreshKey={referenceLibraryRefreshKey} onUploadComplete={() => { reloadVehicle(); onSetReferenceLibraryRefreshKey((v) => v + 1); }} />
          </React.Suspense>

          {/* Data Sources — only render if sources exist */}
          {dataSources.length > 0 && (
            <CollapsibleWidget variant="profile" title="Data Sources" defaultCollapsed={true}
              badge={<span className="widget__count">{dataSources.length}</span>}
            >
              <div>
                {(importMeta.builder || importMeta.seller) && (
                  <div style={{ fontSize: '8px', color: 'var(--vp-pencil)', marginBottom: '8px' }}>
                    {importMeta.builder ? `Builder: ${importMeta.builder}` : null}
                    {importMeta.builder && importMeta.seller ? ' · ' : null}
                    {importMeta.seller ? `Seller: ${importMeta.seller}` : null}
                  </div>
                )}
                <ul style={{ margin: '0', paddingLeft: '18px', fontSize: '9px' }}>
                  {dataSources.map((url) => (
                    <li key={url}><a href={url} target="_blank" rel="noreferrer">{sourceLabel(url)}</a></li>
                  ))}
                </ul>
              </div>
            </CollapsibleWidget>
          )}

          {!vehicle.isAnonymous && session && (
            <CollapsibleWidget variant="profile" title="Privacy Settings" defaultCollapsed={true}
              badge={<span className="widget__count">{isPublic ? 'PUBLIC' : 'PRIVATE'}</span>}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px' }}>
                <span style={{ color: 'var(--vp-pencil)', textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '8px' }}>Visibility</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span>{isPublic ? 'Public' : 'Private'}</span>
                  <label style={{ display: 'flex', alignItems: 'center' }}>
                    <input type="checkbox" checked={isPublic} onChange={(e) => { setIsPublic(e.target.checked); onUpdatePrivacy(); }} />
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
              <BundleReviewQueue vehicleId={vehicle.id} onComplete={() => reloadTimeline()} />
            </React.Suspense>
          )}

          {/* Active gallery filter chip */}
          {galleryFilter && (
            <div className="gallery-filter-chip">
              <span style={{ color: 'var(--text-secondary)' }}>FILTER:</span>
              <span>{galleryFilter.zone || galleryFilter.category || galleryFilter.tag || 'Custom'}</span>
              <a onClick={() => setGalleryFilter(null)} style={{
                cursor: 'pointer', color: 'var(--text-disabled)', marginLeft: 'auto',
              }}>&times; CLEAR</a>
            </div>
          )}

          {/* Gallery toolbar */}
          <div className="widget__header gallery-header" style={{ flexShrink: 0, flexWrap: 'wrap' }}>
            <div className="widget__header-left">
              <span className="widget__label">Images</span>
              <span className="widget__count">{vehicleImages.length || '—'}</span>
            </div>
            <div className="widget__controls" style={{ flexWrap: 'wrap', gap: '4px' }}>
              <div className="gallery-toolbar">
                {(['ZONES', 'GRID', 'FULL', 'INFO', 'SESSIONS', 'CATEGORY', 'CHRONO', 'SOURCE'] as const).map((view) => (
                  <button
                    key={view}
                    type="button"
                    className={`gallery-btn ${view === galleryView ? 'gallery-btn--active' : ''}`}
                    onClick={() => {
                      setGalleryView(view);
                      if (galleryFilter) setGalleryFilter(null);
                    }}
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
            leadImageUrl={leadImageUrl}
            vehicle={vehicle}
            onImagesUpdated={() => { reloadVehicle(); reloadTimeline(); reloadImages(); }}
            galleryView={galleryView}
            galleryFilter={galleryFilter}
          />

          {/* Vehicle Scores */}
          <React.Suspense fallback={null}>
            <VehicleScoresWidget />
          </React.Suspense>

          {/* Auction Readiness */}
          <React.Suspense fallback={null}>
            <AuctionReadinessPanel />
          </React.Suspense>

          {/* Videos — VehicleVideoSection self-guards: returns null when no videos */}
          <React.Suspense fallback={null}>
            <VehicleVideoSection vehicleId={vehicle.id} defaultCollapsed={false} />
          </React.Suspense>
        </div>
      </div>
    </div>
  );
};

export default WorkspaceContent;
