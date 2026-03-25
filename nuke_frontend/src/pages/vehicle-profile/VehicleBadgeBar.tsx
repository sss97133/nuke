import React from 'react';
import { useVehicleProfile } from './VehicleProfileContext';

function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '—';
  return `$${n.toLocaleString()}`;
}

/**
 * Supplementary badge bar — shows engagement metrics that VehicleHeader doesn't display.
 * VehicleHeader already renders: SOLD, source, price, seller, buyer, location, mileage, time.
 * This bar adds: BIDS, COMMENTS, WATCHERS, DQ score.
 */
const VehicleBadgeBar: React.FC = () => {
  const { vehicle, auctionPulse } = useVehicleProfile();
  const v = vehicle as any;

  // Engagement stats — only data VehicleHeader doesn't show
  const bidCount = auctionPulse?.bid_count || v.bid_count;
  const commentCount = auctionPulse?.comment_count || v.comment_count;
  const watcherCount = auctionPulse?.watcher_count || v.bat_watchers;
  const dqScore = v.data_quality_score;
  const highBid = v.high_bid || auctionPulse?.current_bid;

  const hasBadges = (bidCount != null && bidCount > 0) ||
    (commentCount != null && commentCount > 0) ||
    (watcherCount != null && watcherCount > 0) ||
    dqScore != null;

  if (!hasBadges) return null;

  return (
    <div className="vehicle-sub__badges" style={{ padding: '3px 12px', display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', borderBottom: '1px solid var(--vp-ghost, #e0e0e0)' }}>
      {/* BIDS */}
      {bidCount != null && bidCount > 0 && (
        <span className="badge badge--bids">
          BIDS {bidCount}
          <span className="badge__tooltip">
            {bidCount} total bids<br />
            {highBid && <>High bid: {formatPrice(highBid)}<br /></>}
            <span className="tt-db">vehicles.bid_count</span>
          </span>
        </span>
      )}

      {/* COMMENTS */}
      {commentCount != null && commentCount > 0 && (
        <span className="badge badge--comments">
          COMMENTS {commentCount}
          <span className="badge__tooltip">
            {commentCount} total comments
            <span className="tt-db">vehicles.comment_count</span>
          </span>
        </span>
      )}

      {/* WATCHERS */}
      {watcherCount != null && watcherCount > 0 && (
        <span className="badge badge--watchers">
          WATCHERS {watcherCount}
          <span className="badge__tooltip">
            {watcherCount} watchers<br />
            {v.bat_views && <>{Number(v.bat_views).toLocaleString()} page views<br /></>}
            <span className="tt-db">vehicles.bat_watchers · vehicles.bat_views</span>
          </span>
        </span>
      )}

      {/* DQ SCORE */}
      {dqScore != null && (
        <span className={`badge badge--dq ${dqScore >= 70 ? 'badge--dq-green' : 'badge--dq-orange'}`}>
          DQ {dqScore}
          <span className="badge__tooltip">
            Data Quality: {dqScore}/100<br />
            {v.confidence_score != null && <>Confidence: {v.confidence_score}/100<br /></>}
            <span className="tt-db">vehicles.data_quality_score</span>
          </span>
        </span>
      )}
    </div>
  );
};

export default VehicleBadgeBar;
