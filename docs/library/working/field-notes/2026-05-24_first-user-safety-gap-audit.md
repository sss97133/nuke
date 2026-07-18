# First-Real-User Safety Gap Audit

**Date**: 2026-05-24
**Status**: Field note — report only, no code changed.
**Trigger**: Skylar 2026-05-24 — *"how fast can we get a real user online and functioning without grave mistakes taking place. the biggest error would be to just make a big mess of users data."*

---

## The Question, Sharpened

"How fast can we onboard a real user without grave mistakes" decomposes into two questions:
1. **What breaks if a stranger logs in to nuke.ag today?** (UX failures, broken pages, confusing empty states.)
2. **What could go wrong with their data?** (Loss, corruption, mis-attribution, privacy leaks, irreversible writes.)

This audit answers both. Failures are grouped by severity per the project's `.claude/ISSUES.md` convention.

---

## Audit Method

Walked the production-reachable routes from `DomainRoutes.tsx`. For each, asked:
- Does the page render with no data?
- Does the page write to the substrate on first interaction?
- Are user-data writes idempotent / reversible?
- What's the worst plausible outcome of a first-session click?

---

## Findings

### CRITICAL — `/journal/:date` is 404 broken in production
- **Source:** `2026-05-24_journal-page-assessment.md`
- **Details:** Vercel rewrite to nonexistent `mailbox` edge function. Page loads, calls `/api/journal/:date`, shows "ERROR · fetch failed: 404."
- **Risk to user data:** None (no writes — purely a read endpoint).
- **Risk to first impression:** Severe. PROJECT_STATE.md frames this as the first public projection surface. If a new user follows any link to it, they see a broken page.
- **Fix:** Options A/B/C in `2026-05-24_journal-plumbing-audit.md`. Recommended: Option C (~15 LOC change).
- **Status:** OPEN

### CRITICAL — 46 orphan pages in `nuke_frontend/src/pages/`
- **Source:** 2026-05-24 frontend audit
- **Details:** 96 pages on disk, ~50 mounted, ~46 orphaned or redundant. Many are half-built (mocked data, placeholder TODOs). Any internal link that points to an orphan path will dead-end.
- **Risk to user data:** None directly.
- **Risk to first impression:** High. Stale internal links land on broken pages.
- **Fix:** Doctrine §6 (deletion gate) is now in place. Audit + delete in the next FE session. Not blocking onboarding, but accumulates trust tax.
- **Status:** OPEN

### HIGH — No "connect data source" surface on user profile
- **Source:** `2026-05-24_user-profile-ia-assessment.md` Gap 3
- **Details:** New user lands on `/profile` and sees a sparse two-column layout. There is no obvious affordance to connect iCloud Photos, Gmail, bank, or any other source. Without data, the platform is dead-on-first-impression.
- **Risk to user data:** None directly.
- **Risk to first impression:** Severe — user bounces because they can't tell what to do.
- **Fix:** Step B in the IA assessment (Connection State Strip component, ~3 hours).
- **Status:** OPEN

### HIGH — UserProfile defaults to UUID-keyed URL, not handle-keyed
- **Source:** `2026-05-24_user-profile-ia-assessment.md` §1
- **Details:** `/profile/:userId` uses raw UUIDs. Shareable links look like `/profile/0b9f107a-d124-49de-9ded-94698f63c1c4`. Hostile UX.
- **Risk to user data:** None.
- **Risk to first impression:** Medium-high. Users sharing profiles get ugly URLs.
- **Fix:** Step A in IA assessment (handle-based router lookup, ~30 min).
- **Status:** OPEN

### LOW (downgraded from HIGH 2026-05-24 follow-up) — `ingest-observation` write path is the only safe ingestion door
- **Source:** `.claude/rules/agent-trust-invariants.md`; `feedback_agent_under_skylar_writes_through_ingest_observation.md`
- **Details:** Doctrine says ALL new observations flow through `ingest-observation` with entity resolution. Original concern: a frontend "upload photo" button writing directly to `vehicle_images` would bypass supersession/lineage.
- **Verification 2026-05-24:** Grep `\.from\(['"](vehicle_observations|vehicle_images|vehicle_events|auction_comments|vehicle_timeline|vehicle_aliases)['"]\)\.(insert|upsert|update|delete)` across `nuke_frontend/src` — **zero matches.** The frontend does not write directly to testimony tables. Writes go through edge functions / RPCs that enforce the invariants. Risk downgraded.
- **Status:** VERIFIED — no direct testimony writes in frontend.

