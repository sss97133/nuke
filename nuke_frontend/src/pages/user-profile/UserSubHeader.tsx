import React from 'react';
import { useUserProfile } from './UserProfileContext';
import TextScaleControl from '../../components/TextScaleControl';

/**
 * UserSubHeader -- Badge bar below the header.
 * Mirrors VehicleSubHeader pattern. Uses up-* CSS classes from user-profile.css.
 */

const UserSubHeader: React.FC = () => {
  const { profile } = useUserProfile();

  if (!profile) return null;

  const userType = profile.user_type || 'user';
  const verified =
    profile.verification_level === 'fully_verified' ||
    profile.is_verified === true;

  // Expertise badges from metadata (if any)
  const expertise: string[] = [];
  if ((profile as any).metadata?.expertise) {
    const raw = (profile as any).metadata.expertise;
    if (Array.isArray(raw)) {
      expertise.push(...raw.map(String));
    }
  }

  // Type badge: only meaningful, content-bearing roles (PROFESSIONAL / DEALER)
  // earn a badge. The default 'user' and the 'admin' moderation role are NOT
  // part of the public record — founder teardown called the "ADMIN" badge
  // "random stupid shit." Suppress both.
  const showTypeBadge = userType === 'professional' || userType === 'dealer';
  const typeBadgeClass =
    userType === 'professional'
      ? 'up-badge up-badge--professional'
      : 'up-badge up-badge--dealer';

  return (
    <div
      className="up-sub-header"
      data-user-type={userType}
      data-verified={verified ? 'true' : 'false'}
    >
      {/* User type badge — PROFESSIONAL / DEALER only (USER & ADMIN suppressed) */}
      {showTypeBadge && (
        <span className={typeBadgeClass}>{userType.toUpperCase()}</span>
      )}

      {/* REMOVED (founder teardown PROFILE_BUILD_ORDER 2026-06-13):
          - VERIFIED flat chip: a binary "verified" is not what verification means
            here (it should read as accumulated multi-source consensus, not a
            single flag); Skylar bundled it with "random stupid shit." Rethinking
            verification-as-consensus is a separate design pass.
          - SINCE {year} badge: the header meta line already says "SINCE 2025"
            once. "you already mentioned since 2025 earlier" — duplicate killed. */}

      {/* Expertise badges */}
      {expertise.map((tag) => (
        <span key={tag} className="up-badge" data-expertise={tag}>
          {tag.toUpperCase()}
        </span>
      ))}

      {/* Text size control — right end */}
      <TextScaleControl variant="compact" />
    </div>
  );
};

export default UserSubHeader;
