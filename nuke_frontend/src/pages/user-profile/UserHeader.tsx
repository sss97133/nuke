import React, { useState } from 'react';
import { useUserProfile } from './UserProfileContext';

/**
 * UserHeader -- Sticky header bar showing user identity and stats.
 * Mirrors VehicleHeader pattern. Uses up-* CSS classes from user-profile.css.
 */

function getInitials(name: string | null | undefined): string {
  if (!name) return '?';
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();
}

const UserHeader: React.FC = () => {
  const {
    profile,
    stats,
    isOwnProfile,
    comprehensiveData,
    isExternalIdentity,
  } = useUserProfile();

  // EXPAND-DON'T-NAVIGATE (founder law: "everything is a button, everything
  // expands"). The header stats are doors: clicking VEHICLES / LISTINGS /
  // COMMENTS reveals its detail inline, right under the header, and clicking
  // again (or the ✕) closes it — reversible depth (C10), no page jump.
  const [openDoor, setOpenDoor] = useState<null | 'worked' | 'listings' | 'comments' | 'bids'>(null);
  const toggleDoor = (door: 'worked' | 'listings' | 'comments' | 'bids') =>
    setOpenDoor((cur) => (cur === door ? null : door));

  if (!profile) return null;

  const username = profile.username || profile.id?.slice(0, 8);
  const fullName = profile.full_name;
  // Structured city/state beats the legacy free-text location field
  // (which holds stale junk like a bare ZIP).
  const location =
    [profile.city, profile.state].filter(Boolean).join(', ') ||
    profile.location;
  const memberSince = isExternalIdentity ? profile.member_since : profile.member_since || profile.created_at;
  const memberYear = memberSince ? new Date(memberSince).getFullYear() : null;

  // Stats — every headline carries an honest denominator (number doctrine).
  // vehicles_count is a stored profile vehicle count. Personal work history
  // requires separate evidence. total_vehicles counts record authorship across
  // sources and remains unsuitable for this personal headline.
  const recordedVehicles = stats?.vehicles_count ?? null;
  const totalListings = stats?.total_listings ?? 0;
  const totalComments = stats?.total_comments ?? 0;
  // External bid events come from the canonical auction log. Claimed-account
  // purchase records remain distinct and are not labeled as bid events.
  const auctionsWon = stats?.total_auction_wins ?? 0;
  // IMAGES is intentionally NOT shown here: profile_stats.total_images is a
  // stale cron snapshot (23,376 vs 22,728 live) and RECENT PHOTOS already shows
  // the live count — two image totals on one page is a contradiction.

  const handleEditProfile = () => {
    window.dispatchEvent(new CustomEvent('up:open-settings'));
  };

  return (
    <div
      className="up-header"
      data-user-id={profile.id}
      data-username={username}
      data-user-type={profile.user_type || 'user'}
    >
      {/* Left: Avatar + Identity */}
      <div className="up-header__left">
        {profile.avatar_url ? (
          <img
            className="up-header__avatar"
            src={profile.avatar_url}
            alt={username}
          />
        ) : (
          <div
            className="up-header__avatar"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: '#e0e0e0',
              fontFamily: 'Arial, sans-serif',
              fontSize: '11px',
              fontWeight: 700,
              color: '#1a1a1a',
            }}
          >
            {getInitials(fullName || username)}
          </div>
        )}
        <div>
          <div className="up-header__name">{fullName || username}</div>
          <div className="up-header__username">@{username}</div>
          <div className="up-header__meta">
            {[location, memberYear ? `${isExternalIdentity ? 'OBSERVED ACTIVITY SINCE' : 'SINCE'} ${memberYear}` : null]
              .filter(Boolean)
              .join(' / ')}
          </div>
        </div>
      </div>

      {/* Center: Stat DOORS — each is a button that expands its detail inline
          (founder law). Only render a count when it's real and non-zero
          (No Empty Shells). Listing/comment counts share their loaded source.
          The stored vehicle count discloses its snapshot/subset boundary. */}
      <div className="up-header__center">
        {recordedVehicles != null && recordedVehicles > 0 && (
          <button
            type="button"
            className={`up-stat-pill up-stat-pill--door${openDoor === 'worked' ? ' up-stat-pill--open' : ''}`}
            aria-expanded={openDoor === 'worked'}
            onClick={() => toggleDoor('worked')}
          >
            <span className="up-stat-pill__label">RECORDED VEHICLES</span>
            {recordedVehicles}
          </button>
        )}
        {totalListings > 0 && (
          <button
            type="button"
            className={`up-stat-pill up-stat-pill--door${openDoor === 'listings' ? ' up-stat-pill--open' : ''}`}
            aria-expanded={openDoor === 'listings'}
            onClick={() => toggleDoor('listings')}
          >
            <span className="up-stat-pill__label">BAT LISTING RECORDS</span>
            {totalListings}
          </button>
        )}
        {isExternalIdentity && (stats?.total_bids ?? 0) > 0 && (
          <button type="button" className="up-stat-pill up-stat-pill--door" aria-expanded={openDoor === 'bids'} onClick={() => toggleDoor('bids')}>
            <span className="up-stat-pill__label">CAPTURED BIDS</span>{stats?.total_bids}
          </button>
        )}
        {totalComments > 0 && (
          <button
            type="button"
            className={`up-stat-pill up-stat-pill--door${openDoor === 'comments' ? ' up-stat-pill--open' : ''}`}
            aria-expanded={openDoor === 'comments'}
            onClick={() => toggleDoor('comments')}
          >
            <span className="up-stat-pill__label">COMMENTS</span>
            {totalComments}
          </button>
        )}
        {auctionsWon > 0 && (
          <span className="up-stat-pill">
            <span className="up-stat-pill__label">AUCTIONS WON</span>
            {auctionsWon}
          </span>
        )}
      </div>

      {/* Right: Actions */}
      <div className="up-header__right">
        {isOwnProfile && (
          <button className="up-btn" onClick={handleEditProfile}>
            EDIT PROFILE
          </button>
        )}
        {/* REMOVED (founder teardown PROFILE_BUILD_ORDER 2026-06-13 + audit P5):
            - CLAIM button: onClick was console.log('claim') — a dead control.
            - ADMIN menu (INSPECT / FLAG USER): both console.log only (dead), and
              moderation tooling does not belong on the public record ("some
              random stupid shit admin"). */}
      </div>

      {/* Inline DOOR detail — expands under the bar for the open stat (C10
          reversible: ✕ or re-click the pill to close). */}
      {openDoor && (
        <StatDoorPanel
          door={openDoor}
          recordedVehicles={recordedVehicles}
          listings={comprehensiveData?.listings || []}
          comments={comprehensiveData?.comments || []}
          bids={comprehensiveData?.bids || []}
          onClose={() => setOpenDoor(null)}
        />
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Stat door detail panel — renders the real list behind a header stat.
// Count and list share a source so they can't disagree (C0). No fabrication:
// WORKED ON has no client-loaded list, so it links to the owned/built garage
// below rather than inventing 88 rows.
// ---------------------------------------------------------------------------

const vehLabel = (v: any): string =>
  v ? [v.year, v.make, v.model].filter(Boolean).join(' ') || 'Vehicle' : 'Vehicle';

const StatDoorPanel: React.FC<{
  door: 'worked' | 'listings' | 'comments' | 'bids';
  recordedVehicles: number | null;
  listings: any[];
  comments: any[];
  bids: any[];
  onClose: () => void;
}> = ({ door, recordedVehicles, listings, comments, bids, onClose }) => {
  const title =
    door === 'worked' ? `RECORDED VEHICLES · ${recordedVehicles ?? 0}`
      : door === 'listings' ? `BAT LISTING RECORDS · ${listings.length} LOADED`
        : door === 'bids' ? `CAPTURED BIDS · ${bids.length} LOADED` : `COMMENTS · ${comments.length}`;

  return (
    <div className="up-stat-door" role="region" aria-label={title}>
      <div className="up-stat-door__bar">
        <span className="up-stat-door__title">{title}</span>
        <button type="button" className="up-btn up-stat-door__close" onClick={onClose}>
          ✕ CLOSE
        </button>
      </div>

      {door === 'worked' && (
        <div className="up-stat-door__body">
          <div className="up-stat-door__empty">
            Stored profile vehicle count. Personal work history is unverified.
            The collection below can show a subset.
          </div>
          <a href="#vehicle-collection" className="up-stat-door__cta" onClick={onClose}>
            View vehicle collection →
          </a>
        </div>
      )}

      {door === 'listings' && (
        <div className="up-stat-door__body">
          <div className="up-stat-door__empty">Captured BaT records for linked source handles. Total consignment history is unknown.</div>
          {listings.length === 0 ? (
            <div className="up-stat-door__empty">No listings.</div>
          ) : (
            listings.slice(0, 50).map((l: any, i: number) => (
              <a
                key={l.id || i}
                href={l.vehicle?.id ? `/vehicle/${l.vehicle.id}` : (l.source_url || '#')}
                className="up-stat-door__row"
              >
                <span className="up-stat-door__row-main">{l.vehicle ? vehLabel(l.vehicle) : l.bat_listing_title || 'BAT LISTING'}</span>
                <span className="up-stat-door__row-meta">
                  {l.event_status ? String(l.event_status).toUpperCase() : 'LISTED'}
                  {l.sale_price ? ` · $${Number(l.sale_price).toLocaleString()}` : ''}
                </span>
              </a>
            ))
          )}
        </div>
      )}

      {door === 'bids' && (
        <div className="up-stat-door__body">
          <p>Latest 100 captured bid events. This is observed activity, not a lifetime record.</p>
          {bids.map(bid => bid.vehicle_id && bid.auction_event_id ? (
            <a key={bid.id} className="up-stat-door__row" href={`/stacks/order-book/${bid.vehicle_id}?${new URLSearchParams({ lot: bid.auction_event_id, at: bid.id })}`}>
              <span className="up-stat-door__row-main">{vehLabel(bid.auction?.vehicle)}</span>
              <span className="up-stat-door__row-meta">Source bid {Number(bid.bid_amount).toLocaleString()} · {bid.posted_at ? new Date(bid.posted_at).toLocaleString() : 'Event time unknown'}</span>
            </a>
          ) : <div key={bid.id} className="up-stat-door__row"><span className="up-stat-door__row-main">Lot link unresolved</span><span className="up-stat-door__row-meta">Source bid {Number(bid.bid_amount).toLocaleString()} · {bid.posted_at ? new Date(bid.posted_at).toLocaleString() : 'Event time unknown'}</span></div>)}
        </div>
      )}
      {door === 'comments' && (
        <div className="up-stat-door__body">
          {comments.length === 0 ? (
            <div className="up-stat-door__empty">No comments.</div>
          ) : (
            comments.slice(0, 50).map((c: any, i: number) => {
              const veh = c.auction?.vehicle;
              const when = c.posted_at ? new Date(c.posted_at).toLocaleDateString() : '';
              return (
                <a
                  key={c.id || i}
                  href={veh?.id ? `/vehicle/${veh.id}` : '#'}
                  className="up-stat-door__row"
                >
                  <span className="up-stat-door__row-main">
                    {c.comment_text || '(comment)'}
                  </span>
                  <span className="up-stat-door__row-meta">
                    {[vehLabel(veh), when].filter(Boolean).join(' · ')}
                  </span>
                </a>
              );
            })
          )}
        </div>
      )}
    </div>
  );
};

export default UserHeader;
