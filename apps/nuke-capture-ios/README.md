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

## The room (read this first; `AGENTS.md` sends every agent here)

The app is LIVE on TestFlight, not greenfield. Develop from what exists: name the file and improve it
in place. It is the phone end of the data machine: the one surface that can **capture** (camera roll,
EXIF, location, on-device Vision and OCR, the GPS shop gate), and it **mirrors** the web for everything
else. The user profile starts at image intake, so it lives here (owner, 2026-10-05).

Two rules outrank taste:

1. **The web is the source of truth; the phone mirrors it.** Same RPCs, same numbers, same masks, same
   rules. Never a parallel local data layer, never a client-side rebuild of a number the database can
   state. The app was once caught showing 766 images against the real 22,315 (2026-06-12); that is the
   failure this rule exists for.
2. **Only a Claim or a Measure reaches the screen, and every number carries its Coverage.** The kit
   (`nuke_frontend/src/kit/types.ts`) is the contract; `Sources/NukeCapture/ProfileDocument.swift` is its
   Swift twin; `RootedValueView` (`RootedValue.swift`) is the one primitive that renders a value, with its
   trust rung, its clock and its drill (or its honest refusal to drill). A bare value is a bug.

**The header is on the read.** `vehicle_profile_read(uuid)` (migration `20261013143000`, SECURITY
INVOKER, callable by anon and authenticated) returns the vehicle page's header as one ProfileDocument: a
`masthead` (identity columns, the one headline price as a Claim with its kind, platform and clock), a
`strip` (body, engine, transmission, drivetrain, location and odometer as Claims, closed by `coverage`:
n of N facts attributed, as of a clock) and a `timeline` (events dated by day and kind, with coverage).
`VehicleDetailView.loadProfileRead()` fetches it; `ProfileStripView.swift` renders it; the spec table drops
the rows the strip owns, so each datum is stated once. The viewer (`anon`, `contributor`, `owner`) is what
the database decided from `auth.uid()`. Claim source kind → trust rung: owner, document → `.proven`;
listing, image, agent → `.attributed`; model → `.projected`; legacy → `.facade` (dim, "unverified", no
drill: the web says the same in words in its popover, the phone says it by grammar). A live auction
banner owns the headline price; the masthead price stays off while `vehicle_pulse.is_live`. When the read
grows a section, add its case to `ProfileSection` and render it through the same primitives; never add a
new client-side query to the header.

Standing rules the code carries:

- **Images:** every public `vehicle_images` read goes through `VehicleGalleryImage.eligible(_:)`, the web
  gallery's population (`vehicle_image_gallery_eligible` plus the document, duplicate, superseded and
  null-url exclusions of `fetchVehicleImages.ts`), and page 0 carries the exact count of that same
  predicate. This is display eligibility, not privacy: the row policy on `vehicle_images` is the gate,
  and until it checks `vision_gate_status` a reader that drops the predicate can read rejected frames.
  Thumbnails render through `NukeImage.thumb(url, width:)` (the render endpoint, or BaT's `?w=`), never
  the raw original outside the full-screen viewer.
- **Uploads are keyed by their bytes.** The storage path is `users/<uid>/capture-relay/<sha256>/<filename>`
  (`Config.storagePath`). The filename alone wraps at IMG_9999: by 2026-10-15, 586 old paths each held rows of
  different photos (1,266 rows, at least 598 showing another photo's bytes). Never key an object by a name the
  camera reuses. A pass reads no original for an asset it already settled (`SyncEngine.processAsset`, by
  `localIdentifier`), gives each asset three attempts before it stops holding the watermark or the queue, and
  stops on a refused session (`SupabaseService.isAuthFailure`) instead of failing every remaining photo.
- **Photos file to the owner's vehicles; strong evidence makes a profile.** Owner direction, 2026-10-15: "the app
  after vision run is supposed to assign the vehicle to a profile under the image owners associated vehicle profiles,
  its supposed to create new profiles if theres enough data to support it." `AttributionEngine.run` files an uploaded
  photo through the server (`device_file_images` → `attribute_testimony`, audited) on a serial read matching one of
  the owner's vehicles (every era's serial, `VisionEngine.matchSerial`) or on the owner's album mapped to a vehicle
  (`album_sync_map`). A valid 17-character VIN (`VisionEngine.isValidVIN`) that matches nothing, or an unmapped album
  named "year make model" (`AlbumLabel`) with `Config.albumProfileMinPhotos` uploaded photos, goes to
  `device_create_vehicle_profile`, which resolves an existing vehicle first and creates a private profile, with the
  owner as photographer and not as owner, only when the server's thresholds hold. A session inheritance (same day,
  same ~100 m cell) stays a suggestion: a dealer lot holds many cars. Nothing in the app writes `vehicle_id` directly.