### HIGH (upgraded from MEDIUM 2026-05-24 follow-up) — Photo ingestion attribution risk
- **Source:** `feedback_wrong_attribution_forks_not_hides.md`, `feedback_photo_density_is_ownership_signal.md`
- **Details:** If a new user uploads a photo that the vision pipeline attributes to the wrong vehicle, the rule is "fork, don't hide." But the user-facing UX for the fork (creating a ghost vehicle when the upload is ambiguous) is non-trivial. Without explicit confirm-UX, a misattribution is silent.
- **Risk to user data:** Real — wrong attribution corrupts both the source user's profile AND the wrong vehicle's history.
- **Verification 2026-05-24** (`2026-05-24_safety-audit-completion.md` §2): Traced the path end-to-end. Central `ImageUploadService` is safe (no `vehicleId` → stores `suggested_vehicle_id` only, never auto-assigns). Risk is concentrated in **`UniversalImageUpload.tsx:333-353` `handleUploadAll`** — directly inserts to `vehicle_images` with `vehicle_id` from `session.manualVehicleId || session.suggestedVehicle?.id`, where the suggestion may be 60-70% confidence (GPS proximity match or recent-work-history fallback). No threshold gate; user can override but if they accept the default suggestion the write is silent. Secondary risk: `image-intake` edge function `index.ts:400-441` writes `status='matched'` at 0.7-0.79 confidence band via `findVehicle()` hints. Confirm-UI **does** exist — `components/profile/TechInbox.tsx` (788 LOC) is designed for this — but it's ONLY mounted in legacy `pages/Profile.tsx` / `Profile.legacy.tsx`, NOT in the canonical `pages/user-profile/UserWorkspaceContent.tsx` tree. Upgraded HIGH because the misattribution path is live and the safety surface is orphaned.
- **Fix:** Two changes per audit completion §2: (a) gate `UniversalImageUpload.handleUploadAll` so confidence < 90 + no `manualVehicleId` requires explicit "Confirm vehicle for session" dialog, (b) mount a TechInbox-equivalent into `UserWorkspaceContent.tsx` left column as a photo-review queue.
- **Status:** OPEN — VERIFIED HIGH (specific call site identified, fix is surgical, ~1-2 hours)

### MEDIUM — Empty-state cards make profile look "dead" for new users
- **Source:** `2026-05-24_user-profile-ia-assessment.md` Gap 4 + `.claude/rules/frontend.md` "No Empty Shells" rule
- **Details:** Most components conditionally render only if data exists. A user with zero data sees an extremely sparse left column. The `frontend.md` rule says return null if empty — which is correct, but the *absence* of any compensating "what now?" surface (Gap 3 above) makes the page look dead rather than incomplete.
- **Risk to user data:** None.
- **Risk to first impression:** Severe (compounds Gap 3 above).
- **Fix:** Connection State Strip + Briefing redesign (Steps B, C in IA assessment).
- **Status:** OPEN

### MEDIUM — Cancel-mid-flight on photo OCR/vision could orphan records
- **Source:** `nuke_frontend/src/pages/user-profile/UserProfileContext.tsx` reads `PersonalPhotoLibraryService`
- **Details:** Long-running photo processing (vision-gate + receipt OCR) writes intermediate state to multiple tables. A user closing the browser mid-process or revoking access mid-upload could leave half-written observations.
- **Risk to user data:** Limited — testimony is permanent by invariant, but the user's *expectation* might be "I cancelled, nothing should have been written." Mismatch between user mental model and substrate behavior.
- **Fix:** Either (a) write a clear status surface "even cancelled uploads kept what we extracted so far, here's what was kept," or (b) atomic ingestion (write all or nothing per upload session).
- **Status:** OPEN, needs design

### HIGH (upgraded from LOW 2026-05-24 follow-up) — `LivePlayer`, `MemelordPanel`, `KnowledgeLibrary` have render-site prop bug + 2 of 3 are dead-deployed features
- **Source:** `UserWorkspaceContent.tsx` lines 215-231
- **Details:** Three owner-only components in the right column. Not audited for completeness in this pass. If they error on render, the right column breaks for owners only.
- **Risk to user data:** None.
- **Risk to first impression:** Limited to owners. New users don't see these.
- **Verification 2026-05-24** (`2026-05-24_safety-audit-completion.md` §1): All three components have **required** props (`userId: string`, and `isOwnProfile: boolean` on two of them) but `UserWorkspaceContent.tsx:227, 234, 241` renders them as `<KnowledgeLibrary />`, `<LivePlayer />`, `<MemelordPanel />` with no props. Owner-only render path → crash or degraded state on every owner profile load (Skylar is the only current owner). No ErrorBoundary wraps the right column; render error escapes to `AuthErrorBoundary`. Component status: **LivePlayer** is dead-deployed — `liveService.ts:18` has `const LIVE_ADMIN_ENABLED = false`; underlying `live-admin` edge function exists on disk (Mux integration) but is comment-labeled CORS-broken. **MemelordPanel** works fine, depends on `content_action_events` table (migrations 20251215190000-194000 confirm the table is defined). For Skylar, empty: "Total: 0 · No activity yet." **KnowledgeLibrary** is gutted — every method in `referenceDocumentService.ts` either `throw new Error('Reference documents feature is not deployed')` (lines 74, 149, 344, 376, 395, 440) or returns `[]` (lines 195, 221). The `index-service-manual` edge function it would call doesn't exist on disk. Upgraded HIGH because owner profile crash is a direct first-real-user-self-test blocker AND it violates platform-hygiene rule §10 ("Do NOT leave dead feature code deployed").
- **Fix:** Either (a) pass `userId={userId} isOwnProfile={isOwnProfile}` to all three call sites + wrap in ErrorBoundary, OR (b) remove all three from the right column entirely (2 of 3 are undeployed; MemelordPanel is empty for Skylar). Per platform-hygiene, option (b) is more honest.
- **Status:** OPEN — VERIFIED HIGH (render-site bug confirmed, dead-feature deployment confirmed)

