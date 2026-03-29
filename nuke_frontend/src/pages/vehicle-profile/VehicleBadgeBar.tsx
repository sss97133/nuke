import React, { useContext, useState, useEffect } from 'react';
import { supabase } from '../../lib/supabase';
import { useVehicleProfile } from './VehicleProfileContext';
import { PopupStackContext } from '../../components/popups/PopupStack';
import { CommentsPopup } from '../../components/popups/CommentsPopup';
import { BidsPopup } from '../../components/popups/BidsPopup';
import { WatchersPopup } from '../../components/popups/WatchersPopup';

function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '--';
  return `$${n.toLocaleString()}`;
}

/**
 * Supplementary badge bar -- shows engagement metrics that VehicleHeader doesn't display.
 * VehicleHeader already renders: SOLD, source, price, seller, buyer, location, mileage, time.
 * This bar adds: BIDS, COMMENTS, WATCHERS, DQ score.
 *
 * Every badge is clickable and opens a popup with full data.
 */
const VehicleBadgeBar: React.FC = () => {
  const { vehicle, auctionPulse } = useVehicleProfile();
  const popupCtx = useContext(PopupStackContext);
  const v = vehicle as any;

  // Engagement stats — prefer live count from auction_comments over stale snapshots
  const bidCount = auctionPulse?.bid_count || v.bid_count;
  const [liveCommentCount, setLiveCommentCount] = useState<number | null>(null);
  useEffect(() => {
    if (!v?.id) return;
    supabase.from('auction_comments').select('id', { count: 'exact', head: true })
      .eq('vehicle_id', v.id)
      .then(({ count }) => { if (count != null && count > 0) setLiveCommentCount(count); });
  }, [v?.id]);
  const commentCount = liveCommentCount || auctionPulse?.comment_count || v.comment_count;
  const watcherCount = auctionPulse?.watcher_count || v.bat_watchers;
  const dqScore = v.data_quality_score;
  const highBid = v.high_bid || auctionPulse?.current_bid;
  const listingUrl = (auctionPulse as any)?.listing_url || v.bat_auction_url || v.discovery_url || null;

  const hasBadges = (bidCount != null && bidCount > 0) ||
    (commentCount != null && commentCount > 0) ||
    (watcherCount != null && watcherCount > 0) ||
    dqScore != null;

  if (!hasBadges) return null;

  const handleBidsClick = () => {
    if (!popupCtx || !v.id) return;
    popupCtx.push(
      <BidsPopup vehicleId={v.id} bidCount={bidCount} highBid={highBid} listingUrl={listingUrl} />,
      `BID HISTORY (${bidCount})`,
      420,
    );
  };

  const handleCommentsClick = () => {
    if (!popupCtx || !v.id) return;
    popupCtx.push(
      <CommentsPopup vehicleId={v.id} expectedCount={commentCount} />,
      `COMMENTS (${commentCount})`,
      460,
    );
  };

  const handleWatchersClick = () => {
    if (!popupCtx || !v.id) return;
    popupCtx.push(
      <WatchersPopup
        vehicleId={v.id}
        watcherCount={watcherCount}
        viewCount={v.bat_views || (auctionPulse as any)?.view_count || null}
        make={v.make || null}
        model={v.model || null}
      />,
      `WATCHERS (${watcherCount?.toLocaleString()})`,
      380,
      false,
    );
  };

  const badgeStyle: React.CSSProperties = {
    cursor: 'pointer',
    transition: 'border-color 180ms cubic-bezier(0.16, 1, 0.3, 1)',
  };

  return (
    <div className="vehicle-sub__badges" style={{ padding: '4px 12px', display: 'flex', flexWrap: 'wrap', gap: '4px', alignItems: 'center', borderBottom: '1px solid var(--vp-ghost, #e0e0e0)' }}>
      {/* BIDS */}
      {bidCount != null && bidCount > 0 && (
        <span
          className="badge badge--bids"
          role="button"
          tabIndex={0}
          style={badgeStyle}
          onClick={handleBidsClick}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleBidsClick(); } }}
        >
          BIDS {bidCount}
          <span className="badge__tooltip">
            {bidCount} total bids<br />
            {highBid && <>High bid: {formatPrice(highBid)}<br /></>}
            Click to view bid history
          </span>
        </span>
      )}

      {/* COMMENTS */}
      {commentCount != null && commentCount > 0 && (
        <span
          className="badge badge--comments"
          role="button"
          tabIndex={0}
          style={badgeStyle}
          onClick={handleCommentsClick}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCommentsClick(); } }}
        >
          COMMENTS {commentCount}
          <span className="badge__tooltip">
            {commentCount} total comments<br />
            Click to read comments
          </span>
        </span>
      )}

      {/* WATCHERS */}
      {watcherCount != null && watcherCount > 0 && (
        <span
          className="badge badge--watchers"
          role="button"
          tabIndex={0}
          style={badgeStyle}
          onClick={handleWatchersClick}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleWatchersClick(); } }}
        >
          WATCHERS {watcherCount}
          <span className="badge__tooltip">
            {watcherCount} watchers<br />
            {v.bat_views && <>{Number(v.bat_views).toLocaleString()} page views<br /></>}
            Click to see watcher analysis
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
