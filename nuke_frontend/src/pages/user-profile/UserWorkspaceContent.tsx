/**
 * UserWorkspaceContent — Two-column layout container for user profile.
 * Mirrors vehicle-profile/WorkspaceContent.tsx pattern.
 *
 * Left column: dossier, collection, track record, activity, comments/bids, etc.
 * Right column: gallery, reputation, knowledge library, live player.
 */
import React, { useState, useCallback } from 'react';
import { useUserProfile } from './UserProfileContext';

// Lazy-load all card components
const UserDossierPanel = React.lazy(() => import('./UserDossierPanel'));
const UserBriefing = React.lazy(() => import('./UserBriefing'));
const UserConnectionStateStrip = React.lazy(() => import('./UserConnectionStateStrip'));
const UserActivityFeed = React.lazy(() => import('./UserActivityFeed'));
const ColumnDivider = React.lazy(() => import('../vehicle-profile/ColumnDivider'));

// Existing profile components
// REMOVED per founder teardown (PROFILE_BUILD_ORDER 2026-06-13):
//  - UserTodayCard: the "you have an update" notification card ("a flaw and bad
//    design … I don't trust it"). Freshness is shown natively by the timeline.
//  - UserDiscoveries (FOUND/SOURCES + discovered marketplace vehicles): not his
//    built work, unclickable metrics ("I can't click them so I'm never gonna
//    find out what they are"); maker-controls-the-arc — discovered ≠ built.
//  - OrganizationAffiliations (Epstein Collection / Desert Performance / Taylor
//    Customs / FBM / Ernies): data is correct but not wanted on the profile face
//    ("I don't want those showing up"). Data is untouched; only the render is gone.
const VehicleCollection = React.lazy(() => import('../../components/profile/VehicleCollection'));
const ProfessionalToolbox = React.lazy(() => import('../../components/profile/ProfessionalToolbox'));
const VehicleMergeInterface = React.lazy(() => import('../../components/vehicle/VehicleMergeInterface'));

// Data-viz widgets (2026-06-10 overhaul) — every one self-guards to null on
// empty data per the no-empty-shells rule, so no hasX gating needed here.
// Replaced/deleted: PublicAuctionTrackRecord + ProfileCommentsTab/BidsTab/
// ListingsTab (queried tables that don't exist in prod; BaT widget reads
// bat_listings + auction_comments directly), ProfileSuccessStoriesTab
// (success_stories table doesn't exist), UserReputationWidget (all inputs
// nonexistent columns — rendered empty bars forever).
const UserWorkLedger = React.lazy(() => import('./UserWorkLedger'));
const UserBatTrackRecord = React.lazy(() => import('./UserBatTrackRecord'));
const UserMoneyFlow = React.lazy(() => import('./UserMoneyFlow'));

// Right column
const UserRecentPhotos = React.lazy(() => import('./UserRecentPhotos'));
const KnowledgeLibrary = React.lazy(() => import('../../components/profile/KnowledgeLibrary'));
const LivePlayer = React.lazy(() => import('../../components/profile/LivePlayer'));
const MemelordPanel = React.lazy(() => import('../../components/profile/MemelordPanel'));

const DEFAULT_LEFT_PCT = 38;

