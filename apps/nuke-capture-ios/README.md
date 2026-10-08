# Nuke Capture — iOS

iPhone port of the proven Mac menu-bar relay (`apps/nuke-capture-mac`).
Photos taken at registered work locations upload straight from the phone to
the owner's own Nuke account — killing the iCloud → Mac → relay hop.

Same engine, same row shape, same privacy gates as the Mac app:

| Concern | Mac relay | This app |
|---|---|---|
| Row shape | `VehicleImageRow` | identical |
| Bucket/path | `vehicle-photos`, `users/<uid>/capture-relay/` | identical (shared path = cross-device dedupe) |
| `source` | `capture_relay` | `capture_relay_ios` |
| Privacy gate 1 | GPS shop-gate on-device | identical (off-shop photos never leave the phone) |
| Privacy gate 2 | server vision pipeline | unchanged |
| Watermark | creationDate + 3-day overlap + (filename,size) seen-set ×1000 | identical |
| Trigger | `PHPhotoLibraryChangeObserver` (always-on app) | foreground sync + `PHPhotoLibraryChangeObserver` + `BGAppRefreshTask` heartbeat |
| Auth | email/password, Keychain session, RLS | identical |

## Build

There is no committed `.xcodeproj` — it's generated from `project.yml`.
Release CI generates the project and stamps a fresh, monotonic **build number** (CFBundleVersion) so
App Store Connect never rejects an upload for a stale/duplicate build —
the bug that stalled 1.0.0 after build 27. You never hand-bump it.

```bash
brew install xcodegen
cd apps/nuke-capture-ios
xcodegen generate
mkdir -p NukeCapture-iOS.xcodeproj/project.xcworkspace/xcshareddata/swiftpm
cp Package.resolved NukeCapture-iOS.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/
open NukeCapture-iOS.xcodeproj
```

In Xcode: target **NukeCapture-iOS** → Signing & Capabilities → set your
**Team** (automatic signing) → run on a device. These commands generate a local
preview; use the existing CI release path for an upload, without hand-bumping the
build number. `generate.sh` is not tracked on main.

## Shipping

The Library's **Albums** door preserves native album names, folder paths and exact
photo membership as the first organization pass. **Analyze album / Analyze library**
reads original on-device photos, including already-assigned images, and saves a
separate versioned Apple Vision/OCR pass. The background backfill visits albums
first, then ungrouped photos. Reads are reused only for matching source and method
versions; unavailable originals stay pending. These reads do not assign ownership,
performer identity or canonical vehicle membership. Existing cloud vehicle IDs are
context, not independent confirmation.

The pass retains raw OCR lines as well as modern VIN-shaped candidates, so shorter
classic-vehicle serials are preserved for later identity review. It is a source and
coverage foundation; it does not yet identify every vehicle from appearance.

The own-user profile opens this same album/source viewer. Its local projection
matches complete OCR serial tokens against the account's cached exact vehicles,
retains duplicate-serial conflicts and never assigns the rest of an album to a
candidate. Unknown capture dates stay unknown. Source photos, including unalbumed
photos, remain inspectable without a cloud verdict. Scope-specific paging stays
inside the selected album or identity review; an unavailable album cannot fall
back to all photos.

The profile garage also reads `get_my_garage_owner_corrections` for the signed-in
account, alongside the legacy garage RPC. All stated roles, unknown period bounds,
title/dispute qualifiers, evidence IDs and qualified account cover choices survive
the offline cache. Business handling, consignment, representation and pending or
disputed interests remain separate from personal ownership. A fork requires review.

Album grouping and on-device review coverage persist locally. Limited Photos access
cannot expose user albums, so the screen reports unknown album coverage while
selected photos remain analyzable. No new
permission prompt, cloud write, paid analysis or upload path is added by this layer.

The local ledger contracts can be tested offline against the lockfile's installed
GRDB checkout:

```bash
GRDB_SOURCE_DIR=/path/to/GRDB.swift bash scripts/test-native-photo-albums.sh
```

For native screen verification, a Debug build accepts `NUKE_DEBUG_SCREEN=library`
without an injected account; it still uses the actual device's PhotoKit access.
Simulator Apple Vision initialization can fail; such originals remain unread with
an explicit analysis-pending reason. A successful Simulator build or SQLite test
does not prove real-library recognition, TestFlight delivery or a zero-network
offline screen. Native album/read synchronization is still pending.

The complete TestFlight + App Store submission runbook lives at
[`../APP_STORE_LAUNCH.md`](../APP_STORE_LAUNCH.md) — including the
**pre-submission server TODO** (`request_account_deletion` RPC) that App
Store rule 5.1.1(v) depends on.

## Files

```
project.yml                        XcodeGen spec (bundle ag.nuke.capture, iOS 17+,
                                   Background Modes, BGTask ids, usage strings)
PrivacyInfo.xcprivacy              Apple privacy manifest (photos, precise location,
                                   email, user id — app functionality, no tracking)
Sources/NukeCapture/
  NukeCaptureApp.swift             @main; BGAppRefreshTask register/schedule; routing
  SignInView.swift                 sign in / sign out / account deletion (5.1.1(v))
  TodayView.swift                  native value screen: counters, thumbs, Sync Now
  SyncEngine.swift                 PhotoKit watch + watermark + dedupe + GPS gate
  SupabaseService.swift            auth, storage upload, vehicle_images insert
  Config.swift                     public URL/anon key, shop-gate geometry, tuning
```
