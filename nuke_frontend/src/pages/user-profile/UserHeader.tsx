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
  } = useUserProfile();

  // EXPAND-DON'T-NAVIGATE (founder law: "everything is a button, everything
  // expands"). The header stats are doors: clicking WORKED ON / LISTINGS /
  // COMMENTS reveals its detail inline, right under the header, and clicking
  // again (or the ✕) closes it — reversible depth (C10), no page jump.
  const [openDoor, setOpenDoor] = useState<null | 'worked' | 'listings' | 'comments'>(null);
  const toggleDoor = (door: 'worked' | 'listings' | 'comments') =>
    setOpenDoor((cur) => (cur === door ? null : door));

  if (!profile) return null;

  const username = profile.username || profile.id?.slice(0, 8);
  const fullName = profile.full_name;
  // Structured city/state beats the legacy free-text location field
  // (which holds stale junk like a bare ZIP).
  const location =
    [profile.city, profile.state].filter(Boolean).join(', ') ||
    profile.location;
  const memberSince = profile.member_since || profile.created_at;
  const memberYear = memberSince ? new Date(memberSince).getFullYear() : null;

  // Stats — every headline carries an honest denominator (number doctrine).
  // VEHICLES uses vehicles_count = "worked on" (distinct vehicles with timeline
  // activity), NOT total_vehicles (record-authorship over a 4-col union, ~half
  // scraped Craigslist listings — never a public headline). Labeled WORKED ON.
  const workedOnVehicles = stats?.vehicles_count ?? null;
  const totalListings = stats?.total_listings ?? 0;
  const totalComments = stats?.total_comments ?? 0;
  // BIDS is structurally blind (the bids table doesn't exist; only completed
  // purchases materialize) — a "0" asserts an inactivity the data can't
  // support, so it's suppressed. AUCTIONS WON is the real, observable figure.
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
            {[location, memberYear ? `SINCE ${memberYear}` : null]
              .filter(Boolean)
              .join(' / ')}
          </div>
        </div>
      </div>

      {/* Center: Stat DOORS — each is a button that expands its detail inline
          (founder law). Only render a count when it's real and non-zero
          (No Empty Shells). The count and its drilled list always come from the
          same source, so they can't disagree (C0). */}
      <div className="up-header__center">
        {workedOnVehicles != null && workedOnVehicles > 0 && (
          <button
            type="button"
            className={`up-stat-pill up-stat-pill--door${openDoor === 'worked' ? ' up-stat-pill--open' : ''}`}
            aria-expanded={openDoor === 'worked'}
            onClick={() => toggleDoor('worked')}
          >
            <span className="up-stat-pill__label">WORKED ON</span>
            {workedOnVehicles}
          </button>
        )}
        {totalListings > 0 && (
          <button
            type="button"
            className={`up-stat-pill up-stat-pill--door${openDoor === 'listings' ? ' up-stat-pill--open' : ''}`}
            aria-expanded={openDoor === 'listings'}
            onClick={() => toggleDoor('listings')}
          >
            <span className="up-stat-pill__label">LISTINGS</span>
            {totalListings}
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
          workedOn={workedOnVehicles}
          listings={comprehensiveData?.listings || []}
          comments={comprehensiveData?.comments || []}
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
  door: 'worked' | 'listings' | 'comments';
  workedOn: number | null;
  listings: any[];
  comments: any[];
  onClose: () => void;
}> = ({ door, workedOn, listings, comments, onClose }) => {
  const title =
    door === 'worked' ? `WORKED ON · ${workedOn ?? 0}`
      : door === 'listings' ? `LISTINGS · ${listings.length}`
        : `COMMENTS · ${comments.length}`;

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
          {/* The 88 worked-on list is not loaded client-side; per C0 we don't
              fabricate it. The door points at the built/owned garage rendered
              below (the vehicles he actually owns), the trustworthy subset. */}
          <a href="#vehicle-collection" className="up-stat-door__cta" onClick={onClose}>
            View the {workedOn ?? 0} vehicles worked on →
          </a>
        </div>
      )}

      {door === 'listings' && (
        <div className="up-stat-door__body">
          {listings.length === 0 ? (
            <div className="up-stat-door__empty">No listings.</div>
          ) : (
            listings.slice(0, 50).map((l: any, i: number) => (
              <a
                key={l.id || i}
                href={l.vehicle?.id ? `/vehicle/${l.vehicle.id}` : (l.source_url || '#')}
                className="up-stat-door__row"
              >
                <span className="up-stat-door__row-main">{vehLabel(l.vehicle)}</span>
                <span className="up-stat-door__row-meta">
                  {l.event_status ? String(l.event_status).toUpperCase() : 'LISTED'}
                  {l.sale_price ? ` · $${Number(l.sale_price).toLocaleString()}` : ''}
                </span>
              </a>
            ))
          )}
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
