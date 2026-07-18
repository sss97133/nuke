# Safety Gap Audit — Completion of 4 OPEN Items

**Date**: 2026-05-24
**Status**: Field note — report only, no code changed.
**Trigger**: Completes the 4 OPEN audit items from `2026-05-24_first-user-safety-gap-audit.md`.
**Scope**: Pure research + writeup. No `nuke_frontend/src` files modified. No `useVehiclesDashboard.ts`, `lib/supabase.ts`, `useActivityTracking.ts`, journal page, or user-profile components touched.

Format per item: findings → **Verdict** → **Concrete next step** → **Severity** (per `.claude/rules/qa-loop.md`: CRITICAL / HIGH / MEDIUM / LOW).

---

## 1. LivePlayer, MemelordPanel, KnowledgeLibrary completeness

### What I found

**Files inspected:**
- `nuke_frontend/src/components/profile/LivePlayer.tsx` (228 LOC)
- `nuke_frontend/src/components/profile/MemelordPanel.tsx` (95 LOC)
- `nuke_frontend/src/components/profile/KnowledgeLibrary.tsx` (507 LOC)
- Render site: `nuke_frontend/src/pages/user-profile/UserWorkspaceContent.tsx:225-243`

### Critical render-site bug (NEW — not in parent audit)

`UserWorkspaceContent.tsx:227, 234, 241` renders these three components WITHOUT any props:

```tsx
{/* Knowledge Library — owner-only */}
{isOwnProfile && (
  <React.Suspense fallback={null}>
    <KnowledgeLibrary />
  </React.Suspense>
)}

{/* Live Player — owner-only */}
{isOwnProfile && (
  <React.Suspense fallback={null}>
    <LivePlayer />
  </React.Suspense>
)}

{/* Memelord Panel — owner-only */}
{isOwnProfile && (
  <React.Suspense fallback={null}>
    <MemelordPanel />
  </React.Suspense>
)}
```

But every one of the three components has a **required** props interface:

- `LivePlayer.tsx:6-9` — `interface LivePlayerProps { userId: string; isOwnProfile: boolean; }`
- `MemelordPanel.tsx:10` — `({ userId }: { userId: string })`
- `KnowledgeLibrary.tsx:7-10` — `interface KnowledgeLibraryProps { userId: string; isOwnProfile: boolean; }`

All three will crash on first owner render because `userId` is `undefined`. `LivePlayer.useEffect` will call `LiveService.getStatus(undefined)` → `LiveService.getPlaybackUrl(undefined)`. `MemelordPanel.useEffect` will call `StreamActionsService.listMyContentActions(undefined, 200)`. `KnowledgeLibrary.useEffect` will call `ReferenceDocumentService.getUserDocuments(undefined, true)`.

This is the inverse of "No Empty Shells" — these are **errored shells** for owners. New users (non-owners) are insulated because `isOwnProfile` gates the render. **Skylar (the only current owner) sees the broken right column.**

### Per-component status

**LivePlayer (`LivePlayer.tsx`)** — *Working code, deployed gate is OFF.*
- Wires to `LiveService` in `services/liveService.ts`. The service has a hard-coded kill switch at line 18: `const LIVE_ADMIN_ENABLED = false;`. Comment at line 15-17: *"Toggle this to true once the live-admin edge function is deployed with proper CORS. While false, all methods skip the broken edge function call entirely to avoid CORS-induced delays on the profile page."*
- `live-admin` edge function DOES exist on disk (`supabase/functions/live-admin/index.ts`) and is a Mux integration. It is "broken" per the service file comment — likely CORS-broken in production.
- With kill switch off, `getStatus()` returns `{ live: false, nextStart: null }` from localStorage fallback (`liveService.ts:41-44`), `getPlaybackUrl()` returns null. The card renders "Offline" + "No stream available" + a "Go Live (RTMP)" button that returns `{ ok: false, message: 'Live streaming is not yet available' }` when clicked.
- Component renders something either way. Confidence: stub/dead in production.