- **Newest first.** Each sync pass leads with the last three days, newest first, ahead of the watermark window, and an
  original that lives only in iCloud goes to the backfill queue (the background job downloads it on Wi-Fi) instead of
  holding the watermark. On 2026-10-15 the owner's window sat in June; every open re-read the same 200 iCloud-only June
  photos and the morning's measurement shots never uploaded. Pixels follow the device rule of record
  (`VisionEngine.triage`, the same rule `scripts/ios-vision-triage` applies to stored frames): clutter and personal stay
  on the phone as metadata only; everything else, a part close-up included, uploads.
- **Heat is a budget.** Nothing reads originals in bulk while the app is open: iCloud originals download only in
  the background job on Wi-Fi; the album review (originals + accurate OCR) runs in the foreground only on a
  charger at a nominal temperature (`LibraryIngest.mayReviewInForeground`); a foreground backfill slice waits
  when the phone is already warm (`SyncEngine.deviceWarm`); polls pause when the app is not active. A new loop
  that reads photos or the network states its bound and its thermal gate. The 2026-10-15 audit of every
  launch-time cost is in the PR that added this rule.
- **A failed read says why.** `ReadFailure.text(error)` (SupabaseService.swift): no connection, a server timeout,
  an HTTP status, a refused sign-in. "Check your connection" was the copy for every failure, including the
  board's server-side 500s.
- **Money is never anonymous.** The readers mask it at the source (#1037, #1046, #1048, and the day
  receipt since June); the phone also renders the ledger and value curve only when the read's viewer is
  not `anon`, failing closed without a document. OCR text regions from a day receipt are rendered as
  recorded; nothing masks plate-shaped text yet, so do not claim it.
- **An estimate is defended or absent.** The web's `marketDefends` rule: an estimate shows only against a
  typed price (sold, bid, ask) or a live listing; an unlisted car, such as an owner's build, shows none, on
  screen and on the share card.
