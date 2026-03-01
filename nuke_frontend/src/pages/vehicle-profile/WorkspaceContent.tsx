import React, { useState } from 'react';
// supabase import removed (FactExplorerPanel deleted)
import { usePageTitle, getVehicleTitle } from '../../hooks/usePageTitle';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';
import type { Vehicle, VehiclePermissions, LiveSession } from './types';

// Lazy-load heavy tab-specific components
const VehicleTimelineSection = React.lazy(() => import('./VehicleTimelineSection'));
const WorkMemorySection = React.lazy(() => import('./WorkMemorySection'));
const VehicleBasicInfo = React.lazy(() => import('./VehicleBasicInfo'));
const VehicleStreamingCard = React.lazy(() => import('../../components/vehicle/VehicleStreamingCard'));
const VehicleLedgerDocumentsCard = React.lazy(() => import('../../components/vehicle/VehicleLedgerDocumentsCard').then(m => ({ default: m.VehicleLedgerDocumentsCard })));
const VehicleDealJacketForensicsCard = React.lazy(() => import('../../components/vehicle/VehicleDealJacketForensicsCard'));
import WiringQueryContextBar from '../../components/wiring/WiringQueryContextBar';
const PartsQuoteGenerator = React.lazy(() => import('../../components/PartsQuoteGenerator').then(m => ({ default: m.PartsQuoteGenerator })));
// VehicleDataGapsCard and VehicleResearchItemsCard removed — empty-state-only sections
const VehiclePerformanceCard = React.lazy(() => import('../../components/vehicle/VehiclePerformanceCard'));
const VehicleROISummaryCard = React.lazy(() => import('../../components/vehicle/VehicleROISummaryCard'));
const NukeEstimatePanel = React.lazy(() => import('../../components/vehicle/NukeEstimatePanel'));
const VehiclePricingValueCard = React.lazy(() => import('../../components/vehicle/VehiclePricingValueCard').then(m => ({ default: m.VehiclePricingValueCard })));
const ExternalListingCard = React.lazy(() => import('../../components/vehicle/ExternalListingCard'));
const VehicleAuctionQuickStartCard = React.lazy(() => import('../../components/auction/VehicleAuctionQuickStartCard'));
const VehicleReferenceLibrary = React.lazy(() => import('../../components/vehicle/VehicleReferenceLibrary'));
const VehicleDescriptionCard = React.lazy(() => import('../../components/vehicle/VehicleDescriptionCard'));
// VehicleCommunityInsights and VehicleDocumentIntelligence removed — empty-state-only sections
const VehicleCommentsSection = React.lazy(() => import('./VehicleCommentsSection'));
const BundleReviewQueue = React.lazy(() => import('../../components/images/BundleReviewQueue'));
const ImageGallery = React.lazy(() => import('../../components/images/ImageGallery'));
const VehicleVideoSection = React.lazy(() => import('../../components/vehicle/VehicleVideoSection'));

// Collapsible wrapper for ImageGallery (moved from VehicleProfile.tsx)
const CollapsibleGalleryCard: React.FC<{
  vehicleId: string;
  vehicleImages: string[];
  fallbackListingImageUrls: string[];
  vehicle: any;
  onImagesUpdated: () => void;
}> = ({ vehicleId, vehicleImages, fallbackListingImageUrls, vehicle, onImagesUpdated }) => {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const imageCount = vehicleImages.length || fallbackListingImageUrls.length || 0;

  return (
    <div className={`card ${isCollapsed ? 'is-collapsed' : ''}`}>
      <div
        className="card-header"
        onClick={() => setIsCollapsed(!isCollapsed)}
        style={{
          cursor: 'pointer',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
        }}
      >
        <span>IMAGES {imageCount > 0 && `(${imageCount})`}</span>
        <span style={{
          fontSize: '10px',
          color: 'var(--text-muted)',
          transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
          transition: 'transform 0.2s'
        }}>
          ▼
        </span>
      </div>
      {!isCollapsed && (
        <div className="card-body" style={{ padding: 0 }}>
          <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading gallery...</div>}>
            <ImageGallery
              vehicleId={vehicleId}
              showUpload={true}
              fallbackImageUrls={vehicleImages.length > 0 ? [] : fallbackListingImageUrls}
              fallbackLabel="Listing"
              fallbackSourceUrl={
                vehicle?.discovery_url ||
                vehicle?.bat_auction_url ||
                vehicle?.listing_url ||
                undefined
              }
              onImagesUpdated={onImagesUpdated}
            />
          </React.Suspense>
        </div>
      )}
    </div>
  );
};

