/**
 * UserWorkspaceContent — Two-column layout container for user profile.
 * Mirrors vehicle-profile/WorkspaceContent.tsx pattern.
 *
 * Left column: dossier, collection, track record, activity, comments/bids, etc.
 * Right column: gallery, reputation, knowledge library, live player.
 */
import React, { useState, useCallback } from 'react';
import { CollapsibleWidget } from '../../components/ui/CollapsibleWidget';
import { useUserProfile } from './UserProfileContext';

// Lazy-load all card components
const UserTodayCard = React.lazy(() => import('./UserTodayCard'));
const UserDossierPanel = React.lazy(() => import('./UserDossierPanel'));
const UserBriefing = React.lazy(() => import('./UserBriefing'));
const UserConnectionStateStrip = React.lazy(() => import('./UserConnectionStateStrip'));
const UserActivityFeed = React.lazy(() => import('./UserActivityFeed'));
const ColumnDivider = React.lazy(() => import('../vehicle-profile/ColumnDivider'));

// Existing profile components
const VehicleCollection = React.lazy(() => import('../../components/profile/VehicleCollection'));
const PublicAuctionTrackRecord = React.lazy(() => import('../../components/profile/PublicAuctionTrackRecord'));
const UserDiscoveries = React.lazy(() => import('../../components/profile/UserDiscoveries'));
const ProfileCommentsTab = React.lazy(() =>
  import('../../components/profile/ProfileCommentsTab').then(m => ({ default: m.ProfileCommentsTab }))
);
const ProfileBidsTab = React.lazy(() =>
  import('../../components/profile/ProfileBidsTab').then(m => ({ default: m.ProfileBidsTab }))
);
const ProfileListingsTab = React.lazy(() =>
  import('../../components/profile/ProfileListingsTab').then(m => ({ default: m.ProfileListingsTab }))
);
const ProfileSuccessStoriesTab = React.lazy(() =>
  import('../../components/profile/ProfileSuccessStoriesTab').then(m => ({ default: m.ProfileSuccessStoriesTab }))
);
const OrganizationAffiliations = React.lazy(() => import('../../components/profile/OrganizationAffiliations'));
const ProfessionalToolbox = React.lazy(() => import('../../components/profile/ProfessionalToolbox'));
const VehicleMergeInterface = React.lazy(() => import('../../components/vehicle/VehicleMergeInterface'));

// Right column
const UserReputationWidget = React.lazy(() => import('./UserReputationWidget'));
const PublicImageGallery = React.lazy(() => import('../../components/profile/PublicImageGallery'));
const KnowledgeLibrary = React.lazy(() => import('../../components/profile/KnowledgeLibrary'));
const LivePlayer = React.lazy(() => import('../../components/profile/LivePlayer'));
const MemelordPanel = React.lazy(() => import('../../components/profile/MemelordPanel'));

const DEFAULT_LEFT_PCT = 38;

const UserWorkspaceContent: React.FC = () => {
  const {
    userId,
    profile,
    isOwnProfile,
    stats,
    comprehensiveData,
    activityEvents,
    session,
  } = useUserProfile();

  const [leftPct, setLeftPct] = useState(DEFAULT_LEFT_PCT);
  const handleResize = useCallback((pct: number) => setLeftPct(pct), []);
  const handleReset = useCallback(() => setLeftPct(DEFAULT_LEFT_PCT), []);

  if (!userId && !profile) return null;

  const hasListings = comprehensiveData?.listings && comprehensiveData.listings.length > 0;
  const hasTrackRecord = stats && stats.total_listings > 0;
  const hasComments = comprehensiveData?.comments && comprehensiveData.comments.length > 0;
  const hasBids = comprehensiveData?.bids && comprehensiveData.bids.length > 0;
  const hasCommentsOrBids = hasComments || hasBids;
  const hasListingsTab = hasListings;
  const hasSuccessStories = comprehensiveData?.success_stories && comprehensiveData.success_stories.length > 0;
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

          {/* Today — live mirror of what's happening RIGHT NOW (own profile) */}
          <React.Suspense fallback={null}>
            <UserTodayCard />
          </React.Suspense>

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

          {/* Vehicle Collection */}
          {userId && (
            <React.Suspense fallback={null}>
              <VehicleCollection userId={userId} isOwnProfile={isOwnProfile} />
            </React.Suspense>
          )}

          {/* User Discoveries */}
          {userId && (
            <React.Suspense fallback={null}>
              <UserDiscoveries userId={userId} isOwnProfile={isOwnProfile} />
            </React.Suspense>
          )}

          {/* Activity Feed */}
          <React.Suspense fallback={null}>
            <UserActivityFeed />
          </React.Suspense>

          {/* Organization Affiliations */}
          {userId && (
            <React.Suspense fallback={null}>
              <OrganizationAffiliations userId={userId} isOwnProfile={isOwnProfile} />
            </React.Suspense>
          )}

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

          {/* Public Auction Track Record */}
          {hasTrackRecord && (
            <React.Suspense fallback={null}>
              <PublicAuctionTrackRecord
                listings={comprehensiveData?.listings || []}
                loading={!comprehensiveData}
                profileName={profile?.full_name || profile?.username || null}
              />
            </React.Suspense>
          )}

          {/* Comments & Bids — merged card */}
          {hasCommentsOrBids && (
            <CollapsibleWidget variant="profile" title="Comments & Bids" defaultCollapsed={false}>
              <React.Suspense fallback={null}>
                {hasComments && (
                  <ProfileCommentsTab
                    comments={comprehensiveData?.comments || []}
                    profileType="user"
                  />
                )}
                {hasBids && (
                  <ProfileBidsTab
                    bids={comprehensiveData?.bids || []}
                    profileType="user"
                  />
                )}
              </React.Suspense>
            </CollapsibleWidget>
          )}

          {/* Listings */}
          {hasListingsTab && (
            <React.Suspense fallback={null}>
              <CollapsibleWidget variant="profile" title="Listings" defaultCollapsed={true}>
                <ProfileListingsTab
                  listings={comprehensiveData?.listings || []}
                  profileType="user"
                />
              </CollapsibleWidget>
            </React.Suspense>
          )}

          {/* Success Stories */}
          {hasSuccessStories && (
            <React.Suspense fallback={null}>
              <CollapsibleWidget variant="profile" title="Success Stories" defaultCollapsed={true}>
                <ProfileSuccessStoriesTab
                  stories={comprehensiveData?.success_stories || []}
                  profileType="user"
                />
              </CollapsibleWidget>
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

          {/* Public Image Gallery — always */}
          {userId && (
            <React.Suspense fallback={null}>
              <PublicImageGallery userId={userId} isOwnProfile={isOwnProfile} />
            </React.Suspense>
          )}

          {/* Reputation Scores */}
          <React.Suspense fallback={null}>
            <UserReputationWidget />
          </React.Suspense>

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