const UserWorkspaceContent: React.FC = () => {
  const {
    userId,
    profile,
    isOwnProfile,
  } = useUserProfile();

  const [leftPct, setLeftPct] = useState(DEFAULT_LEFT_PCT);
  const handleResize = useCallback((pct: number) => setLeftPct(pct), []);
  const handleReset = useCallback(() => setLeftPct(DEFAULT_LEFT_PCT), []);

  if (!userId && !profile) return null;

  const isNotBasicUser = profile?.user_type && profile.user_type !== 'user';

  return (
    <div>
      <div
        className="up-columns"
        style={{
          position: 'sticky',
          top: 'var(--up-sticky-top)',
          height: 'calc(100vh - var(--up-sticky-top))',
        }}
      >
        {/* LEFT COLUMN */}
        <div className="up-col-left" style={{ width: `${leftPct}%` }}>

          {/* Briefing — intelligence headline + stat pills */}
          <React.Suspense fallback={null}>
            <UserBriefing />
          </React.Suspense>

          {/* Connection State Strip — data-source CTAs (owner-only, primary IA per doctrine §2a) */}
          <React.Suspense fallback={null}>
            <UserConnectionStateStrip />
          </React.Suspense>

          {/* Dossier — grouped field display */}
          <React.Suspense fallback={null}>
            <UserDossierPanel />
          </React.Suspense>

          {/* Vehicle Collection — owned/built garage. Anchor target for the
              header's WORKED ON door. */}
          {userId && (
            <div id="vehicle-collection">
              <React.Suspense fallback={null}>
                <VehicleCollection userId={userId} isOwnProfile={isOwnProfile} />
              </React.Suspense>
            </div>
          )}

          {/* Work Ledger — the decade of wrenching (work_sessions substrate) */}
          {userId && (
            <React.Suspense fallback={null}>
              <UserWorkLedger userId={userId} isOwnProfile={isOwnProfile} />
            </React.Suspense>
          )}

          {/* Activity Feed */}
          <React.Suspense fallback={null}>
            <UserActivityFeed />
          </React.Suspense>

          {/* Professional Toolbox — owner-only, non-basic users */}
          {isOwnProfile && isNotBasicUser && userId && (
            <React.Suspense fallback={null}>
              <ProfessionalToolbox userId={userId} isOwnProfile={isOwnProfile} />
            </React.Suspense>
          )}

          {/* ── DEMOTED: BaT-bidder cards (IA assessment Step E) ────────────
              These cards are flavored for collectors who arrived via BaT.
              Kept (not deleted) but moved below the producer-flavored
              surfaces so they don't dominate the first screen for
              technician-producer users like Skylar. */}

          {/* BaT Track Record — reads bat_listings + auction_comments
              directly (replaces the vehicle_events-derived card that found
              1 of 5 sales, and absorbs the old Comments tab). */}
          {userId && (
            <React.Suspense fallback={null}>
              <UserBatTrackRecord userId={userId} />
            </React.Suspense>
          )}

          {/* Money Flow — owner-only inside the component (visitors: null) */}
          {userId && (
            <React.Suspense fallback={null}>
              <UserMoneyFlow userId={userId} isOwnProfile={isOwnProfile} />
            </React.Suspense>
          )}

          {/* Vehicle Merge Interface — owner-only */}
          {isOwnProfile && (
            <React.Suspense fallback={null}>
              <VehicleMergeInterface />
            </React.Suspense>
          )}
        </div>

        {/* COLUMN DIVIDER */}
        <React.Suspense fallback={<div style={{ width: '4px', flexShrink: 0 }} />}>
          <ColumnDivider onResize={handleResize} onReset={handleReset} />
        </React.Suspense>

        {/* RIGHT COLUMN */}
        <div className="up-col-right" style={{ width: `${100 - leftPct}%` }}>

          {/* Recent Photos — true totals, lazy thumbs, day click-through */}
          {userId && (
            <React.Suspense fallback={null}>
              <UserRecentPhotos userId={userId} isOwnProfile={isOwnProfile} />
            </React.Suspense>
          )}

          {/* Knowledge Library / Live Player / Memelord Panel — disabled 2026-05-24
              per docs/library/working/field-notes/2026-05-24_safety-audit-completion.md §1:
              - KnowledgeLibrary's service (referenceDocumentService.ts) is gutted —
                every method throws "not deployed" or returns [].
              - LivePlayer has hard-coded kill switch (LIVE_ADMIN_ENABLED = false).
              - MemelordPanel renders but is permanently empty for current users.
              All three were rendered without required userId/isOwnProfile props,
              causing the right-column crash the audit observed. Re-enable when
              services come back online; pass userId={userId} isOwnProfile={isOwnProfile} then. */}
        </div>
      </div>
    </div>
  );
};

export default UserWorkspaceContent;
