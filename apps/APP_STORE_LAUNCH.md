# Nuke Capture iOS — App Store Launch Runbook

Self-contained runbook to take `apps/nuke-capture-ios` from this repo to
TestFlight and then the App Store. Written so a human (or an agent with no
memory of the build session) can execute it top to bottom.

**Honest timeline up front:**

| Step | Typical time |
|---|---|
| Generate project, sign, run on device | same day |
| TestFlight **internal** testing | same day — internal builds need **no Beta App Review**; usable minutes after upload finishes processing (~5–30 min) |
| TestFlight **external** testers | first build requires Beta App Review — usually hours, up to ~24 h |
| First **App Store** review | typically 24–48 h after submission; **rejection–fix–resubmit loops are normal for first submissions** and add 1–3 days each |
| Expedited review (if granted) | can compress App Store review to hours — request sparingly (§9) |

"This week" is realistic for **TestFlight internal**. App Store approval this
week is *possible* but not guaranteed — plan for one rejection cycle.

---

## §0 What this app is (context for whoever executes this)

A small native SwiftUI app, iPhone-only, iOS 17+. It watches the user's photo
library and uploads photos taken **at registered work locations (GPS-gated
on-device)** to the user's own account on the Nuke vehicle platform
(nuke.ag). Off-shop photos never leave the phone. There is no web view — the
only web touchpoint is a "View on Nuke" link that opens Safari. This matters
for review: it is genuinely native (PhotoKit, BGTaskScheduler, local
thumbnails), not a wrapper, so guideline 4.2 (minimum functionality) should
not bite.

Key identifiers:

| Thing | Value |
|---|---|
| Bundle ID | `ag.nuke.capture` |
| App name (App Store Connect) | `Nuke` — **see name fallback note in §3** |
| BGTask identifier | `ag.nuke.capture.refresh` |
| Backend | Supabase project `qkgaybvrernstplzjaam` (public anon key; user JWT + RLS) |
| Upload destination | bucket `vehicle-photos`, path `users/<uid>/capture-relay/`, table `vehicle_images`, `source='capture_relay_ios'` |

---

## §1 Prerequisites checklist (do these before touching Xcode)

- [ ] **Apple Developer Program membership active** ($99/yr, Account Holder
      can verify at <https://developer.apple.com/account>).
- [ ] **Xcode 15.4+ (16.x recommended) installed** — NOT just Command Line
      Tools. `xcodebuild -version` must print an Xcode version. The machine
      this runbook was authored on had only CommandLineTools — install Xcode
      from the App Store first if that's still true.
- [ ] **Xcode signed in**: Xcode → Settings → Accounts → "+" → the Apple ID
      holding the membership.
- [ ] **Privacy policy URL is LIVE**: `curl -sS -o /dev/null -w "%{http_code}\n"
      https://nuke.ag/privacy` must return 200 with a real policy that
      mentions: photos collected, GPS location collected, account data
      (email), how to request deletion. **App Review checks this URL.**
      If it 404s, that is a launch blocker — fix the site first.
- [ ] **Support URL live** (any contact page works, e.g. `https://nuke.ag`
      with a visible contact route). Required field in App Store Connect.
- [ ] **Agreements signed**: App Store Connect → Business → the Free Apps
      agreement must be Active (Paid Apps agreement not needed — app is free).
- [x] **Server TODO from §2 done** (account deletion RPC) — submission
      without it risks a 5.1.1(v) rejection the moment the reviewer taps
      Delete Account and sees an error.
- [ ] **Demo account exists** for the reviewer (see §7) with seeded data.

---

## §2 PRE-SUBMISSION SERVER TODO — `request_account_deletion` RPC

**Status: DONE (2026-06-10, branch `fable5/account-deletion`).** Live in
production. The app's Delete Account button calls:

```
POST /rest/v1/rpc/request_account_deletion   (authenticated as the user)
```

Implementation (soft deletion — anonymize identity, retain contributed
vehicle data per privacy policy; testimony is never destroyed):

1. **RPC `public.request_account_deletion()`** (SECURITY DEFINER,
   authenticated only, migration
   `supabase/migrations/20260611030000_request_account_deletion.sql`):
   immediately anonymizes the caller's `profiles` row (username →
   `deleted-<uuid8>`, full_name → "Deleted User", avatar/city/state/
   location/bio → NULL) and enqueues a `pending` row in
   `account_deletion_requests` (RLS-enabled, owner-read). Returns
   `{status:'requested', note:'identity anonymized; sign-in disabled within
   24h; ...'}` so the app can sign out locally.
2. **Edge function `process-account-deletions`** (service-role bearer
   required) drains pending rows: bans the auth user via
   `supabase.auth.admin.updateUserById(user_id, { ban_duration: '876000h' })`
   (~100 years — sign-in disabled) and stamps `processed_at`. Run it on a
   cron (10–15 min) or manually before submission.

Remaining manual step before submission: end-to-end test with a throwaway
account — sign in, tap Delete Account, confirm the RPC returns
`status:'requested'`, run `process-account-deletions`, confirm sign-in fails
afterward.

