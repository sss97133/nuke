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
    isAdmin,
    isExternalIdentity,
  } = useUserProfile();

  const [adminMenuOpen, setAdminMenuOpen] = useState(false);

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

      {/* Center: Stat pills — only show a count when it's real and non-zero
          (No Empty Shells). Each pill is a labeled, honest figure. */}
      <div className="up-header__center">
        {workedOnVehicles != null && workedOnVehicles > 0 && (
          <span className="up-stat-pill">
            <span className="up-stat-pill__label">WORKED ON</span>
            {workedOnVehicles}
          </span>
        )}
        {totalListings > 0 && (
          <span className="up-stat-pill">
            <span className="up-stat-pill__label">LISTINGS</span>
            {totalListings}
          </span>
        )}
        {totalComments > 0 && (
          <span className="up-stat-pill">
            <span className="up-stat-pill__label">COMMENTS</span>
            {totalComments}
          </span>
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
        {isExternalIdentity && !isOwnProfile && (
          <button className="up-btn" onClick={() => console.log('claim')}>
            CLAIM
          </button>
        )}
        {isAdmin && (
          <div style={{ position: 'relative' }}>
            <button
              className="up-btn"
              onClick={() => setAdminMenuOpen((v) => !v)}
            >
              ADMIN
            </button>
            {adminMenuOpen && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  right: 0,
                  background: '#fff',
                  border: '1px solid #1a1a1a',
                  zIndex: 1010,
                  minWidth: 120,
                  fontFamily: 'Arial, sans-serif',
                  fontSize: '8px',
                }}
              >
                <button
                  className="up-btn"
                  style={{ width: '100%', border: 'none', borderBottom: '1px solid #ddd' }}
                  onClick={() => {
                    console.log('admin:inspect');
                    setAdminMenuOpen(false);
                  }}
                >
                  INSPECT
                </button>
                <button
                  className="up-btn"
                  style={{ width: '100%', border: 'none' }}
                  onClick={() => {
                    console.log('admin:flag');
                    setAdminMenuOpen(false);
                  }}
                >
                  FLAG USER
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default UserHeader;
