# Blur — App Store Launch Runbook (v0, local tier)

Derived from `apps/APP_STORE_LAUNCH.md` (the Nuke capture runbook). Because
Blur v0 is **local-only — no account, no network, no data collected** — most
of that runbook's blockers disappear. What's left is short.

**Identifiers**

| Thing | Value |
|---|---|
| Bundle ID | `ag.nuke.blur` |
| App name (App Store Connect) | `Blur` — **globally unique; likely taken. Check first** (fallbacks: "Blur — Photo Sorter", a distinct brand). |
| BGTask identifier | `ag.nuke.blur.refresh` |
| Backend | **none** (v0) |
| Developer / seller | Nuke (the Apple Developer account / team) |

## §1 Prerequisites

- [ ] Apple Developer Program membership active (Nuke's account).
- [ ] Xcode 16.x installed (`xcodebuild -version` must print a version).
- [ ] Xcode signed in (Settings → Accounts) with the Nuke team.
- [ ] App Store Connect → Business → **Free Apps agreement** Active.
- [ ] Support URL live (any contact page).
- [ ] **Privacy policy URL live** — App Review fetches it. For v0 it states the
      truth: *Blur processes photos entirely on your device; no data is
      collected, transmitted, or shared.* (A 404 here is a launch blocker.)
- [ ] Demo: none needed — the app requires no sign-in. The reviewer just grants
      Photos access and sees their own albums as galleries.

## §2 No pre-submission server TODO

The capture app needed a `request_account_deletion` RPC (5.1.1(v)) because it
has accounts. **Blur v0 has no account, so 5.1.1(v) does not apply.** When the
paid/account phase lands, restore that requirement from the capture runbook §2.

## §3 App Store Connect record (one-time)

1. developer.apple.com → Identifiers → "+" → App ID → explicit `ag.nuke.blur`.
   (No special capabilities for v0 — Background Modes is plist-only, Photos
   needs no entitlement, and there is no Sign in with Apple yet.)
2. appstoreconnect.apple.com → My Apps → "+" → New App: iOS, name **Blur**
   (check availability), primary language English (U.S.), bundle `ag.nuke.blur`,
   SKU `ag.nuke.blur`.
3. App Information: Category **Photo & Video** (or Utilities); content rights
   "no third-party content"; Age Rating → all "No" → 4+.

## §4 Generate, sign, run on device

```bash
brew install xcodegen
cd apps/blur          # or the repo root once Blur is extracted to its own repo
./generate.sh
open Blur.xcodeproj
```

In Xcode: target **Blur** → Signing & Capabilities → "Automatically manage
signing" → **Team** = Nuke. Plug in the iPhone, ⌘R.

On-device smoke test (the review rehearsal):
- [ ] First launch shows the Photos permission prompt with the project.yml
      string ("Blur reads your photo library on this device…"). Allow.
- [ ] Home shows your albums + Apple smart albums as gallery cards.
- [ ] Open a gallery → tap photos to hide (they blur) → toggle **Show mode** →
      hidden photos disappear; the rest present cleanly.
- [ ] Kill + relaunch → hidden selections persist (local store).
- [ ] Airplane mode → everything still works (proves local-only).

## §5 TestFlight

Archive (Any iOS Device arm64) → Distribute → App Store Connect → Upload.
Export compliance is pre-answered (`ITSAppUsesNonExemptEncryption=false`).
**Internal testing needs no Beta App Review** — usable minutes after
processing. Bump the build by re-running `./generate.sh` (monotonic, automatic).

## §6 Screenshots (App Store only, not TestFlight)

6.7"/6.9" and 6.1"/6.3" sets. Capture, in order: the galleries grid; a gallery
in curate mode (a couple blurred); the same gallery in Show mode; Settings
(the privacy promise). Simulator ⌘S works since there's no device-only data.

## §7 App Privacy questionnaire

Answer **"Data Not Collected."** Matches `PrivacyInfo.xcprivacy` (empty
collected-types, no tracking). This near-empty card is itself a selling point.

## §8 App Review notes (paste into "App Review Information")

> Blur organizes the photos already on the device into galleries (seeded from
> the user's albums and Apple's smart albums) and lets the user hide photos
> (blur) and present a gallery safely via "Show mode". It is fully native
> (PhotoKit, on-device state) and **makes no network calls** — no account, no
> server, no data leaves the device. Grant Photos access on first launch to see
> your albums as galleries. (Guideline 4.2: genuinely native on-device
> functionality, not a web wrapper.)

## §9 Submission-day checklist

- [ ] Privacy policy URL returns 200 and states on-device / no-collection
- [ ] Build archived from a clean `./generate.sh`, uploaded, internal-TestFlight tested
- [ ] Screenshots (6.7" + 6.1")
- [ ] App Privacy = Data Not Collected
- [ ] Description / keywords / support + marketing URLs
- [ ] Pricing: Free
- [ ] Review notes pasted (§8)
- [ ] "Manually release this version"
- [ ] Submit. If rejected: read it verbatim, fix only what's cited, resubmit.

---

When the paid **automatic image handling** phase ships (BYO-LLM / managed
inference / Anthropic referral), revisit: App Privacy (data may then be
processed via the user's chosen provider), 5.1.1(v) if accounts appear, and the
StoreKit subscription metadata. Until then, v0 stays this simple.
