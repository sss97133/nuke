import React, { useContext, useMemo } from 'react';
import { useVehicleProfile } from './VehicleProfileContext';
import { PopupStackContext } from '../../components/popups/PopupStack';
import { useAuctionCommentStats } from '../../hooks/useAuctionComments';
import { CommentsPopup } from '../../components/popups/CommentsPopup';
import { BidsPopup } from '../../components/popups/BidsPopup';
import { WatchersPopup } from '../../components/popups/WatchersPopup';
import { classifyVehicleFacets, resolveVettedIdentityMarks } from '../familyFacetsAndEmblems';

function formatPrice(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return '--';
  return `$${n.toLocaleString()}`;
}

/**
 * Supplementary badge bar -- shows engagement metrics that VehicleHeader doesn't display.
 * VehicleHeader already renders: SOLD, source, price, seller, buyer, location, mileage, time.
 * This bar adds: BIDS, COMMENTS, WATCHERS.
 *
 * Engagement badges open full-data popups.
 */
const VehicleBadgeBar: React.FC = () => {
  const { vehicle, auctionPulse } = useVehicleProfile();
  const popupCtx = useContext(PopupStackContext);
  const v = vehicle as any;

  // Engagement stats — prefer live count from auction_comments over stale snapshots
  const bidCount = auctionPulse?.bid_count || v.bid_count;
  const { data: commentStats } = useAuctionCommentStats(v?.id);
  const commentCount = commentStats?.commentCount || auctionPulse?.comment_count || v.comment_count;
  const watcherCount = auctionPulse?.watcher_count || v.bat_watchers;
  const highBid = v.high_bid || auctionPulse?.current_bid;
  const listingUrl = (auctionPulse as any)?.listing_url || v.bat_auction_url || v.discovery_url || null;

  const { identityMarks, facets } = useMemo(() => {
    if (!v?.make) return { identityMarks: [], facets: { series: null, trim: null, body: null } };
    const descriptor = [
      v.model,
      v.series,
      v.trim,
      v.body_style,
      v.listing_title,
      v.title,
    ]
      .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
      .join(' · ');
    const yr = typeof v.year === 'number' ? v.year : null;
    const f = classifyVehicleFacets(v.make, v.normalized_model || v.model, descriptor, yr);
    const marks = resolveVettedIdentityMarks({
      make: v.make,
      familyLabel: v.normalized_model || v.model,
      modelLabel: descriptor,
      year: yr,
    });
    return { identityMarks: marks.slice(0, 4), facets: f };
  }, [v?.make, v?.model, v?.normalized_model, v?.series, v?.trim, v?.body_style, v?.listing_title, v?.title, v?.year]);

  const hasBadges = (bidCount != null && bidCount > 0) ||
    (commentCount != null && commentCount > 0) ||
    (watcherCount != null && watcherCount > 0) ||
    identityMarks.length > 0 ||
    !!(facets.series || facets.trim || facets.body);

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
    <div className="vehicle-sub__badges" data-testid="vehicle-badge-bar" style={{ padding: '4px 12px', display: 'flex', flexWrap: 'wrap', gap: '6px', alignItems: 'center', borderBottom: '1px solid var(--vp-ghost, #e0e0e0)' }}>
      <style>{`
        .vp-identity-mark {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 2px 6px;
          border: 1px solid var(--border, #333);
          background: var(--bg, #0d0d0d);
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.08em;
          font-family: 'Courier New', monospace;
        }
        .vp-identity-mark__svg {
          display: inline-flex;
          align-items: center;
          height: 15px;
          width: 54px;
        }
        .vp-facet-chip {
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.06em;
        }
      `}</style>
      {/* VETTED ERA & TRIM EMBLEMS */}
      {identityMarks.map((mark) => (
        <span
          key={mark.id}
          className="vp-identity-mark"
          data-testid={`vehicle-identity-mark-${mark.id}`}
          title={`${mark.displayLabel} — ${mark.subLabel}${mark.rpoCode ? ` (${mark.rpoCode})` : ''}`}
        >
          <span
            aria-hidden="true"
            className="vp-identity-mark__svg"
            dangerouslySetInnerHTML={{ __html: mark.svgMarkup }}
          />
          <span>{mark.displayLabel}</span>
        </span>
      ))}

      {/* ORTHOGONAL SERIES / TRIM / BODY STYLE FACET CHIPS */}
      {facets.series && (
        <span className="badge vp-facet-chip" data-testid="vehicle-facet-series">
          SERIES · {facets.series}
        </span>
      )}
      {facets.trim && (
        <span className="badge vp-facet-chip" data-testid="vehicle-facet-trim">
          TRIM · {facets.trim}
        </span>
      )}
      {facets.body && (
        <span className="badge vp-facet-chip" data-testid="vehicle-facet-body">
          BODY · {facets.body}
        </span>
      )}

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


    </div>
  );
};

export default VehicleBadgeBar;
