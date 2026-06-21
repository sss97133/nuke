# `/u/:handle` First-Screen IA Assessment

**Date**: 2026-05-24
**Status**: Working paper — assessment + gap analysis + concrete proposals. No code changed.
**Predicate**: `docs/library/technical/design-book/frontend-doctrine.md` §2a amendment (user binding is primary container).
**Trigger**: Skylar 2026-05-24 — *"user profile is paramount... it's the first inflection point for all future users."*

---

## TL;DR

The `UserProfile.tsx` + `pages/user-profile/` component tree is **far more built** than I or the prior frontend audit credited (2,048 LOC across 10 components, mirroring the VehicleProfile convergence pattern). The architectural skeleton for "user profile as primary container" already exists. The gaps are not in *structure* — they are in (a) **substrate flavor** (current components were designed around BaT-bidder data, not Skylar-as-technician data), (b) **multi-vehicle daily activity** (no `/u/:handle/day/:date` lens binding yet), (c) **data-source connection UX** (no obvious "connect iCloud / Gmail / bank" surface for new users), and (d) **new-user empty-state safety** (most components conditionally render only if data exists — but a stranger logging in today gets a sparse and confusing surface).

This paper does not propose new code. It maps what exists, names the gaps against Skylar's stated wedge, and proposes the smallest changes to make the existing structure load-bearing.

---

## 1. What Exists Today (Verified by Code Read)

### Routes
- `/profile` — current user's own profile
- `/profile/:userId` — specific user profile (UUID-keyed; not handle-keyed)
- `/profile/external/:externalIdentityId` — external identity (BaT username, etc.) profile

The doctrine names the canonical surface as `/u/:handle`. Current implementation uses `/profile/:userId` with UUIDs. Handle-based URLs (`/u/skylar`) do not exist yet — that's a router change, not a component change.

### Component Tree (`nuke_frontend/src/pages/user-profile/`)
```
UserProfile.tsx                       (73 LOC, orchestrator)
└── UserProfileContext.tsx            (328 LOC, data provider)
    ├── UserHeader.tsx                (182 LOC, sticky)
    ├── UserSubHeader.tsx             (66 LOC, badge bar)
    ├── UserBarcodeTimeline.tsx       (354 LOC, sticky)
    ├── UserWorkspaceContent.tsx      (238 LOC, two-column)
    │   ├── LEFT COLUMN
    │   │   ├── UserBriefing            ("intelligence headline + stat pills")
    │   │   ├── UserDossierPanel        ("grouped field display")
    │   │   ├── VehicleCollection       (vehicles tied to user)
    │   │   ├── PublicAuctionTrackRecord (only if has listings)
    │   │   ├── UserDiscoveries
    │   │   ├── UserActivityFeed
    │   │   ├── Comments & Bids (merged, only if has any)
    │   │   ├── Listings (only if has listings)
    │   │   ├── Success Stories (only if has any)
    │   │   ├── OrganizationAffiliations
    │   │   ├── ProfessionalToolbox (owner-only, non-basic)
    │   │   └── VehicleMergeInterface (owner-only)
    │   └── RIGHT COLUMN
    │       ├── PublicImageGallery (always)
    │       ├── UserReputationWidget
    │       ├── KnowledgeLibrary (owner-only)
    │       ├── LivePlayer (owner-only)
    │       └── MemelordPanel (owner-only)
    └── UserSettingsDrawer.tsx        (334 LOC, opens via custom event)
```

### Substrate That Today's Components Read From
- `profileService` — basic profile fields
- `profileStatsService.getUserProfileData` — comprehensive data (listings, comments, bids, success_stories)
- `profileStatsService.getPublicProfileByExternalIdentity` — external identity path
- `PersonalPhotoLibraryService` — photo library stats
- Direct supabase calls for `auth.users`, `organization_contributors`, `vehicles`

### Skylar's Live Substrate (Verified 2026-05-24)
| Substrate | Count for Skylar |
|---|---:|
| Photos uploaded by him personally | **20,752** |
| Receipts owned | **2,430** |
| Distinct vehicles via receipts | **22** |
| Distinct vendors via receipts | **1,237** |
| Organization memberships | **8** |
| Tools indexed | **130** |
| Tools with serials populated | **0** ⚠️ |

Skylar IS a rich-substrate user. The existing UserProfile can read most of this if pointed at his UUID `0b9f107a-d124-49de-9ded-94698f63c1c4`.

---

## 2. The Four Gaps Between What Exists and What the Wedge Needs

### Gap 1 — Substrate Flavor: BaT-bidder Default vs Technician-Producer

The left column's marquee components — `PublicAuctionTrackRecord`, `Comments & Bids`, `Listings`, `Success Stories` — are all *BaT-bidder-flavored*. They render when a user has BaT auction history. Skylar's `skylarwilliams` handle has 1-2 BaT sales (the 1932 Hot Rod + the 1995 Suburban per his context file), so some of this will render, but it's not the load-bearing surface for him. **His load-bearing data is photos, receipts, vehicles touched-as-steward, work logs, and tool usage** — and there's no card surfacing that combination as the headline.