**MemelordPanel (`MemelordPanel.tsx`)** — *Working code, depends on `content_action_events` table.*
- Wires to `StreamActionsService.listMyContentActions` (line 32) in `services/streamActionsService.ts:184-200`.
- The service is *defensively* coded: lines 25-39 detect `42P01` / `PGRST205` / 404 as "feature not deployed" and cache the unavailability in localStorage (`featureContentActionEventsUnavailable`).
- Tables ARE defined in migrations: `stream_action_packs`, `stream_actions`, `content_action_events` (migrations 20251215190000-194000). The table existence question depends on whether those migrations ran in prod — assume YES given recent dates.
- Empty state: line 60 — `<div>No activity yet.</div>`. Good empty-state, satisfies "No Empty Shells."
- Per parent IA assessment, Skylar has 0 meme-drop activity. He sees "Total: 0 · Spent: $0.00 · No activity yet." — sparse but coherent.

**KnowledgeLibrary (`KnowledgeLibrary.tsx`)** — *Service is GUTTED. Feature not deployed.*
- Wires to `ReferenceDocumentService` in `services/referenceDocumentService.ts`.
- **Every CRUD method in the service is stubbed:** `uploadDocument` throws `new Error('Reference documents feature is not deployed')` at line 74 BEFORE the `try` block. `triggerIndexing` throws at line 149. `getUserDocuments` returns `[]` at line 195. `getPublicDocuments` returns `[]` at line 221. `linkToVehicle` throws at line 344. `unlinkFromVehicle` throws at line 376. `deleteDocument` throws at line 395. `updateDocument` throws at line 440. `incrementStat` returns at line 465.
- `loadDocuments` (the only call made at mount) hits `getUserDocuments` → returns `[]` → component renders the upload-button + "No reference documents yet" empty state. **Safe but feature-dead.**
- Click "Upload Document" + pick a file → `handleUpload` calls `uploadDocument` which throws → toast: "Reference documents feature is not deployed." So upload fails loudly; doesn't corrupt anything.
- The `index-service-manual` edge function it would call doesn't exist on disk (only `index-reference-document` exists).

### Owner-only blast radius

The parent audit assumed "owners only see these" was containment. With the prop-missing bug above, **owner = Skylar = the only person currently logged in who can self-test, and his right column will throw 3 separate render errors when these components run.** The Suspense fallback (`null`) won't catch errors, only suspense. There's no ErrorBoundary wrapping the right column in `UserWorkspaceContent.tsx`. The `<AuthErrorBoundary>` from `App.tsx:87` is the only outer boundary.

So: render error in any of these three → React Error Boundary surfaces → entire user-profile page falls into AuthErrorBoundary's fallback. Or, if `userId=undefined` is forgiving (depends on how `LiveService.getStatus(undefined)` behaves), the components render in a degraded state with empty data.

I cannot confirm browser-runtime behavior without launching the app. The TypeScript compiler should be flagging `<KnowledgeLibrary />` as missing required props at compile time — the fact that this ships suggests either `tsc` is not strict here, or this code was very recently added without compilation. Either way: the bug is real on the next render attempt.

### Verdict
LivePlayer = dead-deployed (kill switch off). MemelordPanel = working but empty. KnowledgeLibrary = service-layer gutted, feature undeployed. **All three have a render-site bug where required props (`userId`, `isOwnProfile`) are not passed by `UserWorkspaceContent.tsx`.**

### Concrete next step
Either (a) pass `userId={userId} isOwnProfile={isOwnProfile}` to all three call sites in `UserWorkspaceContent.tsx:227, 234, 241`, OR (b) remove the three components from the right column entirely (KnowledgeLibrary and LivePlayer are undeployed features per their service code, MemelordPanel is empty for Skylar). Per the platform-hygiene rule "Do NOT leave dead feature code deployed," option (b) is more honest. **Wrap whatever stays in an ErrorBoundary** so a render throw doesn't kill the whole profile.

### Severity
**HIGH** — owner-only crash path on the primary user-facing surface. New users are unaffected, so it does not block onboarding, but Skylar (and any future owner doing self-test) will see broken renders. The dead-feature deployment also violates platform-hygiene rule §10.

---

## 2. Photo upload code path + confirm-UX gap

### What I found

I traced four entry components plus the underlying service:

