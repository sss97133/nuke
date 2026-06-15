/**
 * UserBriefing — Intelligence headline + stat pills.
 * Mirrors VehicleBriefing pattern.
 *
 * Priority order for headline (each fact appears exactly ONCE — tenet 2):
 * 1. Onboarding prompt (own profile, missing data) — unique to briefing
 * 2. Active auctions count — unique to briefing
 * 3. null (don't render)
 *
 * Collection summary ("N worked on, N listed") and "member since" headlines
 * were REMOVED: the header already carries WORKED ON / LISTINGS pills and a
 * "SINCE {year}" meta line. Restating them here was the redundancy Skylar
 * flagged (PROFILE_BUILD_ORDER #9). The briefing now adds only what the header
 * lacks.
 *
 * Self-guarding: returns null if no headline AND no stats.
 */
import React, { useMemo } from 'react';
import { useUserProfile } from './UserProfileContext';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const UserBriefing: React.FC = () => {
  const { profile, isOwnProfile, stats, comprehensiveData } = useUserProfile();

  // ── Headline ──

  const headline = useMemo(() => {
    if (!profile) return null;

    // Worked-on count (vehicles_count = distinct vehicles with real activity),
    // NOT total_vehicles (record-authorship, ~half scraped — number doctrine).
    const vehicles = stats?.vehicles_count ?? 0;

    // 1. Onboarding prompt — unique to the briefing (header has no such call).
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

    // 2. Active auctions — unique, time-sensitive (header shows totals, not live).
    const activeListings = comprehensiveData?.listings?.filter(
      (l: any) => l.status === 'active' || l.auction_status === 'live'
    ) || [];
    if (activeListings.length > 0) {
      return `${activeListings.length} active auction${activeListings.length > 1 ? 's' : ''} right now`;
    }

    // Collection-summary and member-since headlines removed: pure restatement of
    // header WORKED ON / LISTINGS pills and the "SINCE {year}" meta (tenet 2).
    return null;
  }, [profile, isOwnProfile, stats, comprehensiveData]);

  // ── Stat pills ──

  const pills = useMemo(() => {
    if (!profile) return [];

    const items: { label: string; value: string | number }[] = [];

    // CONTRIBUTIONS is the ONLY stat the header doesn't already carry, so it's
    // the only pill the briefing keeps. WORKED ON, MEMBER SINCE (header meta
    // "SINCE {year}"), and AUCTIONS (header "AUCTIONS WON") were removed —
    // each was a verbatim restatement of a header fact (tenet 2: every fact
    // appears exactly once). PROFILE_BUILD_ORDER #9.
    if (stats?.total_contributions != null && stats.total_contributions > 0) {
      items.push({ label: 'CONTRIBUTIONS', value: stats.total_contributions });
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