**Verified 2026-05-24 — `UserActivityFeed.tsx` BADGE_MAP confirms the flavor problem concretely:**
```typescript
const BADGE_MAP: Record<string, string> = {
  listing: 'LISTING',
  bid: 'BID',
  auction_win: 'WIN',
  comment: 'COMMENT',
};
```
That's the entire activity-event taxonomy in this component. **It does not recognize** `image_upload`, `work_session`, `receipt`, `vehicle_added`, `timeline_event` — yet `UserBarcodeTimeline` queries exactly those types from the same `contributionEvents` array. The Feed and the Timeline are reading the same substrate but the Feed only renders the BaT-bidder subset. For Skylar, this means: heatmap shows green squares for his 20,752 photo uploads, but the activity feed below it shows "no activity." Doesn't render those events.

**Concrete fix (Step E.1, ~15 min):** extend `BADGE_MAP` in `UserActivityFeed.tsx` to include the producer-side event types. ~5 LOC change. Doesn't add features; closes a flavor-coverage gap.

**Consequence without fix:** Skylar's profile today probably looks like "a bidder with very little activity," when his actual story is "a technician who has documented 22 vehicles across 20,752 photos."

### Gap 2 — Multi-Vehicle Daily Activity: Navigation Exists, Detail-Surface Doesn't

Per the amended doctrine §3, `/u/:handle/day/:date` is the canonical user-pivoted daily view. The closest analogue is the vehicle-pivoted `/journal/:date` (broken in production — see plumbing audit).

**Verified 2026-05-24:** `UserBarcodeTimeline.tsx` (354 LOC) **IS the day-pivoted navigation surface.** GitHub-style contribution heatmap reading `contributionEvents` from `UserProfileContext`, with filters for ALL / PHOTOS (`image_upload`) / VEHICLES (`vehicle_added` + `timeline_event`) / AUCTIONS (`auction_activity`) / COMMENTS (`comment`). Cross-vehicle. Multi-modality. It's the seed of this lens.

**What's missing:** click-on-day-cell → day-detail-surface. The heatmap cells render but don't deep-link to a `/u/:handle/day/:date` route — because that route doesn't exist yet. The day-detail surface (the multi-vehicle work log) is the gap; the navigation primitive is built.

**The actual unblock:** ship the day-detail surface as a binding of `/u/:handle/day/:date` (or a drawer that opens over the user profile), wire `UserBarcodeTimeline` cell click → route/drawer-open, and the day-pivoted multi-vehicle view goes live with one round-trip.

### Gap 3 — Data-Source Connection UX Exists But Is Hidden in the Drawer

For a new user, the system's value depends entirely on what data they let it see. Skylar's framing: *"the user has a lot of chance to connect other services by api so wed need to make that easy for users with simple visualques etc."*

**Verified 2026-05-24:** `UserSettingsDrawer.tsx` already imports `ConnectedPlatforms` (from `components/bidding/`) and `SocialConnections` (from `components/profile/`). The connector primitives exist. **They are hidden behind the `up:open-settings` custom event** — a new user has no way to discover them without explicit guidance. The first-screen on `/u/:handle` for a new user should hoist these out of the drawer (or surface their state) so connection CTAs are visible without clicking into settings. **The component work is partially done; the IA exposure is missing.**

### Gap 4 — Empty-State Safety for New Users

Per Skylar 2026-05-24: *"the biggest error would be to just make a big mess of users data."* Most existing components use conditional render gates (`hasListings && ...`, `hasComments && ...`) — meaning a new user with no data sees a left column that's mostly empty. That's not unsafe (no data mess), but it IS confusing. A first-screen for a new user should be **certain to render something coherent and actionable**, not a sparse column of conditionally-hidden cards.

The `UserBriefing` ("intelligence headline + stat pills") is presumably the always-render component. Its quality on a new user with zero data is the single most important UX question — and I haven't read it yet.

---

## 3. New-User First-Screen Hierarchy Proposal

Given the existing architecture and the four gaps, here's a proposed first-screen hierarchy for `/u/:handle` when the visitor is the profile owner. **In order, above the fold:**

1. **UserHeader** — identity (avatar, name, primary org affiliation, location). Already exists.
2. **Connection State Strip** — *new component, ~150 LOC.* A horizontal row of pills showing data-source state: "iCloud Photos: not connected · Gmail: not connected · Bank (Plaid): not connected · Snap-On: not connected · 1 of 4 connected." Each pill is a CTA. Click → settings drawer opens to that connector. **This is the most important new component for new-user IA.** Without it the platform looks dead on first land.
3. **UserBriefing** — the intelligence headline. For a new user with zero data, it should say: *"You've connected 0 sources. Connect iCloud Photos to see your vehicle history. Connect Gmail to ingest receipts. Connect bank to map expenses."* For Skylar specifically: *"22 vehicles, 20,752 photos, $X across 2,430 receipts, 8 orgs. Today: K10 engine teardown, 4 photos, K5 alternator receipt."*
4. **UserBarcodeTimeline** — sticky activity scrubber. Skylar can drill to any day; new user sees their connection-to-now span.