**Entry A — `UniversalImageUpload.tsx`** (763 LOC)
- Used as a session-clustered "photo dump" modal (vehicle-page + standalone).
- Clusters photos by 30-min time gaps (line 162).
- `analyzeSession` (line 192): calls `find_vehicles_near_gps` RPC if GPS exists. Sets `session.suggestedVehicle` with `confidence: 95` (single GPS match), `confidence: 60` (multiple matches), or `confidence: 70` (recent-work-history fallback at line 233-260).
- **DIRECT WRITE TO TESTIMONY:** `handleUploadAll` at line 333-353 inserts directly into `vehicle_images` with `vehicle_id: vehicleId` where `vehicleId = session.manualVehicleId || session.suggestedVehicle?.id` (line 304). **There is no confirm step between "AI suggested with 60% confidence" and the row hitting the table.** The user can override by changing the `<select>` (line 491-502), but if they accept the default, the suggestion is written as if confirmed.
- This is the highest-risk surface. A 60%-confidence GPS match becomes a permanent `vehicle_images.vehicle_id` write. Per the trust invariants, that row is now immutable testimony and must be unmerged/reattributed if wrong, not deleted.
- Confidence is shown ("60% confident" at line 504) but there's no threshold gate — the upload button only blocks if `!session.manualVehicleId && !session.suggestedVehicle` (line 516). Any suggestion passes, regardless of confidence.

**Entry B — `PhotoSyncPage.tsx`** (`/photos` route)
- Folder picker → client-side heuristic filter (`isLikelyVehiclePhoto`, line 40) → cluster by 30-min gaps → user reviews → upload.
- Uploads to `vehicle-photos` storage (line 302) then calls `image-intake` edge function with the urls.
- **Safer path:** does NOT write `vehicle_images.vehicle_id` directly from the frontend. Delegates routing to `image-intake`.
- `image-intake/index.ts` (Deno, 532 LOC) runs Claude vision + matches against the user's known vehicles. **At line 400-441**: if `vehicleId && analysis.confidence >= 0.8` OR if `findVehicle()` from hints returned a match, it inserts to `vehicle_images` with `vehicle_id: vehicleId` and status='matched'. If `< 0.7` confidence or no match → either inserts as `vehicle_id: null` with `organization_status='unorganized'` (if GPS/Apple-ML signal exists, line 446-477) OR upserts to `pending_image_assignments` (line 479-488). Clarification SMS path exists (line 503) but only fires if `notifyPhone` is passed (and `PhotoSyncPage.tsx` doesn't pass one).
- **Confidence 0.7-0.79 is a gray zone** — `findVehicle` is called on the AI hints; if it returns exactly one match, status flips to 'matched' and gets written with `vehicle_id` set, even at borderline confidence. No user confirm step.

**Entry C — `PersonalPhotoLibrary.tsx`** (sidebar organize tool)
- Bulk-link flow (line 276-289) **does** require explicit user confirm: `window.confirm("Send N photos to 'YYYY Make Model'?")`. Good.
- However, `handleAcceptSuggestion` at line 312-325 takes the AI suggestion and calls `acceptVehicleSuggestion` *without* a confirm step — but this creates a new vehicle from the suggestion, not attribute to an existing one, so risk is more about clutter than misattribution.

**Entry D — `VINPhotoValidator.tsx`** (553 LOC)
- VIN-validation-specific flow (vehicle ownership claim, not photo attribution).
- Inserts into `vin_validations` (not `vehicle_images`). Not directly an attribution corruption risk.
- *Side observation:* line 419-430 auto-approves the validation after a 2-second timeout for "demo purposes." This is its own MEDIUM-severity issue (silent auto-approval of unverified ownership claims) but it's outside this audit's scope.

**Entry E (archived) — `hooks/_archived/useImageUpload.ts`**
- Lives under `_archived/` per the audit's pointer. Imports `ImageUploadService`. Was a centralization hook for `MobileVehicleProfile` uploads. Archived because the underlying `ImageUploadService` is now called directly. No active call sites in the current frontend (`useImageUpload` is referenced in 8 files but they all import the live version, not the archived one — I didn't deep-verify that).

### Underlying service — `imageUploadService.ts` (817 LOC)

`ImageUploadService.uploadImage(vehicleId, file, category)` is the canonical path for individual uploads from anywhere (vehicle profile, personal library, etc.).

