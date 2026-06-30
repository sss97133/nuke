# Blur — Feasibility Brief & Build Plan (iOS)

*A standalone consumer app, spun out of nuke. iOS-first; web is a link to the
App Store, nothing more.*

This document does two jobs at once, on purpose:

1. **Feasibility** — should we ship this, and what does "ship" actually cost?
2. **Build plan / scaffolding theory** — the concrete derivation that turns
   execution into *"fill in keys + access, separate the backend, press build."*

It was written after reading the actual code, not the pitch. Where the pitch
and the repo disagree, the repo wins (house rule: *the repo is not the pitch;
measure, don't guess*).

---

## 0. Verdict (TL;DR)

**Ship it as a TestFlight build first — it is unusually cheap because the two
hard halves already exist.** Blur is not a green-field app. It is the marriage
of two things nuke already owns:

- **The shell** — `apps/nuke-capture-ios`, a complete, App-Store-runbooked
  SwiftUI app (PhotoKit + Sign in with Apple + Supabase + background tasks +
  account deletion + privacy manifest).
- **The engine** — nuke's real deep-research fruit: an **image-intelligence
  system that groups a chaotic pile of photos by *entity*, finds the strays
  that belong, picks the hero shot, and scores quality** (see §2c). Built for
  vehicles; the product is that engine **generalized to any subject**.

The work is **generalize + re-skin + a privacy-correct backend**, not
invention.

| Question | Answer |
|---|---|
| Does the core tech exist? | **Yes** — both the shell and the organizing engine (§2). |
| Is there a standalone app today? | **No.** `apps/blur/` was empty before this doc; the capability lives inside the nuke monolith. |
| Biggest risk? | **Not** engineering. It's **product scope** (an org engine is bigger than a blur button) and **App Store 4.2** (§7). |
| Realistic time to TestFlight internal? | **~1–2 weeks** for the manual+Apple-seed cut; the AI clustering layer is the iterative part. |
| What does "done" reduce to? | A new Supabase project's keys in `Config.swift`, an Apple App ID, and the re-skin/generalize diffs in §5. |

---

## 1. What we are actually shipping (product definition)

> **Correction baked in:** the product is **passive AI photo organization**,
> not "an app that detects embarrassing photos." *Embarrassing* was one
> adjective; **any** attribute slots into the same machine. Blur is the
> *presentation* layer; **automatic organization is the product.**

The pitch, made precise:

> **Blur** organizes your photo library *for* you, passively, so you never go
> down the manual-tagging rabbit hole — and so that when you want to show
> someone *the* photo, you flip straight to the exact group with confidence
> instead of frantically scrolling 80,000 images and giving up.

The mechanism, in the user's own terms, as four layers:

1. **Seed from Apple's own tags (local, free, private).** Apple Photos already
   classifies on-device — smart albums, people/pets, places, scene/object
   tags. Read those (`PHAssetCollection`, PhotoKit + the **Vision framework**)
   as the *first* organization layer. Nothing leaves the phone.
2. **Layer passive AI organization on top, and persist it.** Cluster images
   into coherent **galleries by subject** ("my truck") and save the result.
   Done in the background so the user never organizes by hand.
3. **Learn the user's existing albums and make them better.** The user already
   has a "truck folder" but missed a handful of 80k shots. The app reads that
   album as ground truth and **finds the strays that belong** — completing the
   group the user started.
4. **Instant, confident retrieval (this is where "Blur" earns its name).**
   Flip directly to the exact group. Everything outside the focused group is
   **blurred/de-emphasized** — depth-of-field for your whole library — so
   there's no accidental over-share and no frantic scroll-and-give-up.

**Non-goals for v1** (so scope doesn't creep):
- No social/sharing graph, no feed, no cloud photo backup.
- No vehicle anything. This is a clean consumer cut of the engine.
- No Android (web = an App Store link per the directive).

### The business model — free local, paid automatic

The proposition splits exactly along the layer boundary in §1:

- **Free = local-first delivery.** The app, on-device organization, Apple-tag
  seeding, manual galleries, and the focus/blur retrieval — **free to download
  and use.** Nothing leaves the phone; no account required to get value. This
  *is* the delivery, and it's the acquisition engine.
- **Paid upgrade = automatic image handling.** The passive AI that does the
  work *for* you — auto-built galleries, the stray finder ("3 more photos
  belong in Truck — added"), continuous background organization. The user
  stops curating; the app curates. **That's the upgrade.**

This is why the thin backend (§3) exists at all: the free tier needs no
server, but the **upgrade needs an account + an entitlement** (StoreKit
subscription, validated on-device via StoreKit 2; the backend is the
entitlement source-of-truth + the optional server-side escalation for hard
clustering + the telemetry that tells us which free users convert and why).
Free proves the magic on a few albums by hand; paid makes it ambient.

---

## 2. Reality check — what already exists (verified inventory)

Everything below was read in the repo, not assumed.

### 2a. The shell — `apps/nuke-capture-ios` (fork wholesale)

A finished, iPhone-only SwiftUI app, iOS 17+, that we fork:

| File | What it gives Blur | Reuse |
|---|---|---|
| `project.yml` (XcodeGen) | bundle id, capabilities, BG modes, usage strings, privacy-manifest wiring, monotonic build number | **~verbatim**, retargeted ids |
| `PrivacyInfo.xcprivacy` | Apple privacy manifest | edit data-types (drop Location) |
| `NukeCaptureApp.swift` | `@main`, BGAppRefreshTask register/schedule, routing | **verbatim** structure |
| `SignInView.swift` | Sign in with Apple, sign out, **account deletion (5.1.1(v))** | **verbatim** (auth identical) |
| `SupabaseService.swift` | auth, Keychain session, `request_account_deletion` RPC | keep auth/deletion; **drop** the upload path |
| `SyncEngine.swift` | PhotoKit fetch, `PHPhotoLibraryChangeObserver`, watermark+dedupe, cancellation-safe background loop | **reuse the scanner**; **delete** GPS gate + upload; **add** the classify/cluster step |
| `TodayView.swift` | native value screen (counters, local thumbnails, grid) | **re-skin** into the gallery/curate UI |
| `Config.swift` | public URL/anon key, tuning | **point at the NEW project** (§3) |
| `generate.sh` | stamps a monotonic build number so App Store Connect never rejects a stale build | **verbatim** (hard-won) |
| `apps/APP_STORE_LAUNCH.md` | full TestFlight→App Store runbook, rejection traps mapped | **reuse as our checklist** |
| `apps/SIGN_IN_WITH_APPLE_SETUP.md` | native Sign in with Apple setup | reuse |

This plumbing is proven across **three** code bases (daemon → Mac → iOS). It
is the most de-risked part of the effort.

### 2b. The presentation layer — blur/focus already designed

- **Manual blur toggle** (the focus gesture): `ImageLightbox.tsx:440`
  `toggleSensitive()`; "MARK SENSITIVE" button at `ImageInfoPanel.tsx:1016`.
- **Blur render:** `OrganizationProfile.tsx:3163` `filter: blur(20px)`. On iOS
  this is a one-line `.blur(radius:)` modifier.

### 2c. The engine — nuke's image-intelligence system (the real fruit)

nuke's deep research is **exactly the truck-folder problem, solved for
vehicles.** It takes a chaotic pile of images and organizes them *by entity*,
augmented with AI. Generalize "vehicle" → "any subject" and it **is** Blur's
engine. Verified pieces:

| nuke capability | File / object | Generalizes to (Blur) |
|---|---|---|
| "Does this image belong to this entity?" | `supabase/functions/check-image-vehicle-match/index.ts` | **stray finder** — "does this photo belong in the truck gallery?" (the *missed-picture* problem, §1.3) |
| Hero / primary image pick | migration `…_image_hero_score_quality_primary.sql` | the **cover shot** you flip to; the group's lead image |
| Group images into sessions/events | `yono/session_detector.py`, `…_derive_work_sessions.sql` | **automatic galleries** by event/time (§1.2) |
| Aspect/scene classification ("zone") | `yono/VISION_ARCHITECTURE.md`, `ai-tag-image-angles` | sub-grouping *within* a subject (angles, scenes) |
| Coverage map ("what's here / missing") | `vehicle_coverage_map` | "what's in this group, what's missing" |
| Quality scoring | `photo_quality_score` | rank within a gallery; demote junk |
| Multi-provider vision failover | `supabase/functions/detect-sensitive-document/index.ts` | a **reusable harness** for any edge-side vision call; prompt is swappable |

**The on-device half is even better.** Apple's **Vision framework** ships
`VNGenerateImageFeaturePrintRequest` → per-image feature prints + a
`computeDistance` similarity metric. That is a clustering primitive: take the
user's existing album as labeled seeds and **find visually similar strays
entirely on-device**, no server, no upload. PhotoKit smart albums + Vision
classification supply the seed taxonomy. The server engine (nuke patterns) is
the *optional* escalation for hard cases — not the default path.

**Net:** the shell is done, the presentation is designed, and the organizing
engine exists (server) with a strong on-device counterpart (Apple Vision).
Blur is **generalize + re-skin + a clean backend** — not R&D.

---

## 3. The one decision that gates everything: backend separation

> The directive said *"…and if we separate backend stuff."* This is the
> **single most important call in the plan**, and it is a privacy landmine.

`nuke-capture-ios` exists to **UPLOAD** photos into nuke's **production,
multi-tenant** Supabase project (`qkgaybvrernstplzjaam`, bucket
`vehicle-photos`, table `vehicle_images`). Correct for a vehicle tool;
**catastrophic** for a personal-library organizer. Not one byte of a user's
gallery may land in nuke prod.

So Blur **inverts** the capture app, and the organizing work stays local:

| | nuke-capture | **Blur** |
|---|---|---|
| Photo bytes | uploaded to shared DB | **never leave the device** |
| Where organization runs | server pipeline | **on-device** (Vision feature-prints + Apple tags); server optional |
| Backend role | own the photos | **accounts + the saved organization (metadata only)** |
| What syncs | the images | at most the *organization layer* (asset id → group), never the image |

**Recommended architecture: local-first, with a thin, *separate* backend.**

- **Photos + the organization layer live on-device.** Galleries, group
  assignments, blur/focus state — all local. This is the product's
  credibility.
- **A NEW, dedicated Supabase project** — *not* nuke prod — owns: accounts
  (Sign in with Apple), the `request_account_deletion` RPC (App Store
  5.1.1(v)), optional metadata sync (asset id ↔ group id — *never* pixels),
  and product telemetry so we *"learn the hangups of hitting the ground
  running with users."* This is the literal *"fill in keys + access"* step.
- **Optional server escalation** for hard clustering runs as one edge function
  *in that new project*, on a thumbnail the user explicitly submits — opt-in,
  not ambient.

*(Alternative — fully local, zero backend — ships fastest with the purest
privacy story, but yields no accounts and no telemetry, so we learn nothing
about users. Since the stated goal is to learn the first-mile hangups, the
thin-separate-backend path is recommended. This is the main call for you, §7.)*

---

## 4. Scope — everything we might need to do

Grouped so nothing hides. ☐ = work item; ✅ = exists/reusable.

**Product / UX**
- ☐ Name + bundle id (`ag.nuke.blur` or a standalone brand; "Blur" is likely
  taken on the App Store — check early, same trap the capture runbook hit with "Nuke").
- ☐ Three surfaces: **auto-galleries grid**, **a single gallery / focus view**,
  **search/retrieval**. Blur-everything-else is a mode within focus view.
- ☐ The focus + reveal interaction (tap a group → everything else blurs).

**iOS app**
- ✅ Shell, routing, BG tasks, Keychain auth (fork `nuke-capture-ios`).
- ✅ PhotoKit scanning + change observer (reuse `SyncEngine`'s top half).
- ☐ **Delete** GPS gate + upload from `SyncEngine`/`SupabaseService`.
- ☐ **Seed layer:** read `PHAssetCollection` smart/user albums + Vision
  classification as the initial organization.
- ☐ **Cluster layer:** `VNGenerateImageFeaturePrintRequest` + `computeDistance`;
  use existing albums as seeds to find strays (the missed-picture finder).
- ☐ Local store for the organization layer (Core Data / SQLite).
- ☐ Gallery grid + single-gallery focus view + `.blur(radius:)` for the
  de-emphasis mode (re-skin `TodayView`).
- ☐ Retrieval/search over the organized set.

**Backend (the NEW, separate project)**
- ☐ Create dedicated Supabase project; capture URL + anon key.
- ☐ Apple auth provider (`SIGN_IN_WITH_APPLE_SETUP.md`).
- ☐ Port `request_account_deletion` RPC + `process-account-deletions` drain
  (capture runbook §2 has the exact, already-shipped SQL).
- ☐ `groups`/`memberships` metadata tables (asset id ↔ group) + RLS, *if* we sync.
- ☐ Telemetry events table (funnel: install → grant photos → first auto-gallery
  → first stray accepted → first focus-to-show).

**Monetization (the paid upgrade)**
- ☐ StoreKit 2 subscription product in App Store Connect (auto-renewable).
- ☐ On-device entitlement check gates "automatic image handling"; backend
  holds the source-of-truth entitlement + conversion telemetry.
- ☐ Paywall/upsell surface at the moment of value (after the first manual
  gallery proves the magic).

**AI (the engine behind the paid upgrade)**
- ✅ On-device Vision clustering primitives (Apple).
- ✅ Server vision failover harness + entity-match logic to copy (nuke).
- ☐ Generalize `check-image-vehicle-match` from "vehicle" to "user-defined
  subject seed"; tune the clustering thresholds.

**Compliance / legal**
- ☐ Privacy policy URL **live** (App Review fetches it; a 404 is a launch
  blocker per capture runbook §1). Lead with "photos stay on-device."
- ☐ App Privacy questionnaire — likely just Email + User ID if pixels never
  leave the device (a *much* cleaner card than capture's).
- ☐ Account deletion working end-to-end before submit (5.1.1(v)).

**Go-to-market / App Store**
- ✅ Reuse `APP_STORE_LAUNCH.md` wholesale.
- ☐ Screenshots (6.7" + 6.1"), description, demo reviewer account.
- ☐ The **4.2 minimum-functionality** narrative (§7) — easy here: real
  on-device ML, not a wrapper.

---

## 5. Scaffolding theory — reducing execution to "keys + access"

Blur = `nuke-capture-ios` minus the upload, plus the organize step, plus a
blur renderer. The derivation:

**Step 1 — Fork the project.** Copy `apps/nuke-capture-ios/*` → `apps/blur/`.
Rename target/scheme. In `project.yml` change only: bundle id → `ag.nuke.blur`;
BGTask id → `ag.nuke.blur.refresh`; `CFBundleDisplayName` → chosen name;
`NSPhotoLibraryUsageDescription` → *"Blur organizes your photos on-device into
smart galleries so you can find and show the right ones fast. Photos never
leave your device."*; in `PrivacyInfo.xcprivacy` drop Precise Location.

**Step 2 — Point at the new backend ("the keys").** In `Config.swift`, replace:
```
static let supabaseURL    = URL(string: "https://<NEW-PROJECT>.supabase.co")!
static let supabaseAnonKey = "<NEW-PROJECT-ANON-KEY>"   // public by design
```
Delete the `shopLocations`/`isAtShop`/`storagePath`/`sourceTag` block (no upload).

**Step 3 — Turn the relay into an organizer.** In `SyncEngine.swift`: keep
authorization, `PHPhotoLibraryChangeObserver`, the watermark/fetch loop, the
cancellation-safe background pattern. **Delete** the GPS gate and
`uploadPhoto`. **Replace** the per-asset body with: read Apple album/Vision
tags → compute a feature print → assign/refresh the asset's group locally.
`SupabaseService.swift`: keep auth + `requestAccountDeletion`; delete
`VehicleImageRow`/`uploadPhoto`/storage.

**Step 4 — Re-skin the screens.** `TodayView` → a galleries grid; tapping a
gallery opens a focus view that renders that group and `.blur(radius:)`-es the
rest; a stray-suggestions row ("3 more photos look like your Truck — add?").

**Step 5 — Generate & run.** `./generate.sh && open *.xcodeproj`, set Team,
⌘R. The capture runbook's on-device smoke test (`APP_STORE_LAUNCH.md` §4)
applies almost verbatim.

**The "keys + access" checklist** (the literal remaining inputs):
- [ ] New Supabase project URL + anon key → `Config.swift`
- [ ] Apple Developer App ID `ag.nuke.blur` + Sign in with Apple capability
- [ ] Apple provider Client ID added in the new project's auth settings
- [ ] `request_account_deletion` RPC applied to the new project (SQL exists)
- [ ] Privacy policy URL live and returning 200
- [ ] (optional) `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` in the new project for
      server-side clustering escalation

Everything else is the generalize/re-skin diff above — bounded and mechanical.

---

## 6. Recommended path (phased, flexible)

- **Phase 0 — Decide §3 (½ day).** Local-only vs. thin-separate-backend.
  Recommendation: thin-separate-backend, local-first.
- **Phase 1 — The FREE tier → TestFlight internal (~1–2 weeks).** Steps
  1–5 with the **Apple-seed organization** (smart albums + Vision tags) +
  **manual galleries** + the **focus/blur** view. New backend = auth +
  deletion only. The stray-finder can be a stub. This is the **free product**
  end to end — a real build on a real phone, internal TestFlight (no Apple
  review needed) — where we *learn the first-mile hangups*.
- **Phase 2 — The PAID upgrade: automatic image handling (~1–2 weeks).** Add
  on-device feature-print clustering + the stray finder seeded from the user's
  own albums, **gated behind a StoreKit subscription**. This is the "it
  organizes itself" moment — the thing people pay for.
- **Phase 3 — App Store submission (~few days + 1 likely rejection cycle).**
  Privacy policy, screenshots, demo account, 4.2 narrative, App Privacy card.
- **Phase 4 — Server escalation + sync (post-launch, optional).** Generalized
  `check-image-vehicle-match`, cross-device metadata sync.

Internal TestFlight in ~1–2 weeks is realistic; App Store approval is
*possible but not guaranteed* on the first cycle — same honest caveat as the
capture runbook.

---

## 7. Risks & open decisions

**Open decisions (your call):**
1. **§3 backend model** — local-only vs. thin-separate-backend (recommended).
2. **Name + brand** — sub-brand of Nuke, or standalone? Check App Store name
   availability early.
3. **v1 depth** — Apple-seed + manual galleries first (recommended), with
   passive clustering as Phase 2; or hold v1 until clustering is in?

**Risks:**
- **Scope.** An organization engine is a bigger surface than a blur button.
  The phasing above keeps v1 shippable (Apple does the heavy seeding) and
  treats our clustering as the Phase-2 differentiator.
- **Clustering quality.** "Find the strays" must feel magic, not noisy. Seed
  from the user's *own* albums (high-precision labels) before any unsupervised
  clustering; let the user confirm suggestions (also great telemetry).
- **App Store 4.2.** Genuinely native on-device ML (Vision, PhotoKit) — not a
  wrapper. Lead review notes with that; low risk.
- **Privacy promise vs. reality.** Local-first keeps the App Privacy card
  near-empty — a feature, not just compliance. If we ever sync, sync metadata
  only, and make the policy match to the letter.
- **Name collision / trademark** on "Blur."

---

## 8. Effort estimate

| Phase | Effort | Gated on |
|---|---|---|
| 0 — decide backend | ½ day | §7.1 |
| 1 — Apple-seed + manual galleries + focus view → TestFlight internal | ~1–2 weeks | new Supabase keys, Apple App ID |
| 2 — on-device passive clustering + stray finder | ~1–2 weeks | Phase 1 |
| 3 — App Store submission | ~2–4 days + 1 likely rejection | privacy URL, screenshots, demo acct |
| 4 — server escalation + sync | post-launch, iterative | usage learnings |

Small **because the expensive assets already exist**: the iOS shell (proven
×3), the organizing engine (nuke's vehicle-image intelligence), Apple's
on-device Vision clustering, and a full launch runbook. What's left is
generalizing the engine, a re-skin, and a set of keys.

---

## Appendix — source pointers (so the next engineer doesn't re-research)

- Shell to fork: `apps/nuke-capture-ios/` (README + `project.yml`)
- Launch runbook: `apps/APP_STORE_LAUNCH.md`; Apple sign-in: `apps/SIGN_IN_WITH_APPLE_SETUP.md`
- Account-deletion SQL (shipped): `supabase/migrations/20260611030000_request_account_deletion.sql`
- **Engine — entity grouping & stray match:** `supabase/functions/check-image-vehicle-match/index.ts`
- **Engine — session/event clustering:** `yono/session_detector.py`, `supabase/migrations/…_derive_work_sessions.sql`
- **Engine — hero pick / quality:** `supabase/migrations/…_image_hero_score_quality_primary.sql`
- **Engine — aspect/scene taxonomy:** `yono/VISION_ARCHITECTURE.md`
- Vision failover harness to copy: `supabase/functions/detect-sensitive-document/index.ts`
- Presentation (blur) reference: `ImageLightbox.tsx:440`, `OrganizationProfile.tsx:3163`
- On-device clustering primitive (Apple): `VNGenerateImageFeaturePrintRequest` + `VNFeaturePrintObservation.computeDistance`
</content>