### LOW — Settings drawer event coupling
- **Source:** `UserProfile.tsx` line 16-17, comment about `up:open-settings` event
- **Details:** UserSettingsDrawer opens via a custom event. Tight coupling pattern; if the emitter isn't on the page, the drawer never opens.
- **Risk to user data:** None.
- **Risk to first impression:** Low.
- **Fix:** Refactor to props/context-based open state if it causes friction.
- **Status:** OPEN

---

## The "Minimum Safe Onboarding Path"

A new user can sign up and log in **today** with minimal risk to their data, because:
- The substrate's trust invariants (`agent-trust-invariants.md`) prevent silent deletion or overwrite.
- All testimony tables are append-only with supersession.
- The `ingest-observation` write path enforces entity resolution.

But a new user **cannot have a useful first experience today**, because:
- The first projection surface (`/journal/:date`) is broken.
- There is no obvious "connect a source" affordance.
- The profile looks dead without data.
- The photo-confirm UX for attribution forks doesn't exist.

**The five things that have to be true for a "real user without grave mistakes" demo:**

1. **`/u/:handle` resolves a real human-readable URL.** Step A of IA assessment.
2. **Connection State Strip is on the first screen** with one-click connectors. Step B.
3. **`UserBriefing` is honest about empty state** and points the user at next action. Step C.
4. **One projection surface works end-to-end** (`/journal/:date` OR `/u/:handle/day/:date`). Plumbing audit, Option C.
5. **Photo upload requires confirm-UX below confidence threshold** to prevent silent misattribution. New component, not yet designed.

Items 1-4 are ~7-10 hours of surgical frontend work plus the journal plumbing fix (~30 min). Item 5 is a design + implementation task of unknown effort (probably ~5-10 hours).

**Realistic "first real user" milestone: ~20-30 focused hours from today.** None of that requires new edge functions, new tables, or new substrate. All of it is surgical frontend + one tiny `mcp-connector` extension to accept `user_id` scope on `project_work_log`.

---

## What This Audit Did NOT Do

- ~~Grep frontend for direct writes to testimony tables (Finding 5 needs verification).~~ **VERIFIED 2026-05-24 inline above.**
- ~~Audit `LivePlayer`, `MemelordPanel`, `KnowledgeLibrary` for completeness.~~ **VERIFIED 2026-05-24** — see `2026-05-24_safety-audit-completion.md` §1. Render-site prop bug + 2 of 3 are dead-deployed. Upgraded to HIGH.
- ~~Audit the photo upload code path end-to-end for confirm-UX gaps.~~ **VERIFIED 2026-05-24** — see `2026-05-24_safety-audit-completion.md` §2. `UniversalImageUpload.tsx:333-353` writes silently from 60-70% suggestions. TechInbox orphaned in legacy `Profile.tsx`. Upgraded to HIGH.
- ~~Test the actual onboarding flow as a stranger (requires a clean session).~~ **VERIFIED 2026-05-24** — see `2026-05-24_safety-audit-completion.md` §3. Pre-signup is a sign-in nag. OnboardingSlideshow mounted in wrong place (post-auth, with logged-out CTAs). Post-signup lands at Garage not Profile. Severity HIGH (first-real-user blocker).
- ~~Read `UserSettingsDrawer.tsx` to know what connectors exist vs are stubbed.~~ **VERIFIED 2026-05-24** — see `2026-05-24_safety-audit-completion.md` §4. 9 auction platforms + X (live) + 4 social stubs. iCloud/Gmail/Bank/Snap-On named in IA assessment **do not exist**. Severity MEDIUM (not a safety blocker but Connection State Strip will reference invented identities if not grounded).

**Completion field note:** `docs/library/working/field-notes/2026-05-24_safety-audit-completion.md`

---

*Audit complete. No code modified. No deploys. No data touched. All findings are reports, not fixes.*
