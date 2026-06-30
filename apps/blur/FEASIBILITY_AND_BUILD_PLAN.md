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

**Ship it as a TestFlight build first — it is unusually cheap because we have
already built the hard parts twice.** Blur is not a green-field app; it is a
**re-target of `apps/nuke-capture-ios`**, an existing, complete, App-Store-
runbooked SwiftUI app (PhotoKit + Sign in with Apple + Supabase + background
tasks + account-deletion + privacy manifest). The blur/hide *mechanism* also
already exists in the web app and works.

The work is therefore **subtraction and re-skin, not invention** — with **one
real architectural decision that we must get right before a single user
touches it** (see §3: the backend-separation / privacy landmine).

| Question | Answer |
|---|---|
| Does the core tech exist? | **Yes** — verified, in two places (see §2). |
| Is there a standalone app today? | **No.** `apps/blur/` was empty before this doc; the capability lives inside the nuke monolith. |
| Biggest risk? | **Not** engineering. It's **product/privacy positioning** (§3) and **App Store "minimum functionality" 4.2** (§7). |
| Realistic time to TestFlight internal? | **~1 week of focused work** once §3 is decided, reusing the capture runbook. |
| What does "done" reduce to? | A new Supabase project's keys in `Config.swift`, an Apple App ID, and the re-skin diffs in §5. |

---

## 1. What we are actually shipping (product definition)

The pitch, made precise:

> **Blur** is a private gallery companion. It mirrors your phone's photo
> library and lets you **blur or hide** images — manually, and (optionally)
> with an AI suggestion — so that when you hand someone your phone or show a
> photo, the embarrassing ones are already covered. Its second promise is
> **speed**: the fastest path to *the* photo you mean to show, without
> scrolling past the ones you don't.

Two value props, two screens:

1. **Curate (passive safety).** A grid of your photos. Tap to blur/hide.
   Blurred items stay blurred until you deliberately reveal them. A
   "Safe to show / Guest view" mode hides everything flagged.
2. **Find fast (active retrieval).** Search/scroll your *curated* library so
   the thing you want surfaces first and the things you don't never appear.

