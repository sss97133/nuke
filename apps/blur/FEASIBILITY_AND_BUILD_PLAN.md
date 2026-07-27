# Blur — Plan & Build Brief (iOS)

*Blur is a standalone consumer app. **Nuke is the developer/studio; Blur is
product #1.** iOS-only; web is just a link to the App Store.*

This is the single source of truth for the Blur spin-out. It was written after
reading the actual nuke code, and it is kept **internally consistent on
purpose** — if something here contradicts an older message, this document wins.
Read the Decision Log first; everything after it elaborates.

---

## Decision Log (locked)

Everything we have settled, in one place. Each line is a decision, not a
discussion.

| # | Decision | Status |
|---|---|---|
| D1 | **Nuke is the developer; Blur is its first product.** The point is to prove Nuke can ship a full product to the App Store and learn the first-mile user hangups. | locked |
| D2 | **iOS-only.** No Android. Web = an App Store link, nothing more. | locked |
| D3 | **Ship to App Review as a whole new, standalone app** so real testing starts (TestFlight → App Store). | locked |
| D4 | **Blur lives in its OWN repository**, separate from the nuke monorepo. (Staged in `apps/blur/` now; extracted before launch.) | locked; repo not yet created |
| D5 | **The product is passive AI photo ORGANIZATION.** "Embarrassing" was one example adjective; any attribute slots in. **Blur = the presentation/focus layer; automatic organization is the product.** | locked |
| D6 | **Free tier = totally anonymous, on-device, no account, no network.** Anonymity is the feature and the user-acquisition engine. | locked |
| D7 | **Paid upgrade = automatic image handling, powered by intelligence the *user* brings** (a local model, or their own provider subscription/key), **or** pay Nuke (managed). Even paid stays anonymous — data flows to the user's provider, not us. | locked |
| D8 | **Anthropic sign-up referral** is a revenue path: when a user needs a provider, Blur can broker Anthropic sign-up. Integration specifics are Phase-2, grounded against the live Anthropic API reference at build time. | locked (mechanics TBD) |
| D9 | **No backend on the free path. Ever.** A small, *separate* (never nuke-prod) backend appears only later for unavoidable server bits (purchase validation, referral hook, optional managed inference). | locked |
| D10 | **v0 scope = the free tier, end-to-end, pure local.** No Supabase, no account, no upload, no StoreKit. This is the fastest, lowest-risk path to App Review. | locked |
| D11 | **Reuse, don't reinvent:** fork the proven `nuke-capture-ios` shell; **invert it** (remove upload + GPS gate); keep PhotoKit scan, BGTask, thumbnail loader, XcodeGen + monotonic build number. | locked |

**Open decisions** (need your input — collected in §8): repo name/owner/
visibility (D4), App Store app-name availability (D5), and the Phase-2 upgrade
mechanics (D7/D8).

---

## 1. Verdict

**Ship v0 to TestFlight, then App Review — it is unusually cheap and low-risk,
because the hard parts already exist and the free tier needs no backend.**

