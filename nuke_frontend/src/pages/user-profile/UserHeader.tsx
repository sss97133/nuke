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
    comprehensiveData,
    isOwnProfile,
    isAdmin,
    isExternalIdentity,
  } = useUserProfile();

  const [adminMenuOpen, setAdminMenuOpen] = useState(false);

  if (!profile) return null;

  const username = profile.username || profile.id?.slice(0, 8);
  const fullName = profile.full_name;
  const location = profile.location;
  const memberSince = profile.member_since || profile.created_at;
  const memberYear = memberSince ? new Date(memberSince).getFullYear() : null;

  // Stats
  const totalVehicles =
    comprehensiveData?.listings?.length ?? profile.total_vehicles ?? 0;
  const totalListings = stats?.total_listings ?? profile.total_listings ?? 0;
  const totalComments = stats?.total_comments ?? profile.total_comments ?? 0;
  const totalBids = stats?.total_bids ?? profile.total_bids ?? 0;
  const reputation = profile.reputation_score ?? 0;

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

      {/* Center: Stat pills */}
      <div className="up-header__center">
        <span className="up-stat-pill">
          <span className="up-stat-pill__label">VEHICLES</span>
          {totalVehicles}
        </span>
        <span className="up-stat-pill">
          <span className="up-stat-pill__label">LISTINGS</span>
          {totalListings}
        </span>
        <span className="up-stat-pill">
          <span className="up-stat-pill__label">COMMENTS</span>
          {totalComments}
        </span>
        <span className="up-stat-pill">
          <span className="up-stat-pill__label">BIDS</span>
          {totalBids}
        </span>
        <span className="up-stat-pill">
          <span className="up-stat-pill__label">REPUTATION</span>
          {reputation}
        </span>
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
