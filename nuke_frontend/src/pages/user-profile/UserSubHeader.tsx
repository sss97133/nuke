import React from 'react';
import { useUserProfile } from './UserProfileContext';

/**
 * UserSubHeader -- Badge bar below the header.
 * Mirrors VehicleSubHeader pattern. Uses up-* CSS classes from user-profile.css.
 */

const UserSubHeader: React.FC = () => {
  const { profile } = useUserProfile();

  if (!profile) return null;

  const userType = profile.user_type || 'user';
  const verified = profile.verification_status === 'verified';
  const memberSince = profile.member_since || profile.created_at;
  const sinceYear = memberSince ? new Date(memberSince).getFullYear() : null;

  // Expertise badges from metadata (if any)
  const expertise: string[] = [];
  if ((profile as any).metadata?.expertise) {
    const raw = (profile as any).metadata.expertise;
    if (Array.isArray(raw)) {
      expertise.push(...raw.map(String));
    }
  }

  // Type badge CSS class
  const typeBadgeClass =
    userType === 'professional'
      ? 'up-badge up-badge--professional'
      : userType === 'dealer'
        ? 'up-badge up-badge--dealer'
        : 'up-badge';

  return (
    <div
      className="up-sub-header"
      data-user-type={userType}
      data-verified={verified ? 'true' : 'false'}
      data-reputation-score={profile.reputation_score ?? ''}
    >
      {/* User type badge */}
      <span className={typeBadgeClass}>{userType.toUpperCase()}</span>

      {/* Verification badge */}
      {verified && (
        <span className="up-badge up-badge--verified">VERIFIED</span>
      )}

      {/* Member since badge */}
      {sinceYear && (
        <span className="up-badge">SINCE {sinceYear}</span>
      )}

      {/* Expertise badges */}
      {expertise.map((tag) => (
        <span key={tag} className="up-badge" data-expertise={tag}>
          {tag.toUpperCase()}
        </span>
      ))}
    </div>
  );
};

export default UserSubHeader;