---

## §3 App Store Connect records (one-time)

1. <https://developer.apple.com/account> → Certificates, Identifiers &
   Profiles → **Identifiers** → "+" → App ID → bundle ID **explicit**
   `ag.nuke.capture`. No special capabilities needed (Background Modes is a
   plist-only capability; Photos needs no entitlement on iOS).
   (Xcode automatic signing can also auto-register this on first device run.)
2. <https://appstoreconnect.apple.com> → My Apps → "+" → New App:
   - Platform: iOS
   - Name: **Nuke** — app names are globally unique on the App Store. If
     "Nuke" is taken (likely — check before getting attached), fall back to
     **"Nuke Capture"** or **"Nuke — Vehicle Capture"**. The name in App
     Store Connect does not need to match `CFBundleDisplayName`, but keeping
     them close avoids a 2.3.7 metadata flag; if the store name changes,
     update `CFBundleDisplayName` in `project.yml` to match.
   - Primary language: English (U.S.)
   - Bundle ID: select `ag.nuke.capture`
   - SKU: `ag.nuke.capture` (any unique string)
3. App Information page: Category **Productivity** (or Utilities), content
   rights "does not contain third-party content", Age Rating questionnaire →
   all "No" → 4+.

---

## §4 Generate, sign, run on device

```bash
brew install xcodegen
cd apps/nuke-capture-ios
xcodegen generate          # writes NukeCapture-iOS.xcodeproj (gitignored)
open NukeCapture-iOS.xcodeproj
```

In Xcode:

1. Target **NukeCapture-iOS** → Signing & Capabilities → check
   "Automatically manage signing" → **Team** = your team. (The project.yml
   deliberately doesn't pin a team.)
2. Plug in the iPhone, select it as run destination, **⌘R**.
   First run on a new device: trust the developer profile on the phone
   (Settings → General → VPN & Device Management).
3. On-device smoke test (do all of these — this is the review rehearsal):
   - [ ] First launch shows the Photos permission prompt with the exact
         string from project.yml ("Nuke uploads photos you take at your
         registered work locations…"). Allow Full Access.
   - [ ] Sign in with a real Nuke account. Kill + relaunch → still signed in
         (Keychain session).
   - [ ] Take a photo **at a registered shop** (or temporarily add your
         current location to `Config.shopLocations` for the test, then
         revert) → foreground the app → Today shows "Uploaded today: 1",
         thumbnail appears.
   - [ ] Verify the row landed:
         `select source, file_name, taken_at from vehicle_images where source='capture_relay_ios' order by created_at desc limit 5;`
   - [ ] Take a photo away from any shop (or with GPS off) → sync → "Held
         back (off-shop)" increments, nothing uploads.
   - [ ] Account sheet: Sign Out works; Delete Account works end-to-end
         against a **throwaway** account (requires §2 done).

---

## §5 TestFlight

1. In Xcode: select destination **Any iOS Device (arm64)** → Product →
   **Archive** → Organizer opens → **Distribute App** → **App Store
   Connect** → Upload. Defaults are fine (automatic signing, include symbols).
2. Wait for processing (App Store Connect → TestFlight tab; ~5–30 min,
   email arrives when done). Export-compliance question is pre-answered by
   `ITSAppUsesNonExemptEncryption=false` in project.yml.
3. **Internal testing (no review, same day):** TestFlight tab → Internal
   Testing → "+" group "Nuke Internal" → add testers (must be users on the
   App Store Connect team — add via Users and Access first) → select the
   build. Testers get the invite in the TestFlight app within minutes.
4. **External testers (optional, slower):** requires Beta App Review for the
   first build (hours–24 h) plus a public link or email invites. Skip unless
   someone outside the team needs it this week.
5. Every new upload needs a bumped build number: edit
   `CURRENT_PROJECT_VERSION` in project.yml → `xcodegen generate` → archive
   again (or just bump the build number in Xcode before archiving).

---

## §6 Screenshots (required before submission, not for TestFlight)

App Store Connect requires screenshots for two size classes (it scales the
rest from these):

| Display | Devices | Pixels (portrait) |
|---|---|---|
| 6.7"/6.9" | iPhone 15 Pro Max / 16 Pro Max | 1290×2796 (or 1320×2868) |
| 6.1"/6.3" | iPhone 15 Pro / 16 Pro | 1179×2556 (or 1206×2622) |

Minimum 1 each, up to 10. **What to capture (in this order):**

1. **TodayView with real data** — uploads today > 0, thumbnails visible.
   This is the money shot; it proves native functionality.
2. TodayView's "All time" section showing the held-back counter (the
   privacy story as a feature).
3. SignInView.
4. Account sheet (shows Delete Account — reviewers notice).

How: run on the right simulators (`xcodegen` project opens fine in any) and
press **⌘S** in Simulator, or capture on-device and pull PNGs from
Photos. Simulator has no shop-GPS photos, so for screenshot purposes either
(a) screenshot from the real device (Settings → keep device screenshots at
native resolution), or (b) temporarily add the simulated location to
`Config.shopLocations` and drag test images with GPS EXIF into Simulator.
No device frames/marketing text needed — raw UI screenshots are fine.

---

## §7 App Privacy questionnaire (App Store Connect → App Privacy)

Answers MUST match `apps/nuke-capture-ios/PrivacyInfo.xcprivacy`. Declare
exactly these four data types — nothing more, nothing less:

| Data type | Collected? | Linked to user? | Used for tracking? | Purpose |
|---|---|---|---|---|
| Photos or Videos | Yes | Yes | No | App Functionality |
| Precise Location | Yes | Yes | No | App Functionality |
| Email Address | Yes | Yes | No | App Functionality |
| User ID | Yes | Yes | No | App Functionality |

"Do you or your third-party partners use data for tracking?" → **No.**
There are no ad/analytics SDKs in the app; the only dependency is
supabase-swift (the user's own backend).

---

## §8 App Review notes (paste into "App Review Information" → Notes)

A **working demo account is mandatory** (the app requires sign-in). Create a
dedicated reviewer account in Supabase auth, seed it so TodayView shows
non-zero counters and thumbnails would exist locally is impossible for the
reviewer — so seed `vehicle_images` rows for the totals and accept that the
reviewer's thumbnail strip is empty (it renders only local photos).

> **Demo account:** `appreview@nuke.ag` / `<SET-A-REAL-PASSWORD>`
> *(placeholder — create this account before submitting and paste real
> credentials here; never reuse a personal password).*
>
> **What the app does:** Nuke Capture uploads photos a vehicle technician
> takes at their *registered work locations* to their own account on the
> Nuke vehicle-documentation platform. It is a native PhotoKit app: it reads
> the photo library, applies an on-device GPS gate, and uploads only photos
> geotagged at the user's registered shops.
>
> **Why you won't see an upload happen:** the GPS gate is the product's
> privacy feature. Photos taken anywhere other than a registered work
> location are deliberately held on-device — the Today screen counts them
> under "Held back (off-shop)". Since your review location is not a
> registered shop, photos you take will be (correctly) held back and the
> held-back counter will increase. The demo account is pre-seeded so the
> all-time counters reflect real usage.
>
> **Account deletion (5.1.1(v)):** Profile icon (top right) → Delete
> Account → confirmation → server-side deletion of the account and its data.
>
> **Background modes:** BGAppRefreshTask (`ag.nuke.capture.refresh`)
> periodically checks for new shop photos; all uploads go to the user's own
> account over HTTPS.

---

## §9 Expedited review (only if the schedule truly demands it)

Request: <https://developer.apple.com/contact/app-store/?topic=expedite>

Template:

> App Name: Nuke / Bundle ID: ag.nuke.capture / Platform: iOS
> Reason: time-sensitive business launch. Our field technicians begin a
> documented restoration engagement on <DATE> and the app is the capture
> tool for contractual work documentation. We request expedited review of
> our initial submission.

Notes: Apple grants these at their discretion, usually once in a while per
team — don't burn the favor on TestFlight (internal TestFlight needs no
review at all). Request it only for the App Store submission, only if the
date is real.

---

## §10 Submission-day checklist

- [ ] §2 deletion RPC live and tested end-to-end with a throwaway account
- [ ] Demo reviewer account created, seeded, credentials in review notes
- [ ] `https://nuke.ag/privacy` returns 200 and covers photos/GPS/account
- [ ] Build on latest `CURRENT_PROJECT_VERSION`, archived from a clean
      `xcodegen generate`, uploaded, processed, tested via internal TestFlight
- [ ] Screenshots uploaded (6.7" + 6.1" sets)
- [ ] App Privacy questionnaire saved (matches §7 table exactly)
- [ ] Description / keywords / support URL / marketing URL filled in
      (description should repeat the GPS-gating privacy story in plain words)
- [ ] Pricing: Free, all territories (or trim territories deliberately)
- [ ] App Review notes pasted (§8) with REAL demo credentials
- [ ] Version release option: "Manually release this version" (so a surprise
      approval doesn't ship before the backend deletion job is watched)
- [ ] Press **Submit for Review**
- [ ] If rejected: read the rejection verbatim, fix ONLY what was cited,
      reply in Resolution Center (a reply sometimes resolves
      misunderstandings without a new build), resubmit. Typical first-app
      rejections for this profile: 5.1.1(v) deletion not working, 2.1
      sign-in/demo-account problems, privacy-policy URL mismatch.

---

## Appendix: what was and wasn't verified at scaffold time

Authored on a machine with **Command Line Tools only (no Xcode, no iOS
SDK)**. Verified: Swift syntax of every source file (`swiftc -parse`),
YAML validity of project.yml, plist validity of PrivacyInfo.xcprivacy and
XcodeGen project generation (if xcodegen was installable — see commit
message / PR notes for the exact result). **Not verifiable without Xcode:**
compilation against the iOS SDK + supabase-swift, BGTask behavior on device,
the full archive/upload path. Expect at most minor compile fixes on first
`⌘B` — the engine/service code is a near-verbatim port of the
known-compiling Mac relay in `apps/nuke-capture-mac`.