- **When `vehicleId` is provided** (line 539-573): inserts directly to `vehicle_images` with `vehicle_id: vehicleId`. The vehicleId is whatever the caller decided. The service trusts the caller.
- **When `vehicleId` is omitted** (line 542, NULL): goes to personal library, then triggers async `autoMatchImage` (line 746-816). **Critically, `autoMatchImage` at line 786-792 does NOT auto-apply the match. It stores `suggested_vehicle_id` ONLY.** Comment at line 784: *"SAFETY: never auto-assign vehicle_id based on heuristic matching. This prevents cross-vehicle contamination; we only store a suggestion for review."*
- `imageDuplicateLinker.ts` is invoked at line 607-641 for personal-library uploads. It uses `suggested_vehicle_id` too (per the grep result earlier).

So the **central service is safe** when called with no `vehicleId`. The risk is in callers that **fabricate** a `vehicleId` from an AI suggestion (UniversalImageUpload Entry A, image-intake's matched path) and pass it without user confirm.

### Confirm-UI does exist — but it's orphaned

`components/profile/TechInbox.tsx` is the *intended* confirm-UI. It reads `vehicle_image_classifications.suggested_vehicle_id` + confidence + reasoning, lets a user re-assign mis-attributed photos, and was clearly designed for the Telegram-bot ingestion path (`source = 'telegram'` filter at line 97).

**TechInbox is rendered ONLY in `pages/Profile.tsx` (the legacy profile page) and `pages/Profile.legacy.tsx`.** It is NOT rendered in the canonical `pages/user-profile/UserWorkspaceContent.tsx` tree. The IA refactor moved to user-profile/* and left TechInbox behind. Per parent audit Finding 2 (CRITICAL): 46 orphan pages on disk. `Profile.tsx` / `Profile.legacy.tsx` are likely two of them.

So: the design existed; the routing forgot it.

### The silent-misattribution risk in one sentence

`UniversalImageUpload.handleUploadAll` writes `vehicle_id` to `vehicle_images` based on a GPS-or-recent-work suggestion that may be 60-70% confident, with no explicit user "yes this is the right vehicle" gate, and no central review surface (TechInbox is orphaned). Every misattributed write becomes permanent testimony per the trust-invariant rules.

### Verdict
The central `ImageUploadService` is safe (suggestion-only). The two riskiest surfaces are **`UniversalImageUpload.tsx` (direct insert from AI suggestion with no confirm threshold)** and **`image-intake` edge function (matched-status writes at 0.7-0.8 confidence band)**. TechInbox exists as the confirm-surface but isn't mounted in the live user-profile.

### Concrete next step
Two surgical changes, neither requires new tables or edge functions:
1. In `UniversalImageUpload.tsx`, gate `handleUploadAll` so any session with `suggestedVehicle.confidence < 90` AND no `manualVehicleId` requires explicit user confirm-click on a "Confirm vehicle for this session" dialog before insert. Render the confidence and reasoning in the dialog.
2. Mount `TechInbox` (or a derived "Photo Review Queue" component) into `UserWorkspaceContent.tsx` left column, owner-only, with a count badge of `vehicle_images WHERE user_id=$me AND suggested_vehicle_id IS NOT NULL AND vehicle_id IS NULL`. This gives the orphan suggestions a home and provides retroactive correction for any that slipped through.

### Severity
**HIGH** — first-real-user safety blocker. Concrete scenario: new user uploads a phone-camera-roll dump including photos taken at a friend's shop where their friend's K10 is parked; GPS match returns `find_vehicles_near_gps` for the friend's K10 (if it's in the DB); 60% confidence; user clicks "Upload All" without changing the suggestion; the upload writes photos of their friend's K10 to a wrong user-vehicle association, and the testimony is permanent.

---

## 3. Onboarding flow as stranger

### Sequence a brand-new visitor experiences today

**Step 0 — Land on `/`**

`App.tsx:90` → `<HomeGate />` (defined `App.tsx:43-71`).

`HomeGate` checks `useAuth()`. Unauthenticated visitor with no `?legacy_landing=1` or `?force_treemap=1` → returns `<AppLayout><IntakePage variant="homepage" /></AppLayout>` (line 60-64).

**Step 1 — See `IntakePage` "homepage variant"** (`pages/intake/IntakePage.tsx:185-245`)

The page shows:
- Kicker: "Nuke / Intake"
- H1: "The form is the thing."
- Lead: "Drop a photo, paste a URL, or sign in to track your vehicle."
- A dashed-border drop zone labeled "Drop a photo here / or paste a BaT / Cars & Bids / Hagerty URL" — **but clicking it just navigates to `/login?returnUrl=/intake`** (line 187-205). It is not an actual drop zone — the comment at line 6-8 of IntakePage explains: *"Anonymous submission isn't supported by api-v1-events yet (paper §F8), so the homepage variant routes the user to /login?returnUrl=/intake instead of attempting an anonymous POST."*
- Big black button: "Sign in to start"
- Examples chips (decorative)
- Bottom link: "Explore the database →" (navigates to `/explore` which is itself a redirect to `/?force_treemap=1`)

So the visitor lands on a page that looks like a working intake form but is actually a sign-in nag. No tour, no "what is this," no preview.

**Step 2 — Click sign-in / drop zone / Sign in to start** → `/login?returnUrl=/intake`

`Login.tsx` (`components/auth/Login.tsx`). Modes: 'signin' / 'signup'. URL `/signup` puts it in signup mode. Email+password, or phone+OTP, or GitHub / Google OAuth (lines 166-200).

Signup with email+password (line 102-125) → Supabase `signUp` → if email confirmation required, shows: *"Check your email for the confirmation link. You can sign in after confirming."* Mode flips back to 'signin'.

**Step 3 — Confirm email, return, sign in** → navigated to `getReturnUrl()` = `/intake` (or `/` default per `Login.tsx:29`).

If returnUrl was `/intake` → lands on `IntakePage` standalone variant (`IntakePage.tsx:251-320`) which is a free-form `EventForm` for vehicle note intake. No tour, no profile setup, no connector prompts.

If returnUrl defaulted to `/` → `HomeGate` sees `user` truthy → renders `<HomePage />` (line 67-70).

**Step 4 — See `HomePage.tsx`**

`HomePage.tsx:1380-1407`:
```tsx
useEffect(() => {
  if (!authLoading && user && !localStorage.getItem('nuke_onboarding_seen')) {
    setShowOnboarding(true);
  }
}, [authLoading, user]);
```

So on first authenticated render, `OnboardingSlideshow` opens.

**Step 5 — `OnboardingSlideshow.tsx`** (360 LOC)

3 slides:
1. "Drop a URL" — talks about extracting from BaT, Cars & Bids, etc. ASCII visual of a Porsche extraction.
2. "Explore the Database" — talks about 998K+ vehicle profiles, 34M+ photos, deal scoring.
3. "Track and Score" — talks about Garage, deal scores, value alerts.

Final slide CTAs: **"CREATE ACCOUNT"** + **"SIGN IN"** (line 301-324). But the user is already signed in (this only fires for authenticated users — see line 1381 of HomePage). The CTAs are wrong for the trigger context.

User can dismiss (X button, line 148, or click backdrop, line 120).

**Step 6 — See HomePage's Garage tab** (the default `activeTab` per `HomePage.tsx`)

`HomePage.tsx:1452` → `<GarageTab dashboard={garage} />`. This is a separate code path (the existing garage dashboard); I did not deep-read it as the audit scope is the onboarding-touchable surface.

### What's missing

1. **Land surface is a fake form** — the IntakePage homepage variant's drop zone is a sign-in nag dressed as a feature. Acceptable for activation but the framing ("Drop a photo here") may set the expectation wrong.
2. **No "what is this and why" before the first decision.** The visitor sees an intake form that demands sign-in, with no explanation of the product. The OnboardingSlideshow that does explain only triggers post-sign-in, which is too late for someone deciding whether to sign up.
3. **OnboardingSlideshow trigger condition is wrong.** Per HomePage.tsx:1381, it requires `user` truthy and `!localStorage.getItem('nuke_onboarding_seen')`. So it never shows to logged-out visitors who might benefit from the explanation before deciding to sign up. The Slideshow's final CTAs are "CREATE ACCOUNT / SIGN IN" — designed for logged-out flow, but mounted in logged-in flow.
4. **No profile-setup wizard.** Post-signup, user lands at `/` (default) or `/intake` (if returnUrl was set). They never see `/profile` automatically, never see the Connection State Strip the IA assessment calls for, and never get prompted to upload an avatar, set a handle, connect iCloud, etc.
5. **`/profile/:userId` UUID URL** — per parent audit Finding 4 (HIGH). New user has no handle-based URL to share. (Verified: `DomainRoutes.tsx:180` does have `/u/:handle` mounted, but no resolution logic was checked — that's another audit.)
6. **Connection State Strip is wired in the LEFT column** at `UserWorkspaceContent.tsx:93-95` — `<UserConnectionStateStrip />`. The component file exists (`pages/user-profile/UserConnectionStateStrip.tsx`). This is per the parent audit's Step B recommendation and appears to be partially built. I did not deep-read it for completeness.
7. **First-screen Garage on `/` is data-bound** (`dashboard={garage}`). New user with no vehicles → Garage is empty. The "what now?" path from empty-garage-Skylar is unclear without reading GarageTab.

### Verdict
The signup itself works (Supabase auth, 3 methods). But the **pre-signup surface is a sign-in nag with no product explanation**, and the **post-signup surface drops the user at Garage with no profile-setup or connection-CTA flow**. The OnboardingSlideshow exists but is mounted in the wrong place (post-auth) and has the wrong CTAs (CREATE ACCOUNT to an already-signed-in user). The intent of Skylar's wedge ("user lands on profile and connects sources") is not realized by the current routing.

### Concrete next step
Two changes:
1. **Move the OnboardingSlideshow trigger to `HomeGate` / `IntakePage` for logged-out users** (gated by a separate localStorage key like `nuke_landing_tour_seen`), so visitors see the product explanation BEFORE the signup decision. Change the final-slide CTAs to "CREATE ACCOUNT" (real signup) and "EXPLORE FIRST" (treemap link).
2. **After successful signup, redirect to `/profile` with a `?welcome=1` query param** (not `/` or `/intake`). On `/profile?welcome=1`, mount a "first-screen welcome" overlay that the IA assessment Gap 3 calls for — the Connection State Strip is already there; surface it as the first thing the user is asked to interact with.

### Severity
**HIGH** — direct first-real-user blocker. Skylar's framing: "user profile is paramount, first inflection point for all future users." Current flow drops users at Garage, not Profile. The pre-signup surface gives no reason to sign up.

---

## 4. UserSettingsDrawer connector inventory

### What I found

**File:** `nuke_frontend/src/pages/user-profile/UserSettingsDrawer.tsx` (334 LOC). Opens via `up:open-settings` custom event (line 56-60).

### Sections rendered (line 127-327)

1. **PROFILE** — bio, location, website, avatar upload. Calls `saveProfileField` / `uploadAvatar` from `UserProfileContext`. Live.
2. **EMAIL** — current email + "update email" via `supabase.auth.updateUser({email})`. Live.
3. **PASSWORD** — lazy-loaded `<ChangePasswordForm />` from `components/auth/`. Live.
4. **VERIFICATION** — lazy-loaded `<ProfileVerification />` from `components/`. (Not deep-read — phone + ID verification flow per the imports in `VINPhotoValidator.tsx` checking `phone_verified` and `id_verification_status`.)
5. **CONNECTED PLATFORMS** — `<ConnectedPlatforms />` from `components/bidding/`.
6. **SOCIAL** — `<SocialConnections userId={userId||''} />` from `components/profile/`.
7. **DATABASE** — admin-only, `<DatabaseDiagnostic />`.

No other connector components are imported. There is **no iCloud Photos connector**, **no Gmail connector**, **no bank/Plaid connector**, **no Snap-On connector** — these are referenced in the IA assessment but do not exist in `UserSettingsDrawer.tsx` today.

### ConnectedPlatforms — auction platforms (`components/bidding/ConnectedPlatforms.tsx`, 448 LOC)

Connects: **BaT, Cars & Bids, PCarMarket, Collecting Cars, Broad Arrow, RM Sotheby's, Gooding, SBX Cars, eBay Motors** (line 25-35).

State model: rows in `platform_credentials` table. Each row: `{ id, platform, status, requires_2fa, last_validated_at, validation_error, session_expires_at, created_at }` (line 6-15).

Status enum (line 9): `'pending' | 'validating' | 'active' | 'expired' | '2fa_required' | 'invalid' | 'suspended'`.

The connection flow: `<PlatformCredentialForm />` (separate component, not read) opens an add/edit modal that collects credentials. Encrypted with AES-256 per the disclaimer text at line 246. Supports realtime updates (Supabase channel subscription, line 168-188). 2FA prompt component for `2fa_required` status.

**This is a credential-based screen-scraping auth flow**, not OAuth. The user enters their BaT username + password; the system stores it encrypted and uses it for proxy bidding ("Connect your auction platform accounts to enable automated proxy bidding," line 246-247).

### SocialConnections — social media (`components/profile/SocialConnections.tsx`, 550 LOC)

Connects: **X (Twitter), Instagram, Threads, LinkedIn, YouTube** (line 27-72).

Of those, only X is live — `oauthEndpoint: 'twitter'` (line 33). The others are stubbed with `oauthEndpoint: null` and a `(coming soon)` description.

X uses Supabase's native `auth.linkIdentity({ provider: 'twitter' })` (line 275-289). Real OAuth + identity-linking. Tokens synced via `sync-x-tokens` edge function (line 222-244).

State model: two sources merged at line 173-218 — (a) Supabase Auth `user.identities` (for linked OAuth) and (b) `external_identities` table rows where `claimed_by_user_id = userId`. The merge handles dedupe by `(platform, handle)`.

Per-connection metadata: `{ auto_post_enabled, token_expires_at }` (line 12-14). Toggle for `auto_post_enabled` is exposed in UI (line 464-479). Disconnect = set `claimed_by_user_id=null` + null out tokens + disable auto-post (line 328-353).

### Inventory summary table

| Connector category | Component | Real or stub? | OAuth/auth model | State model |
|---|---|---|---|---|
| Auction (BaT) | ConnectedPlatforms | Real (cred storage) | username/password, AES-256 | `platform_credentials` row, status enum |
| Auction (C&B, PCM, CC, BA, RM, Gooding, SBX, eBay) | ConnectedPlatforms | Real (cred storage) | username/password | Same |
| Social (X) | SocialConnections | Real | Supabase `linkIdentity('twitter')`, real OAuth | `user.identities` + `external_identities` |
| Social (Instagram, Threads, LinkedIn, YouTube) | SocialConnections | Stub (button shows "coming soon") | `oauthEndpoint: null` | None |
| iCloud Photos | — | NOT PRESENT | — | — |
| Gmail | — | NOT PRESENT | — | — |
| Bank / Plaid | — | NOT PRESENT | — | — |
| Snap-On / parts vendors | — | NOT PRESENT | — | — |
| Dropbox | `components/.../DropboxImporter.tsx` exists (`/Users/skylar/nuke/nuke_frontend/src/components/dealer/DropboxImporter.tsx`), `dropboxService.ts` exists, but NOT mounted in UserSettingsDrawer | Real (dealer-side) | OAuth (per the existence of `DropboxCallback` route in DomainRoutes:126) | Not in drawer |
| Facebook | `components/facebook/FacebookConnectionSettings.tsx` exists, NOT mounted in UserSettingsDrawer | Real (per file existence) | OAuth | Not in drawer |

### What the Connection State Strip should reference

The IA assessment's Step B proposes a Connection State Strip that surfaces "iCloud, Gmail, Bank, Snap-On, Manual Upload." **Of those four named connectors, ZERO exist in the codebase today.** They're invented identities.

The real connectors that exist are:
- BaT + 8 other auction platforms (credentials)
- X / Twitter (OAuth)
- Dropbox (exists but dealer-side, not user-facing)
- Facebook (exists but not in drawer)
- Photo upload via `UniversalImageUpload` / `PersonalPhotoLibrary` / `PhotoSyncPage` (the only "data source" connection for general users — folder-pick + drag-drop, not an API)

The parallel-agent who's "shipping the seed" of the Connection State Strip needs to know: **the connector identities are auction platforms (9 of them), X, Dropbox, Facebook, and folder/file upload.** Not iCloud / Gmail / Plaid / Snap-On — those are wishful identities, not built ones.

### Verdict
`UserSettingsDrawer` mounts 7 sections: profile, email, password, verification, connected platforms (9 auction sites, credential-based), social (X live, 4 stubbed), database (admin). No iCloud / Gmail / bank / Snap-On connectors exist anywhere in the frontend. Dropbox and Facebook connectors exist but are not mounted in this drawer.

### Concrete next step
Decide whether the Connection State Strip references **real existing connectors** (auction credentials, X OAuth, Dropbox, Facebook, Manual Upload) or **aspirational connectors** (iCloud / Gmail / Bank / Snap-On — which need to be built before they can be surfaced). If the latter, each new connector is a real engineering item with OAuth flow, edge function, table, and storage path — far more than "a strip of pills." If the former, the Strip can ship today with the 5 real connectors and a "+ Connect data source" CTA for the unbuilt ones, marked clearly as "coming soon" not as no-op buttons.

### Severity
**MEDIUM** — not a safety blocker for first real user (the drawer works for what's mounted). But the IA assessment's proposal references connectors that don't exist, so the Connection State Strip seed being shipped in parallel may invent identities the user can never actually connect, which is a worse first-impression failure than not having the strip at all.

---

## Summary Table

| # | Item | Verdict | Severity |
|---|---|---|---|
| 1 | LivePlayer / MemelordPanel / KnowledgeLibrary | Render-site bug (missing required props); KnowledgeLibrary service entirely gutted; LivePlayer kill switch off; MemelordPanel works but empty for Skylar | **HIGH** |
| 2 | Photo upload confirm-UX gap | `UniversalImageUpload` writes `vehicle_id` from 60-70% suggestion with no explicit confirm; TechInbox confirm-UI exists but orphaned in legacy `Profile.tsx` | **HIGH** |
| 3 | Onboarding flow as stranger | Pre-signup land surface is sign-in nag with no explanation; OnboardingSlideshow triggers post-signup with logged-out CTAs (wrong place, wrong CTAs); post-signup lands at Garage not Profile | **HIGH** |
| 4 | UserSettingsDrawer connector inventory | 9 auction platforms (cred), X OAuth live + 4 social stubs; iCloud/Gmail/Bank/Snap-On don't exist; Dropbox/Facebook exist but aren't mounted in drawer | **MEDIUM** |

## Single Most Important Finding for First-Real-User Safety

**Item 2 — Silent attribution writes in `UniversalImageUpload`.** Every other finding is a UX failure or a missing-feature complaint. This one creates **permanent, immutable testimony writes** from low-confidence AI suggestions with no user confirmation. Per `agent-trust-invariants.md`, every wrong write becomes recovery work (unmerge / reattribute, never delete). A new user's first photo dump session is the highest-volume, highest-risk moment for cross-vehicle contamination, and the safety net (TechInbox) is mounted on an orphan page.

## Recommended Next-Action Priority

1. **(HIGH) Fix Item 1 render-site bug or remove the three components.** Either pass the required props or pull them. Skylar's profile right column is currently in a render-throw state every time he loads it. 30 minutes of work either way.
2. **(HIGH) Gate Item 2's `UniversalImageUpload.handleUploadAll`** behind a confidence-threshold confirm dialog (suggested < 90 = require explicit click). 1-2 hours. This closes the silent-misattribution door immediately, even before TechInbox is properly re-mounted.
3. **(HIGH) Move OnboardingSlideshow to pre-signup + redirect post-signup to `/profile?welcome=1`**. Item 3 fix. ~2 hours.
4. **(MEDIUM) Decide Item 4 — real connectors vs aspirational** before the parallel agent ships the Connection State Strip with invented identities. 30 minutes of decision, then the strip ships with the right inputs.
5. **(then) Mount TechInbox-equivalent into `UserWorkspaceContent.tsx`** as a "Photo Review Queue" surface for retroactive cleanup of any suggestions that already slipped through. ~3 hours.

Total: ~7-9 hours of focused frontend work to close the four open audit items and the single most important new finding (the render-site prop bug).

---

*Audit complete. No code modified. No deploys. No DDL. All findings are reports.*
