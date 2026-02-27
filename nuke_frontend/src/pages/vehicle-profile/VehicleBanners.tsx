import React from 'react';
import type { Vehicle, VehiclePermissions } from './types';
import OrphanedVehicleBanner from '../../components/vehicle/OrphanedVehicleBanner';

const LiveAuctionBanner = React.lazy(() => import('../../components/auction/LiveAuctionBanner'));
const ExternalAuctionLiveBanner = React.lazy(() => import('../../components/auction/ExternalAuctionLiveBanner'));
const MergeProposalsPanel = React.lazy(() => import('../../components/vehicle/MergeProposalsPanel'));

export interface VehicleBannersProps {
  vehicle: Vehicle | null;
  session: any;
  permissions: VehiclePermissions;
  auctionPulse: any;
  auctionCurrency: string;
  isVerifiedOwner: boolean;
  onMergeComplete: () => void;
}

const VehicleBanners: React.FC<VehicleBannersProps> = ({
  vehicle,
  session,
  permissions,
  auctionPulse,
  auctionCurrency,
  isVerifiedOwner,
  onMergeComplete,
}) => {
  if (!vehicle) return null;

  return (
    <>
      {/* BaT base-data flag banner (persisted by bat-base-data-check-runner) */}
      {(() => {
        const v: any = vehicle as any;
        const bc = v?.origin_metadata?.bat_base_check;
        const needsRepair = bc?.needs_repair === true;
        if (!needsRepair) return null;
        const missing = Array.isArray(bc?.missing_fields) ? bc.missing_fields.map((x: any) => String(x)) : [];
        const checkedAtRaw = bc?.last_checked_at ? String(bc.last_checked_at) : null;
        const checkedAt = checkedAtRaw ? new Date(checkedAtRaw) : null;
        const checkedAtText = checkedAt && Number.isFinite(checkedAt.getTime()) ? checkedAt.toLocaleString() : null;

        return (
          <div style={{ padding: '0 var(--space-4)', maxWidth: '1600px', margin: 'var(--space-3) auto 0' }}>
            <div className="card" style={{ border: '2px solid var(--warning)', background: 'var(--warning-dim)' }}>
              <div className="card-body" style={{ fontSize: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                  <div style={{ fontWeight: 800 }}>Base data incomplete</div>
                  {checkedAtText && (
                    <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Last check: {checkedAtText}</div>
                  )}
                </div>
                {missing.length > 0 && (
                  <div style={{ marginTop: 6 }}>
                    <span style={{ fontWeight: 700 }}>Missing:</span>{' '}
                    <span style={{ fontFamily: 'monospace' }}>{missing.join(', ')}</span>
                  </div>
                )}
                <div style={{ marginTop: 6, fontSize: '11px', color: 'var(--text-muted)' }}>
                  This vehicle is flagged for data enrichment to fill missing base fields.
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Live Auction Banner - Show if vehicle has active Nuke auction */}
      <React.Suspense fallback={null}><LiveAuctionBanner vehicleId={vehicle.id} /></React.Suspense>

      {/* External Auction Live Banner - Show if vehicle has active BaT/C&B/etc auction */}
      {auctionPulse?.listing_url && ['active', 'live'].includes(String(auctionPulse?.listing_status || '').toLowerCase()) && (
        <div style={{ padding: '0 var(--space-4)', maxWidth: '1600px', margin: 'var(--space-2) auto 0' }}>
          <React.Suspense fallback={null}><ExternalAuctionLiveBanner
            externalListingId={auctionPulse?.external_listing_id || null}
            platform={auctionPulse?.platform || 'bat'}
            listingUrl={auctionPulse?.listing_url || ''}
            currentBid={typeof auctionPulse?.current_bid === 'number' ? auctionPulse.current_bid : null}
            bidCount={typeof auctionPulse?.bid_count === 'number' ? auctionPulse.bid_count : null}
            watcherCount={typeof auctionPulse?.watcher_count === 'number' ? auctionPulse.watcher_count : null}
            commentCount={typeof auctionPulse?.comment_count === 'number' ? auctionPulse.comment_count : null}
            endDate={auctionPulse?.end_date || null}
            listingStatus={auctionPulse?.listing_status || null}
            lastUpdatedAt={auctionPulse?.updated_at || null}
            currencyCode={auctionCurrency}
          /></React.Suspense>
        </div>
      )}

      {/* Orphaned Vehicle Banner - Visible to all users */}
      <OrphanedVehicleBanner
        vehicle={vehicle}
        session={session}
        permissions={permissions}
      />

      {/* Merge Proposals Panel - Only visible to verified owners */}
      {isVerifiedOwner && (
        <React.Suspense fallback={<div style={{ padding: '12px' }}>Loading merge proposals...</div>}>
          <MergeProposalsPanel
            vehicleId={vehicle.id}
            onMergeComplete={onMergeComplete}
          />
        </React.Suspense>
      )}
    </>
  );
};

export default VehicleBanners;