**Non-goals for v1** (write these down so scope doesn't creep):
- No social/sharing graph. No feed. No cloud photo backup.
- No vehicle anything. This is a clean consumer cut.
- No Android (web = an App Store link per the directive).

---

## 2. Reality check — what already exists (verified inventory)

Everything below was read in the repo, not assumed.

### 2a. The iOS skeleton — `apps/nuke-capture-ios` (the gift)

A finished, iPhone-only SwiftUI app, iOS 17+, that we can fork wholesale:

| File | What it gives Blur | Reuse |
|---|---|---|
| `project.yml` (XcodeGen) | bundle id, capabilities, BG modes, usage strings, privacy manifest wiring, monotonic build number | **~verbatim**, retargeted ids |
| `PrivacyInfo.xcprivacy` | Apple privacy manifest | edit data-types (drop Location) |
| `Sources/.../NukeCaptureApp.swift` | `@main`, BGAppRefreshTask register/schedule, routing | **verbatim** structure |
| `SignInView.swift` | Sign in with Apple, sign out, **account deletion (5.1.1(v))** | **verbatim** (auth is identical) |
| `SupabaseService.swift` | auth, Keychain session, `request_account_deletion` RPC call | reuse auth/deletion; **drop** the upload path |
| `SyncEngine.swift` | PhotoKit fetch, `PHPhotoLibraryChangeObserver`, watermark+dedupe, cancellation-safe loop | **reuse the scanner**, **delete the GPS gate + upload** |
| `TodayView.swift` | native value screen (counters, local thumbnails, "Sync Now") | **re-skin** into the curate grid |
| `Config.swift` | public URL/anon key, tuning constants | **point at the NEW project** (§3) |
| `generate.sh` | stamps a fresh monotonic build number so App Store Connect never rejects a stale build | **verbatim** (hard-won; keep it) |
| `apps/APP_STORE_LAUNCH.md` | a full TestFlight→App Store runbook with the rejection traps already mapped | **reuse as our checklist** |
| `apps/SIGN_IN_WITH_APPLE_SETUP.md` | the Apple provider setup for native Sign in with Apple | reuse |

The capture app's own README frames it as *"the same engine, same row shape,
same gates"* ported from the Mac relay — i.e. this plumbing has now been
proven across **three** code bases (daemon → Mac → iOS). It is the most
de-risked part of the entire effort.

### 2b. The blur/hide mechanism — already works in the web app

- **Manual blur toggle:** `nuke_frontend/.../ImageLightbox.tsx:440` —
  `toggleSensitive()` flips `is_sensitive` and the UI blurs. A "MARK
  SENSITIVE" button at `ImageInfoPanel.tsx:1016`. *This is literally Blur's
  core gesture, already designed and shipped.*
- **Blur rendering:** `OrganizationProfile.tsx:3163` —
  `filter: blur(20px)` gated on `is_sensitive`. On iOS this is a one-line
  `.blur(radius:)` modifier — trivial to reproduce, no web reuse needed.
- **Schema intent:** migration `20251122000002_add_image_rotation_sensitive.sql`
  already documents `is_sensitive` as *"faces, personal info, titles… that
  should be blurred"* — the data model anticipated this exact product.

### 2c. The AI auto-detect — exists, but aimed at the wrong target

- `supabase/functions/detect-sensitive-document/index.ts` — a real,
  multi-provider (OpenAI→Anthropic failover, 10s timeouts, graceful
  degrade-to-not-sensitive) vision classifier. **But it detects vehicle
  *paperwork* (titles, registration, VINs, SPID sheets)**, not "embarrassing"
  consumer content. For Blur, the *harness* is reusable; the *prompt* is a
  rewrite. This is the only piece of net-new AI work, and it is optional for
  v1 (manual blur ships without it).

**Net:** the mechanism is real and proven; the product around it is not built.
Bringing it to market is **extraction + re-skin + one prompt**, not R&D.

---

## 3. The one decision that gates everything: backend separation

> The directive said *"…and if we separate backend stuff."* This is not a
> nicety. It is the **single most important call in the whole plan**, and it
> is a privacy/brand landmine if we get it wrong.

`nuke-capture-ios` exists to **UPLOAD** photos into nuke's **production,
multi-tenant** Supabase project (`qkgaybvrernstplzjaam`), bucket
`vehicle-photos`, table `vehicle_images` (`Config.swift:16`,
`SupabaseService.uploadPhoto`). That is correct for a vehicle-documentation
tool. It is **catastrophic** for a consumer app whose entire promise is
*"hide my embarrassing photos."* We must not let one byte of a user's private
gallery land in nuke prod.

So Blur **inverts** the capture app:

| | nuke-capture | **Blur** |
|---|---|---|
| Photo bytes | uploaded to shared DB | **never leave the device** (default) |
| Backend role | own the photos | **own accounts + preferences only** |
| Privacy gate | GPS, to decide what to upload | **none needed — nothing uploads** |

**Recommended architecture: local-first, with a thin, *separate* backend.**

- **Photos & blur state live on-device** (PhotoKit + a local store). This is
  the product's whole credibility. The blur/hide flags are tiny — store them
  locally; optionally sync *the flags only* (asset id + hidden bool), never
  the image.
- **A NEW, dedicated Supabase project** — *not* nuke prod — owns: accounts
  (Sign in with Apple), the `request_account_deletion` RPC (App Store 5.1.1(v)
  requires it), preference sync, and product telemetry so we can *"learn the
  hangups of hitting the ground running with users."* This is exactly the
  *"fill in keys + access"* step: stand up the project, paste its URL + anon
  key into `Config.swift`, done.
- **Optional AI auto-detect** runs as one edge function *in that new project*,
  operating on a thumbnail the user explicitly submits — opt-in, not ambient.

**Why a separate project and not a schema in nuke prod:** blast-radius,
RLS simplicity, a clean privacy policy we can actually stand behind, and the
freedom to delete/replace the whole thing without touching the car platform.
The capture app proves the pattern works against *any* Supabase project — only
the two constants in `Config.swift` change.

*(Alternative — fully local, zero backend — ships even faster and has the
purest privacy story, but gives us no accounts and no telemetry, so we'd learn
nothing about users. Since the stated goal is to learn the first-mile hangups,
the thin-separate-backend path is recommended. This is the main decision for
you in §7.)*

---

## 4. Scope — everything we might need to do (the full list)

Grouped so nothing hides. ☐ = work item; ✅ = already exists/reusable.

**Product / UX**
- ☐ Name + bundle id (current capture id `ag.nuke.capture` is taken/wrong —
  pick `ag.nuke.blur` or a standalone brand; "Blur" is likely taken on the
  App Store — check before getting attached, same trap as the capture runbook §3).
- ☐ Two-screen design: Curate grid + Guest/Safe view. Find-fast search.
- ☐ The blur gesture + reveal interaction (long-press to peek? PIN to reveal?).
- ✅ The mark-sensitive interaction model (proven in web `ImageLightbox`).

**iOS app**
- ✅ App skeleton, routing, BG tasks, Keychain auth (fork `nuke-capture-ios`).
- ✅ PhotoKit scanning + change observer (reuse `SyncEngine`'s top half).
- ☐ **Delete** GPS gate + upload path from `SyncEngine`/`SupabaseService`.
- ☐ Local blur-state store (Core Data / SQLite / a plist for v1).
- ☐ Curate grid UI + `.blur(radius:)` rendering + Guest mode (re-skin `TodayView`).
- ☐ Find-fast: search over the curated set.

**Backend (the NEW, separate project)**
- ☐ Create a dedicated Supabase project; capture URL + anon key.
- ☐ Auth: enable Apple provider (`SIGN_IN_WITH_APPLE_SETUP.md` recipe).
- ☐ Port `request_account_deletion` RPC + `process-account-deletions`
  drain (the capture runbook §2 has the exact, already-shipped SQL).
- ☐ `preferences` table (asset id ↔ hidden flag) + RLS, if we sync.
- ☐ Telemetry events table (funnel: install→grant photos→first blur→guest-mode).

**AI (optional for v1)**
- ✅ Vision failover harness (`detect-sensitive-document`) to copy.
- ☐ Rewrite the prompt for consumer "embarrassing/sensitive" detection
  (faces, screenshots, documents, NSFW) — opt-in, thumbnail-only.

**Compliance / legal**
- ☐ Privacy policy URL **live** (App Review fetches it; capture runbook §1
  flags a 404 here as a launch blocker). Must describe: photo access stays
  on-device, what (if anything) syncs, account/email, deletion path.
- ☐ App Privacy questionnaire (drop Precise Location vs. capture; likely just
  Email + User ID if photos never leave the device — a *much* cleaner card).
- ☐ Account deletion working end-to-end before submit (5.1.1(v)).

**Go-to-market / App Store**
- ✅ TestFlight→App Store runbook (reuse `APP_STORE_LAUNCH.md` wholesale).
- ☐ Screenshots (6.7" + 6.1"), description, demo reviewer account.
- ☐ The **4.2 minimum-functionality** mitigation narrative (§7).

---

## 5. Scaffolding theory — reducing execution to "keys + access"

The claim "*it ultimately becomes just filling out keys and access*" is
**true**, and here is the exact derivation that makes it true. Blur =
`nuke-capture-ios` minus the upload, plus a blur renderer.

**Step 1 — Fork the project.** Copy `apps/nuke-capture-ios/*` →
`apps/blur/`. Rename target/scheme. In `project.yml` change only:
- `PRODUCT_BUNDLE_IDENTIFIER` → `ag.nuke.blur`
- `BGTaskSchedulerPermittedIdentifiers` → `ag.nuke.blur.refresh`
- `CFBundleDisplayName` → the chosen name
- `NSPhotoLibraryUsageDescription` → *"Blur reads your library on-device so
  you can hide photos before showing your phone to someone. Photos never
  leave your device."* (the honesty here is also the marketing.)
- `PrivacyInfo.xcprivacy` → remove Precise Location; keep/trim Photos, Email,
  User ID per the local-first design.

**Step 2 — Point at the new backend ("the keys").** In `Config.swift`,
replace the two constants:
```
static let supabaseURL    = URL(string: "https://<NEW-PROJECT>.supabase.co")!
static let supabaseAnonKey = "<NEW-PROJECT-ANON-KEY>"   // public by design
```
Delete the `shopLocations`/`isAtShop`/`storagePath`/`sourceTag` block — Blur
doesn't upload, so none of it applies.

**Step 3 — Strip the engine to a scanner.** In `SyncEngine.swift`:
- Keep: authorization request, `PHPhotoLibraryChangeObserver`, the
  watermark/fetch loop, the Today-screen bookkeeping pattern.
- **Delete**: Gate 1 (GPS shop-gate, lines ~178–184), `requestOriginalData`
  full-bytes export, and the `SupabaseService.uploadPhoto` call. Replace the
  per-asset body with: load a *thumbnail*, read local blur state, render.
- `SupabaseService.swift`: keep auth + `requestAccountDeletion`; delete
  `VehicleImageRow`, `uploadPhoto`, storage code.

**Step 4 — Re-skin the screen.** `TodayView` → `CurateView`: a
`LazyVGrid` of thumbnails; tap toggles a local `hidden` flag; hidden cells get
`.blur(radius: 24)`; a Guest-mode toggle hides flagged cells entirely.

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
      auto-detect

Everything else is the re-skin diff above — bounded, mechanical, low-risk.

---

## 6. Recommended path (phased, flexible)

Stay reactive — if a phase reveals something, re-plan. But declare a default:

- **Phase 0 — Decide §3 (½ day).** Local-only vs. thin-separate-backend. This
  unblocks everything. Recommendation: thin-separate-backend, local-first.
- **Phase 1 — Walking skeleton to TestFlight internal (~1 week).** Steps 1–5
  of §5 with **manual blur only**, no AI. New backend = auth + deletion only.
  Goal: a real build on a real phone, internal TestFlight (no Apple review
  needed). This is where we *learn the first-mile hangups* — the stated goal.
- **Phase 2 — Polish for App Store submission (~few days).** Privacy policy,
  screenshots, demo account, 4.2 narrative, App Privacy card. Submit. Budget
  one rejection cycle (the capture runbook says first-app rejection loops are
  normal).
- **Phase 3 — Differentiators (post-launch, optional).** AI auto-suggest
  (rewritten prompt on the copied failover harness), preference sync,
  Find-fast search quality, PIN-to-reveal.

A "this week" outcome (internal TestFlight) is realistic; App Store approval
this week is *possible but not guaranteed* — same honest caveat as the capture
runbook.

---

## 7. Risks & open decisions (what only you can decide)

**Open decisions (need your call):**
1. **§3 backend model** — local-only vs. thin-separate-backend (recommended).
   *Changes whether we stand up a project at all.*
2. **Name + brand** — sub-brand of Nuke, or a clean standalone identity? Check
   App Store name availability early (the capture runbook learned this the
   hard way with "Nuke").
3. **Is v1 manual-only**, or must AI auto-detect be in the first submission?
   (Recommend manual-only first — ships faster, fewer review variables.)

**Risks:**
- **App Store 4.2 (minimum functionality).** "An app that blurs photos" can
  read as thin. *Mitigation:* it's genuinely native (PhotoKit, on-device
  state, Guest mode, optional on-device/edge AI) — the same argument the
  capture runbook makes for *its* native-not-wrapper status. Lead the review
  notes with that.
- **Privacy promise vs. reality.** If we ever sync, the policy and the App
  Privacy card must match to the letter (capture runbook §7). The local-first
  default keeps this card almost empty, which is itself a feature.
- **Scope creep into "a better Photos app."** v1 is blur + guest mode + find.
  Everything else is Phase 3.
- **Name collision / trademark** on "Blur."

---

## 8. Effort estimate

| Phase | Effort | Gated on |
|---|---|---|
| 0 — decide backend | ½ day | §7.1 |
| 1 — skeleton → TestFlight internal | ~1 week | new Supabase keys, Apple App ID |
| 2 — App Store submission | ~2–4 days + 1 likely rejection cycle | privacy URL, screenshots, demo acct |
| 3 — AI / sync / search | post-launch, iterative | usage learnings |

The estimate is small **because the expensive, already-built assets**
(iOS plumbing ×3 proven, blur UX designed, AI failover harness, full launch
runbook) **carry most of the weight.** What's left is subtraction, a re-skin,
and a set of keys.

---

## Appendix — source pointers (so the next engineer doesn't re-research)

- iOS skeleton to fork: `apps/nuke-capture-ios/` (README + `project.yml`)
- Launch runbook to reuse: `apps/APP_STORE_LAUNCH.md`
- Sign in with Apple: `apps/SIGN_IN_WITH_APPLE_SETUP.md`
- Account-deletion SQL (already shipped): `APP_STORE_LAUNCH.md` §2 +
  `supabase/migrations/20260611030000_request_account_deletion.sql`
- Manual blur UX (web reference): `nuke_frontend/src/components/image/ImageLightbox.tsx:440`,
  `ImageInfoPanel.tsx:1016`
- Blur render reference: `nuke_frontend/src/pages/OrganizationProfile.tsx:3163`
- AI vision failover harness to copy: `supabase/functions/detect-sensitive-document/index.ts`
- Schema intent: `supabase/migrations/20251122000002_add_image_rotation_sensitive.sql`
</content>
</invoke>
