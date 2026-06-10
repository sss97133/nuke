/**
 * UserBriefing — Intelligence headline + stat pills.
 * Mirrors VehicleBriefing pattern.
 *
 * Priority order for headline:
 * 1. Onboarding prompt (own profile, missing data)
 * 2. Active auctions count
 * 3. Collection summary
 * 4. Recent activity summary
 * 5. null (don't render)
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

    // Garage-wide vehicle count comes from profile_stats (via stats), NOT the
    // nonexistent profiles.total_vehicles column (always undefined at runtime).
    const vehicles = stats?.total_vehicles ?? 0;

    // 1. Onboarding prompt
    if (isOwnProfile) {
      const missingAvatar = !profile.avatar_url;
      const missingBio = !profile.bio;
      const missingVehicles = vehicles === 0;
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

    // 3. Collection summary
    const listed = stats?.total_listings || 0;
    if (vehicles > 0) {
      return `${vehicles} vehicle${vehicles > 1 ? 's' : ''} in collection${listed > 0 ? `, ${listed} listed` : ''}`;
    }

    // 4. Recent activity
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

    // profile_stats-backed counts (profiles.total_vehicles / contribution_count /
    // reputation_score are not real columns — never read them).
    if (stats?.total_vehicles != null && stats.total_vehicles > 0) {
      items.push({ label: 'VEHICLES', value: stats.total_vehicles });
    }

    if (stats?.total_contributions != null && stats.total_contributions > 0) {
      items.push({ label: 'CONTRIBUTIONS', value: stats.total_contributions });
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
