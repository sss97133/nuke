/**
 * UserBriefing — Intelligence headline + stat pills.
 * Mirrors VehicleBriefing pattern.
 *
 * Priority order for headline:
 * 1. Onboarding prompt (own profile, missing data)
 * 2. Active auctions count
 * 3. Reputation milestone
 * 4. Collection summary
 * 5. Recent activity summary
 * 6. null (don't render)
 *
 * Self-guarding: returns null if no headline AND no stats.
 */
import React, { useMemo } from 'react';
import { useUserProfile } from './UserProfileContext';

// ---------------------------------------------------------------------------
// Date formatting
// ---------------------------------------------------------------------------

function formatMemberSince(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null;
  try {
    const d = new Date(dateStr);
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    return `${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const UserBriefing: React.FC = () => {
  const { profile, isOwnProfile, stats, comprehensiveData } = useUserProfile();

  // ── Headline ──

  const headline = useMemo(() => {
    if (!profile) return null;

    // 1. Onboarding prompt
    if (isOwnProfile) {
      const missingAvatar = !profile.avatar_url;
      const missingBio = !profile.bio;
      const missingVehicles = !profile.total_vehicles || profile.total_vehicles === 0;
      if (missingAvatar || missingBio || missingVehicles) {
        const missing: string[] = [];
        if (missingAvatar) missing.push('profile photo');
        if (missingBio) missing.push('bio');
        if (missingVehicles) missing.push('vehicles');
        return `Complete your profile: add ${missing.join(', ')}`;
      }
    }

    // 2. Active auctions
    const activeListings = comprehensiveData?.listings?.filter(
      (l: any) => l.status === 'active' || l.auction_status === 'live'
    ) || [];
    if (activeListings.length > 0) {
      return `${activeListings.length} active auction${activeListings.length > 1 ? 's' : ''} right now`;
    }

    // 3. Reputation milestone
    const rep = profile.reputation_score;
    if (rep && rep > 0) {
      if (rep >= 1000) return 'Legendary community member';
      if (rep >= 500) return 'Highly respected contributor';
      if (rep >= 100) return 'Active community participant';
      return `Building reputation: ${rep} points`;
    }

    // 4. Collection summary
    const vehicles = profile.total_vehicles || 0;
    const listed = stats?.total_listings || 0;
    if (vehicles > 0) {
      return `${vehicles} vehicle${vehicles > 1 ? 's' : ''} in collection${listed > 0 ? `, ${listed} listed` : ''}`;
    }

    // 5. Recent activity
    const since = formatMemberSince(profile.member_since || profile.created_at);
    if (since) {
      return `Active member since ${since}`;
    }

    return null;
  }, [profile, isOwnProfile, stats, comprehensiveData]);

  // ── Stat pills ──

  const pills = useMemo(() => {
    if (!profile) return [];

    const items: { label: string; value: string | number }[] = [];

    if (profile.total_vehicles != null && profile.total_vehicles > 0) {
      items.push({ label: 'VEHICLES', value: profile.total_vehicles });
    }

    if (profile.contribution_count != null && profile.contribution_count > 0) {
      items.push({ label: 'CONTRIBUTIONS', value: profile.contribution_count });
    }

    if (profile.reputation_score != null && profile.reputation_score > 0) {
      items.push({ label: 'REPUTATION', value: profile.reputation_score });
    }

    const memberSince = formatMemberSince(profile.member_since || profile.created_at);
    if (memberSince) {
      items.push({ label: 'MEMBER SINCE', value: memberSince });
    }

    const auctions = stats?.total_auction_wins || 0;
    if (auctions > 0) {
      items.push({ label: 'AUCTIONS', value: auctions });
    }

    return items;
  }, [profile, stats]);

  // Self-guard
  if (!headline && pills.length === 0) return null;

  return (
    <div className="up-briefing">
      {headline && (
        <div className="up-briefing__headline">{headline}</div>
      )}
      {pills.length > 0 && (
        <div className="up-briefing__pills">
          {pills.map(pill => (
            <span key={pill.label} className="up-stat-pill">
              {pill.value}
              <span className="up-stat-pill__label">{pill.label}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default UserBriefing;