// FactExplorerPanel removed — empty-state-only section

export type { WorkspaceTabId } from './WorkspaceTabBar';

export interface WorkspaceContentProps {
  vehicle: Vehicle;
  session: any;
  permissions: VehiclePermissions;
  activeWorkspaceTab: WorkspaceTabId;
  isMobile: boolean;

  // Permission booleans
  isRowOwner: boolean;
  isVerifiedOwner: boolean;
  hasContributorAccess: boolean;
  canEdit: boolean;
  isAdminUser: boolean;
  canTriggerProofAnalysis: boolean;

  // Data
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

  // Callbacks
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

const WorkspaceContent: React.FC<WorkspaceContentProps> = ({
  vehicle,
  session,
  permissions,
  activeWorkspaceTab,
  isMobile,
  isRowOwner,
  isVerifiedOwner,
  hasContributorAccess,
  canEdit,
  isAdminUser,
  canTriggerProofAnalysis,
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
  onLoadLiveSession,
  onLoadVehicle,
  onLoadTimelineEvents,
  onLoadVehicleImages,
  onUpdatePrivacy,
  onSetIsPublic,
  onSetReferenceLibraryRefreshKey,
}) => {
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

  return (
    <>
      {/* Primary Image and Timeline */}
      <section className="section">
        <CollapsibleWidget
          title="Timeline"
          defaultCollapsed={false}
          badge={<span className="text-xs text-gray-500 dark:text-gray-400">{timelineEvents.length} event{timelineEvents.length === 1 ? '' : 's'}</span>}
        >
          <VehicleTimelineSection
            vehicle={vehicle}
            session={session}
            permissions={permissions}
            onAddEventClick={onAddEventClick}
          />
        </CollapsibleWidget>
      </section>

      {/* Two Column Layout: Left (all content sections) | Right (image gallery) */}
      <section className="section">
        <div className="vehicle-profile-two-column">
          {/* Left Column — all sections flat, no tabs */}
          <div className="vehicle-profile-left-column" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {/* Work Memory Capture — owners & contributors only */}
            {(isRowOwner || isVerifiedOwner || hasContributorAccess) && (
              <React.Suspense fallback={null}>
                <WorkMemorySection
                  vehicleId={vehicle.id}
                  permissions={permissions}
                />
              </React.Suspense>
            )}

            {/* Description — no outer wrapper, VehicleDescriptionCard has its own CollapsibleWidget */}
            <VehicleDescriptionCard
              vehicleId={vehicle.id}
              initialDescription={vehicle.description}
              isEditable={canEdit}
              onUpdate={() => {}}
            />

            {/* Vehicle Info */}
            <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading basic info...</div>}>
              <VehicleBasicInfo
                vehicle={vehicle}
                session={session}
                permissions={permissions}
                onDataPointClick={onDataPointClick}
                onEditClick={onEditClick}
              />
            </React.Suspense>

            {/* Performance Profile */}
            <CollapsibleWidget title="Performance Profile" defaultCollapsed={true}>
              <VehiclePerformanceCard vehicleId={vehicle.id} compact />
            </CollapsibleWidget>

            {/* Engine Bay Analysis — only if data exists */}
            {(vehicle as any)?.origin_metadata?.engine_bay_analysis?.engine_family && (
              <CollapsibleWidget title="Engine Bay Analysis" defaultCollapsed={true} badge={
                <span className="text-xs text-gray-500 dark:text-gray-400">
                  {(vehicle as any).origin_metadata.engine_bay_analysis.engine_family}
                  {(vehicle as any).origin_metadata.engine_bay_analysis.estimated_displacement
                    ? ` ${(vehicle as any).origin_metadata.engine_bay_analysis.estimated_displacement}`
                    : ''}
                </span>
              }>
                {(() => {
                  const eba = (vehicle as any).origin_metadata.engine_bay_analysis;
                  const confPct = eba.engine_family_confidence != null ? Math.round(eba.engine_family_confidence * 100) : null;
                  return (
                    <div style={{ fontSize: '13px', lineHeight: '1.8' }}>
                      <div style={{ fontWeight: 600, fontSize: '15px', marginBottom: '4px' }}>
                        {eba.engine_family}
                        {eba.estimated_displacement ? ` ${eba.estimated_displacement}` : ''}
                        {confPct != null && (
                          <span style={{
                            marginLeft: '8px',
                            padding: '2px 6px',
                            fontSize: '11px',
                            fontWeight: 400,
                            borderRadius: '2px',
                            backgroundColor: confPct >= 80 ? 'rgba(34,197,94,0.15)' : confPct >= 50 ? 'rgba(234,179,8,0.15)' : 'rgba(239,68,68,0.15)',
                            color: confPct >= 80 ? '#22c55e' : confPct >= 50 ? '#eab308' : '#ef4444',
                          }}>
                            {confPct}% confidence
                          </span>
                        )}
                      </div>
                      <div className="text-small" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px' }}>
                        {eba.fuel_system_type && (
                          <>
                            <span className="text-muted">Fuel System</span>
                            <span>{eba.fuel_system_brand && eba.fuel_system_brand !== 'unknown' ? `${eba.fuel_system_brand} ` : ''}{eba.fuel_system_type.replace(/_/g, ' ')}</span>
                          </>
                        )}
                        {eba.ignition_type && (
                          <>
                            <span className="text-muted">Ignition</span>
                            <span>{eba.ignition_brand && eba.ignition_brand !== 'unknown' ? `${eba.ignition_brand.replace(/_/g, ' ')} ` : ''}{eba.ignition_type.replace(/_/g, ' ')}</span>
                          </>
                        )}
                        {eba.headers && eba.headers !== 'unknown' && (
                          <>
                            <span className="text-muted">Exhaust</span>
                            <span>{eba.headers.replace(/_/g, ' ')}</span>
                          </>
                        )}
                        {eba.condition && eba.condition !== 'unknown' && (
                          <>
                            <span className="text-muted">Condition</span>
                            <span>{eba.condition.replace(/_/g, ' ')}</span>
                          </>
                        )}
                        {eba.modifications?.length > 0 && (
                          <>
                            <span className="text-muted">Modifications</span>
                            <span>{eba.modifications.length} identified</span>
                          </>
                        )}
                      </div>
                      {eba.modifications?.length > 0 && (
                        <div style={{ marginTop: '8px', fontSize: '12px' }}>
                          <div className="text-muted" style={{ fontSize: '11px', marginBottom: '2px' }}>Visible Modifications</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {eba.modifications.map((mod: string, i: number) => (
                              <span key={i} style={{
                                padding: '2px 6px',
                                backgroundColor: 'var(--bg-secondary, rgba(0,0,0,0.05))',
                                border: '1px solid var(--border-color, rgba(0,0,0,0.1))',
                                fontSize: '11px',
                              }}>
                                {mod}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="text-muted" style={{ marginTop: '8px', fontSize: '11px' }}>
                        Analyzed {eba.analyzed_at ? new Date(eba.analyzed_at).toLocaleDateString() : ''}
                        {eba.analysis_version > 1 ? ` (v${eba.analysis_version})` : ''}
                      </div>
                    </div>
                  );
                })()}
              </CollapsibleWidget>
            )}

            {/* Deal Jacket Forensics */}
            <CollapsibleWidget title="Deal Jacket Forensics" defaultCollapsed={true}>
              <VehicleDealJacketForensicsCard vehicleId={vehicle.id} />
            </CollapsibleWidget>

            {/* Investment Summary (has its own CollapsibleWidget internally) */}
            <VehicleROISummaryCard vehicleId={vehicle.id} />

            {/* Nuke Estimate */}
            <CollapsibleWidget title="Nuke Estimate" defaultCollapsed={true} badge={<span className="text-xs text-gray-500 dark:text-gray-400">Valuation & deal score</span>}>
              <NukeEstimatePanel
                vehicleId={vehicle.id}
                vehicle={{ year: vehicle.year, make: vehicle.make, model: vehicle.model }}
              />
            </CollapsibleWidget>

            {/* Pricing & Value (has its own CollapsibleWidget internally) */}
            <VehiclePricingValueCard
              vehicle={vehicle}
              auctionPulse={auctionPulse}
              valuationIntel={valuationIntel as any}
              readinessSnapshot={readinessSnapshot as any}
            />

            {/* Auction History */}
            <CollapsibleWidget title="Auction History" defaultCollapsed={true}>
              <ExternalListingCard vehicleId={vehicle.id} />
            </CollapsibleWidget>

            {/* Auction Quick Start */}
            <CollapsibleWidget title="Auction Quick Start" defaultCollapsed={true}>
              <VehicleAuctionQuickStartCard
                vehicle={{
                  id: vehicle.id,
                  year: vehicle.year,
                  make: vehicle.make,
                  model: vehicle.model,
                  trim: (vehicle as any)?.trim ?? null,
                  mileage: (vehicle as any)?.mileage ?? null,
                }}
                canManage={Boolean(isRowOwner || isVerifiedOwner)}
              />
            </CollapsibleWidget>

            {/* Live Streaming */}
            <CollapsibleWidget title="Live Streaming" defaultCollapsed={true}>
              <VehicleStreamingCard
                vehicleId={vehicle.id}
                vehicleName={getVehicleTitle(vehicle)}
                session={session}
                canManage={Boolean(isRowOwner || isVerifiedOwner || hasContributorAccess)}
                liveSession={liveSession}
                onSessionUpdated={onLoadLiveSession}
              />
            </CollapsibleWidget>

            {/* Ledger Documents — owners & contributors only */}
            {(isVerifiedOwner || hasContributorAccess) && (
              <CollapsibleWidget title="Ledger Documents" defaultCollapsed={true}>
                <VehicleLedgerDocumentsCard vehicleId={vehicle.id} canManage={Boolean(isVerifiedOwner || hasContributorAccess)} />
              </CollapsibleWidget>
            )}

            {/* Wiring Plan — owners only */}
            {(isRowOwner || isVerifiedOwner) && (
              <CollapsibleWidget title="Wiring Plan" defaultCollapsed={true}>
                <WiringQueryContextBar
                  vehicleId={vehicle.id}
                  vehicleInfo={{ year: vehicle.year, make: vehicle.make, model: vehicle.model }}
                  onQuoteGenerated={() => {}}
                />
              </CollapsibleWidget>
            )}

            {/* AI Parts Quote Generator — owners only */}
            {(isRowOwner || isVerifiedOwner) && (
              <CollapsibleWidget title="AI Parts Quote Generator" defaultCollapsed={true}>
                <PartsQuoteGenerator
                  vehicleId={vehicle.id}
                  vehicleInfo={{ year: vehicle.year, make: vehicle.make, model: vehicle.model }}
                />
              </CollapsibleWidget>
            )}

            {/* Reference Library */}
            <CollapsibleWidget title="Reference Library" defaultCollapsed={true}>
              <VehicleReferenceLibrary
                vehicleId={vehicle.id}
                userId={session?.user?.id}
                year={vehicle.year}
                make={vehicle.make}
                series={(vehicle as any).series}
                model={vehicle.model}
                bodyStyle={(vehicle as any).body_style}
                refreshKey={referenceLibraryRefreshKey}
                onUploadComplete={() => {
                  onLoadVehicle();
                  onSetReferenceLibraryRefreshKey((v) => v + 1);
                }}
              />
            </CollapsibleWidget>

            {/* Data sources */}
            <CollapsibleWidget title="Data Sources" defaultCollapsed={true} badge={dataSources.length > 0 ? <span className="text-xs text-gray-500 dark:text-gray-400">{dataSources.length} source{dataSources.length === 1 ? '' : 's'}</span> : undefined}>
              <div>
                {(importMeta.builder || importMeta.seller) && (
                  <div className="text-small text-muted" style={{ marginBottom: '8px' }}>
                    {importMeta.builder ? `Builder: ${importMeta.builder}` : null}
                    {importMeta.builder && importMeta.seller ? ' • ' : null}
                    {importMeta.seller ? `Seller: ${importMeta.seller}` : null}
                  </div>
                )}
                {dataSources.length === 0 ? (
                  <div className="text-small text-muted">No external sources attached yet.</div>
                ) : (
                  <ul style={{ margin: '0', paddingLeft: '18px' }}>
                    {dataSources.map((url) => (
                      <li key={url} className="text-small">
                        <a href={url} target="_blank" rel="noreferrer">
                          {sourceLabel(url)}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </CollapsibleWidget>

            {/* Privacy Settings */}
            {!vehicle.isAnonymous && session && (
              <CollapsibleWidget title="Privacy Settings" defaultCollapsed={true} badge={<span className={`text-xs ${isPublic ? 'text-green-500' : 'text-gray-500'}`}>{isPublic ? 'Public' : 'Private'}</span>}>
                <div className="vehicle-detail">
                  <span>Visibility</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span className={`badge ${isPublic ? 'badge-success' : 'badge-secondary'}`}>
                      {isPublic ? 'Public' : 'Private'}
                    </span>
                    <label style={{ display: 'flex', alignItems: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isPublic}
                        onChange={(e) => {
                          onSetIsPublic(e.target.checked);
                          onUpdatePrivacy();
                        }}
                      />
                    </label>
                  </div>
                </div>
              </CollapsibleWidget>
            )}
          </div>

          {/* Right Column: Image Gallery & Videos */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {/* Session Review Queue — auto-created events needing owner input */}
            {session && (
              <React.Suspense fallback={null}>
                <BundleReviewQueue
                  vehicleId={vehicle.id}
                  onComplete={() => onLoadTimelineEvents()}
                />
              </React.Suspense>
            )}

            {/* Images - Collapsible */}
            <CollapsibleGalleryCard
              vehicleId={vehicle.id}
              vehicleImages={vehicleImages}
              fallbackListingImageUrls={fallbackListingImageUrls}
              vehicle={vehicle}
              onImagesUpdated={() => {
                onLoadVehicle();
                onLoadTimelineEvents();
                onLoadVehicleImages();
              }}
            />

            {/* Video Moments - Collapsible */}
            <CollapsibleWidget title="Videos" defaultCollapsed={true}>
              <VehicleVideoSection vehicleId={vehicle.id} defaultCollapsed={false} />
            </CollapsibleWidget>

            {/* Comments — sticky in right column */}
            <React.Suspense fallback={null}>
              <VehicleCommentsSection vehicleId={vehicle.id} />
            </React.Suspense>
          </div>
        </div>
      </section>
    </>
  );
};

export default WorkspaceContent;