| Question | Answer |
|---|---|
| Does the core tech exist? | **Yes.** The iOS shell and the organizing engine both already exist in nuke (§3). |
| Standalone app today? | **No** — `apps/blur/` was empty; now holds the v0 scaffold (§6). |
| What does v0 "done" reduce to? | An Apple App ID, a live privacy-policy URL, the new repo — and pressing build. **No backend, no keys.** |
| Biggest risk? | Not engineering. **Product scope discipline** (keep v0 to the free tier) and **App Store 4.2** (low — it's genuinely native ML). |
| Time to TestFlight internal (v0)? | **~1 week** of focused work; v0 is a re-skin of proven plumbing with the network removed. |

---

## 2. Product definition (D5)

> **Blur** organizes your photo library *for* you, passively, so you never go
> down the manual-tagging rabbit hole — and so that when you want to show
> someone *the* photo, you flip straight to the exact group with confidence
> instead of frantically scrolling 80,000 images and giving up.

Four layers (the user's own framing):

1. **Seed from Apple's own tags** — Apple Photos already classifies on-device
   (smart albums, people/pets, places, scene/object tags via the **Vision
   framework**). Read those (`PHAssetCollection` + Vision) as the first
   organization layer. Local, free, private.
2. **Layer passive AI organization on top, and persist it** — cluster images
   into galleries **by subject** ("my truck") in the background. *(Paid — it's
   the automatic image handling, D7.)*
3. **Learn the user's existing albums and complete them** — read the album the
   user already started as ground truth and **find the strays that belong**
   among the 80k. *(Paid.)*
4. **Instant, confident retrieval** — flip to the exact group; everything else
   is **blurred/de-emphasized** so there's no over-share and no frantic scroll.
   *(This is where "Blur" earns its name; the manual form of it is free.)*

**v0 (free) delivers layers 1 and 4 with manual curation.** Layers 2–3 (the
automatic clustering) are the paid upgrade.

**Non-goals (v0):** no social/feed/cloud-backup, no vehicle anything, no
Android, no account, no network.

---

## 3. What already exists in nuke (verified inventory)

Read in the repo, not assumed.

### 3a. The shell — `apps/nuke-capture-ios` (fork, then invert)

A finished iPhone-only SwiftUI app (iOS 17+). Blur **inverts** it: the capture
app uploads photos to a shared backend; Blur removes the upload and GPS gate
and keeps everything on the phone.

| File | Blur reuse |
|---|---|
| `project.yml`, `generate.sh`, `.gitignore` | XcodeGen spec + monotonic build-number stamper — retargeted to `ag.nuke.blur`, **deps removed** (v0 has none) |
| `PrivacyInfo.xcprivacy` | privacy manifest — for v0, **collects nothing** |
| `NukeCaptureApp.swift` | `@main`, BGAppRefreshTask plumbing — structure kept; routing simplified (no sign-in wall) |
| `SyncEngine.swift` | PhotoKit scan + `PHPhotoLibraryChangeObserver` — **kept**; GPS gate + upload **deleted** |
| `TodayView.swift` + thumbnail loader | re-skinned into the galleries grid + focus view |
| `SupabaseService.swift`, `SignInView.swift`, `Config.swift` (keys) | **NOT in v0** — they belong to the paid/account phase only |
| `apps/APP_STORE_LAUNCH.md` | reused as the basis for Blur's runbook (`apps/blur/APP_STORE_LAUNCH.md`) |

Proven across three code bases (daemon → Mac → iOS) — the most de-risked part.

### 3b. The engine — nuke's image-intelligence system (powers the PAID layer)

nuke's deep research **is** the truck-folder problem, already solved for
vehicles: take a chaotic pile of images, group them *by entity*, augment with
AI. Generalize "vehicle" → "any subject" and it is Blur's clustering engine.

| nuke capability | File | Generalizes to |
|---|---|---|
| "Does this image belong to this entity?" | `supabase/functions/check-image-vehicle-match/index.ts` | **stray finder** (the missed-picture problem) |
| Hero/primary image pick | `…_image_hero_score_quality_primary.sql` | the gallery cover you flip to |
| Session/event clustering | `yono/session_detector.py`, `…_derive_work_sessions.sql` | automatic galleries by event |
| Aspect/scene taxonomy | `yono/VISION_ARCHITECTURE.md` | sub-grouping within a subject |
| Quality scoring | `photo_quality_score` | rank within a gallery |
| Multi-provider vision failover | `supabase/functions/detect-sensitive-document/index.ts` | reusable edge-vision harness; prompt swappable |

**On-device counterpart (better for our privacy promise):** Apple's
`VNGenerateImageFeaturePrintRequest` → feature prints + `computeDistance` is a
clustering primitive. Seed it with the user's own albums → find strays entirely
on-device, no server. The nuke server engine is an *optional* escalation for
the "pay Nuke" tier, never the default.

### 3c. The presentation layer — blur/focus already designed

Manual blur toggle (`ImageLightbox.tsx:440` `toggleSensitive()`; "MARK
SENSITIVE" at `ImageInfoPanel.tsx:1016`) and blur render
(`OrganizationProfile.tsx:3163`). On iOS this is a one-line `.blur(radius:)`.

---

## 4. Architecture & privacy (D6, D7, D9)

The privacy model is the product. It has two tiers and **no server on the free
path**.

| | Free (v0) | Paid upgrade |
|---|---|---|
| Photos | on-device only | on-device; processed only via the **user's chosen provider** |
| Organization | Apple tags + manual | + passive AI clustering (BYO intelligence) |
| Account | **none** | none required; anonymous/device-scoped or Apple private-relay if billing needs an id |
| Network | **none** | only to the user's provider (BYO key) or Nuke's managed inference (opt-in) |
| Nuke backend | **none** | small & separate (never nuke-prod): purchase validation, Anthropic referral hook, optional managed inference |

Why this holds: because the paid intelligence is **brought by the user**, the
upgrade never forces us to centralize photos or identity. Anonymity survives
the upgrade. The only data that ever reaches a server is what a paying user
explicitly opts to process, and even then via *their* provider account.

---

## 5. Scope by phase (consistent with the Decision Log)

☐ = to do; ✅ = exists/done.

**v0 — Free tier (pure local)**
- ✅ Fork shell; strip upload + GPS; retarget ids; remove all deps.
- ✅ PhotoKit scan → galleries from user albums + Apple smart albums.
- ✅ Galleries grid; single-gallery focus view; tap-to-hide (blur); Show mode.
- ✅ Local hidden-state store (UserDefaults); BGTask passive rescan.
- ✅ Privacy manifest = collects nothing; Blur-specific launch runbook.
- ☐ App icon + launch presentation polish.
- ☐ Apple App ID `ag.nuke.blur`; live privacy-policy URL; App Store record.
- ☐ Extract to its own repo (D4).

**Phase 2 — Paid: automatic image handling**
- ☐ On-device clustering (`VNGenerateImageFeaturePrint` + `computeDistance`),
  seeded from the user's own albums (the stray finder).
- ☐ "Bring your own intelligence" connect flow: local model / provider key.
- ☐ StoreKit 2 subscription (for the "pay Nuke" path) + entitlement gate.
- ☐ Anthropic sign-up referral integration (D8) — grounded against the live
  Anthropic API reference at build time.
- ☐ The small separate backend (only the server-side bits above).
- ☐ Privacy manifest / App Privacy updated to match (data may flow to the
  user's provider); 5.1.1(v) account deletion **iff** accounts are introduced.

---

## 6. v0 build state (what's in `apps/blur/` now)

The free-tier scaffold is written and staged. It is self-contained (no
dependency on the rest of the monorepo) so it lifts into the new repo verbatim.

```
apps/blur/
  project.yml              XcodeGen spec — ag.nuke.blur, iOS 17+, NO dependencies
  PrivacyInfo.xcprivacy    privacy manifest — collects nothing
  generate.sh, .gitignore  monotonic build-number stamper
  README.md                what it is + how to build
  APP_STORE_LAUNCH.md      Blur-specific runbook (most capture blockers vanish)
  FEASIBILITY_AND_BUILD_PLAN.md   (this file)
  Sources/Blur/
    BlurApp.swift          @main; opens straight to galleries (no sign-in); BGTask
    Config.swift           app constants; commented breadcrumbs for the paid backend
    Gallery.swift          the Gallery model + source enum
    LibraryEngine.swift    PhotoKit scan → galleries; local hidden-state store
    AssetThumbnail.swift   local thumbnail loader (optional blur)
    GalleriesView.swift    home grid of gallery covers
    GalleryFocusView.swift one gallery: curate (tap to hide) + Show mode
    SettingsView.swift     privacy promise + upgrade teaser (BYO-intelligence)
```

> Authored without Xcode in the loop (same caveat as the capture app at
> scaffold time): expect at most minor compile fixes on first ⌘B. The PhotoKit
> and SwiftUI patterns are ported from the known-compiling capture app.

**Remaining to a running TestFlight build:** create the repo (D4), move the
folder, `brew install xcodegen && ./generate.sh`, set the Team in Xcode, run on
device, then the runbook.

---

## 7. Effort estimate

| Phase | Effort | Gated on |
|---|---|---|
| v0 free tier → TestFlight internal | ~1 week | repo created, Apple App ID, privacy-policy URL |
| v0 → App Store submission | ~2–4 days + 1 likely rejection cycle | screenshots, App Store record |
| Phase 2 — paid automatic handling | iterative, post-launch | v0 learnings, upgrade-mechanics decision |

Small because the expensive assets already exist (iOS shell proven ×3, the
organizing engine, Apple's on-device Vision, a launch runbook) and the free
tier carries no backend.

---

## 8. Open decisions (need your input)

1. **The new repo (D4).** Name, owner, visibility. Recommendation:
   name `blur` (or `blur-ios`), **private**, under whichever account/org is
   Nuke's home (the same one that holds `sss97133/nuke`, unless there's a
   dedicated org). Once you confirm, I can create it and migrate `apps/blur/`.
2. **App name (D5).** "Blur" is almost certainly taken on the App Store. Pick
   the store name now (a distinct brand, or "Blur — …") so the bundle id and
   metadata are settled before submission. The bundle id `ag.nuke.blur` is
   independent of the store name and can stay.
3. **Phase-2 upgrade mechanics (D7/D8)** — *not blocking v0.* Which is the
   default upgrade path (BYO key vs. pay-Nuke vs. local model), and how the
   Anthropic referral is structured. Decide after v0 is in testers' hands.

---

## 9. Risks

- **Scope creep.** The automatic engine is bigger than the free app. The
  phasing quarantines it to Phase 2 so v0 stays a one-week, no-backend ship.
- **Clustering quality (Phase 2).** "Find the strays" must feel magic, not
  noisy — seed from the user's *own* albums (high-precision labels) and have the
  user confirm suggestions.
- **App Store 4.2 (minimum functionality).** Low: genuinely native on-device ML
  (PhotoKit, Vision), no web wrapper, no network in v0. Lead review notes with that.
- **App name / trademark** on "Blur."

---

## Appendix — source pointers (so the next engineer doesn't re-research)

- Shell to fork: `apps/nuke-capture-ios/` (README + `project.yml`)
- Capture launch runbook (basis): `apps/APP_STORE_LAUNCH.md`
- Engine — entity grouping & stray match: `supabase/functions/check-image-vehicle-match/index.ts`
- Engine — session/event clustering: `yono/session_detector.py`, `…_derive_work_sessions.sql`
- Engine — hero pick / quality: `…_image_hero_score_quality_primary.sql`
- Engine — aspect/scene taxonomy: `yono/VISION_ARCHITECTURE.md`
- Vision failover harness: `supabase/functions/detect-sensitive-document/index.ts`
- Presentation (blur) reference: `ImageLightbox.tsx:440`, `OrganizationProfile.tsx:3163`
- On-device clustering primitive (Apple): `VNGenerateImageFeaturePrintRequest` + `VNFeaturePrintObservation.computeDistance`