**Below the fold, conditional on data:**

5. **Today's day-episode** (binding of `/u/:handle/day/:today` — Gap 2). Multi-vehicle. Lazy-loads only if there's any activity today.
6. **VehicleCollection** — already exists.
7. **OrganizationAffiliations** — already exists.
8. **PublicAuctionTrackRecord, Comments & Bids, Listings** — keep but demote from marquee position. These are BaT-bidder-flavored and matter for some users (collectors who came in via BaT) but should not dominate.
9. **ProfessionalToolbox** — already exists, owner-only.
10. **UserReputationWidget** — right column, always.
11. **PublicImageGallery** — right column, always (the photo fingerprint).

**Above all of this, for new users specifically:** a **lightweight onboarding header** ("3 steps to make your profile useful: connect → wait for backfill → see your first day-episode"). Collapses to a "show me again" link once dismissed.

---

## 4. Smallest Path from Today to Wedge-Ready

In effort order:

### A. Router change — add handle-based URLs (~30 min)
- `/u/:handle` resolves to UserProfile via username/handle lookup, in addition to `/profile/:userId` (keep both during migration).
- Forward link from existing surfaces.

### B. Connection State Strip component (~2 hours — revised down)
- New file `pages/user-profile/UserConnectionStateStrip.tsx`.
- Renders a row of pills for: iCloud Photos, Gmail, Bank (Plaid), Snap-On, Manual Upload.
- Each pill knows its connector's status (connected, partially connected, not connected, error).
- Click → opens UserSettingsDrawer at the relevant connector tab via `window.dispatchEvent(new Event('up:open-settings'))`.
- **Connector primitives already exist** — `ConnectedPlatforms` (bidding/) and `SocialConnections` (profile/) are imported by `UserSettingsDrawer.tsx`. The Strip just queries their connection state and renders status pills. No new connector logic needed.
- This is THE highest-leverage IA addition for new-user safety.

### C. Briefing redesign for empty state and Skylar-flavor (~2 hours)
- `UserBriefing.tsx` (146 LOC) is read-and-improve target.
- Default for new user: connection CTAs first.
- Default for owner with data: today's activity headline + connection completeness.
- Default for visitor viewing another's profile: contribution-derived headline ("Documented 22 vehicles since 2024, 20,752 photos, primary domain: GM trucks 1967-91").

### D. `/u/:handle/day/:date` lens binding (~4 hours)
- New file `pages/user-profile/UserDayEpisode.tsx`.
- Calls `project_work_log` (per amended doctrine §3 + journal plumbing audit) with `(user_id, date)` instead of `(vehicle_id, date)`.
- **Substrate prerequisite**: `project_work_log` must accept user-scoped queries. Today it takes `vehicle_id, date`. Adding `user_id, date` to the tool is an `mcp-connector` change — small, no new edge function. Captured in journal-plumbing audit.

### E. Demote BaT-bidder cards (~1 hour)
- `UserWorkspaceContent.tsx`: move `PublicAuctionTrackRecord`, `Comments & Bids`, `Listings`, `Success Stories` BELOW `UserDayEpisode` and `VehicleCollection`.
- Keep them. Don't delete. They're correct for bidder-flavored users.

### F. (Optional, later) Delete the 96-pages-problem profile orphans
- `nuke_frontend/src/pages/SubjectProfile.tsx` and any other `*Profile.tsx` orphans not used by the canonical UserProfile binding.
- Per doctrine §6, every new binding deletes/merges an old one.

**Total estimated effort: ~10 hours** to take the existing UserProfile from "sophisticated but bidder-flavored" to "load-bearing primary container, new-user safe." None of it requires new edge functions or schema migrations. All of it is surgical frontend work on existing components.

---

## 5. What This Paper Does NOT Propose

- Any code change (paper is design + assessment only).
- Any schema migration (substrate is sufficient for Steps A-E).
- Any new database tables (Hard Rule #2 honored).
- Any new edge functions (Hard Rule #1 honored).
- Any touching of `vehicles` or `vehicle_images` (agent 72093's lane).
- Any deletion of profile components (preserve all; only re-order).

## 6. What Skylar Needs to Decide

1. **Approve the handle-based URL** (`/u/:handle`) or keep UUID-only (`/profile/:userId`).
2. **Approve Connection State Strip as the highest-priority new component** for new-user safety, or name a different priority.
3. **Approve the day-episode user-pivoted variant** to be added to `project_work_log` (small substrate change in `mcp-connector`).
4. **Greenlight the demotion** of BaT-bidder cards from the marquee position (not deletion — re-order).
5. **Confirm the new-user empty-state behavior**: connection CTAs first, vs onboarding wizard, vs minimal "your profile is ready, add data" placeholder.

Once these are decided, Steps A-E are ~10 hours of surgical frontend work. The journal plumbing fix (separate audit) is ~30 min and unblocks the day-episode binding from being able to render anything at all.

---

*Assessment complete. No code modified. No deploys. No DDL. Awaiting Skylar's review.*