- **Explore opens as the Market tab opens.** The ledger as a map first (`LedgerMap.swift`: `treemap_by_brand`,
  `treemap_models_by_brand`, `treemap_years`, then the `vehicles` leaf, the web's readers column for column; area =
  count, color = median, the web's captions; the unreadable tail folded into a box of its own cells with the list
  behind its title, as the inventory map folds its tail), the open board below it (web #1061). A capped level
  (200 models a brand, 200 records a model) states its denominator.
- **The board is the web's board.** `market_pulse_live` is read once per 30 s and rendered as nuke.ag renders it:
  bids in dollars (BaT runs every auction in USD; web #1061), the heat tag per lot computed exactly as
  `MarketPulse.tsx heatOf` (curve share by tier at hours left, typical = band p50 × share, hot ≥ 1.25×, cold ≤ 0.8×,
  no verdict past 120 h), the reading rows behind the tag, the week-ago line from `baseline.week_ago`. The track
  record of lots tagged this way is typed into the web page, not carried by a read, so the phone states that and
  waits (market lane plans a table + view, 2026-10-13). Prove a board change lot-for-lot against the live site as a
  stranger (Playwright pattern in memory `reference_logged_out_live_check_playwright.md`).
- **Coverage on every counter.** A count without its population and clock is not shown; say "unknown"
  instead of guessing (fleet-relative reporting, `docs/ledger/theory/data-machine.md`).
- **No fabricated data anywhere,** including DEBUG builds and screenshots (`docs/design/CONSTRAINTS.md` C0).
  DEBUG-only deep links (`NUKE_DEBUG_*`, `NukeCaptureApp.swift`) drive the screenshot loop and are compiled
  out of Release: `NUKE_DEBUG_VEHICLE_ID=<uuid>` roots on a profile as anon, `NUKE_DEBUG_SCREEN=app|
  profile|explore|today|library`, `NUKE_DEBUG_SCROLL_TO=worth|proof|asset|specs|events|photos|more`,
  `NUKE_DEBUG_EXPLORE_MODE=pulse|live|listings|map`, `NUKE_DEBUG_EXPLORE_QUERY=<text>` lands on the search
  results and `NUKE_DEBUG_EXPLORE_PAGES=<n>` walks n more pages through the door, `NUKE_DEBUG_LIVE_READING=1` opens
  the first hot or cold lot's reading on the board, `NUKE_DEBUG_LEDGER_MAKE=Chevrolet` opens that brand's models on the
  ledger map, `NUKE_DEBUG_DAY=<yyyy-mm-dd>`
  (+ `NUKE_DEBUG_DAY_USER`) opens a day receipt. A session injected once persists in the simulator Keychain;
  terminate and relaunch, or use an explicit screen hook. `simctl install` the fresh product before a
  capture: a launch hook on a stale install looks like a code bug (2026-10-13).

**Shipping to TestFlight.** The owner's phone is the test surface. Three paths; use the first that works
and say which, with the delivery stage (implemented → built → archived → uploaded → on the phone).
"Merged to main" ships nothing by itself.

1. **Xcode Cloud (works, no local credentials).** The workflow "Default" builds the branch
   `fable5/ignition-ios`, archives, and distributes to the TestFlight group "Nuke Internal". Ship a
   commit with `git push origin <sha>:refs/heads/fable5/ignition-ios` and watch
   `gh api repos/sss97133/nuke/commits/<sha>/check-runs` for the check-run `NukeCapture | Default |
   Archive - iOS` (about six minutes). **Move the ref only by a fast-forward.** A forced update is
   ignored by Xcode Cloud (measured 2026-10-13: six minutes, no run). After a squash merge the ref no
   longer descends from main, so carry main onto it with a merge commit whose tree is main's:
   `m=$(git commit-tree <main-sha>^{tree} -p <old-ref-sha> -p <main-sha> -m "ship(ios): carry main <main-sha> onto the Xcode Cloud ref")`
   then `git push origin "$m:refs/heads/fable5/ignition-ios"` (quote the refspec: zsh reads `$m:r` as a modifier).
   A fast-forward pushed while the previous run is still starting can also go unregistered (measured
   2026-10-13 17:19Z, eight minutes, no run): if no check-run appears within three minutes, push a
   fresh same-tree commit (`git commit-tree <ref>^{tree} -p <ref> -m "ship(ios): retrigger"`) onto the ref. Xcode Cloud stamps `CFBundleVersion` with its run counter,
   overriding `project.yml` and both `ci_scripts`; when App Store Connect rejects a build as not higher
   than an earlier one, bump `MARKETING_VERSION` in `project.yml` (a new train has no prior builds). The
   build appears on the phone as a new version with its own Update button.
2. **CLI ship from a Mac** (`scripts/ios/ship-testflight.sh`): `xcodebuild archive` + `-exportArchive`
   with automatic signing. Needs Xcode signed into the team's Apple ID (the errors "Unable to log in with
   account" and "No Account for Team" mean exactly that, not a broken pipeline) or the App Store Connect
   key for the Nuke team (key id `77637BYL66`; issuer id in `~/.appstoreconnect/asc-nuke.env`, never in
   the repo).
3. **GitHub Actions** (`.github/workflows/ios-testflight.yml`): manual trigger, needs six secrets, two
   were never set. Not a working path as of 2026-10-13.

One agent owns this folder at a time; register in `.claude/LANES.md` (local) and `.claude/agents/active/`.
Migrations and edge functions belong to their own rooms; this app only reads them. Shapes are decided in
`nuke_frontend/src/kit`; change `types.ts` and this app's twin together, or not at all.

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
