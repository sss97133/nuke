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
- **Payments open Stripe, never compose an amount.** A job's `pay_invoice` action comes only from the server (`viewer.actions`, offered to the work order customer while a balance is due). `JobPayment.swift` passes back its `work_order_id` to `create-work-order-invoice-checkout` and opens the returned page only when it is https on stripe.com. Nothing is charged until the customer finishes on Stripe; the payment reaches the job through `stripe-webhook`. Collection only: the app shows no payout or release.
- **Job history is testimony until someone signs.** A stage's `retained_testimony` (counts of claims quoted from retained work messages) renders in `JobTestimony.swift` on the attributed rung as "N messages from the shop say…", never as accepted, done or paid, and never changes the stage. `JobOperationsSection` takes each operation's rung from `work_order_operations_read`'s `requested_by_basis` (signed → proven, quoted from the work order's text → attributed, no source → recorded); a "complete" line status is the record's mark, not a completion Sign. `JobEvidenceSection` shows `work_order_evidence_read` filings, counting photos the viewer may not see, and names an operation for visitors only in the operations reader's redacted words.
- **Notifications mirror the web's NotificationCenter.** The Work tab reads the account's latest 50 `user_notifications` rows under their own-row policy (exact count beside them), the unread count from `get_unread_notification_count`, and marks read only from a tap through `mark_notification_read` / `mark_all_notifications_read` (`Notifications/`). A row opens a job or conversation when its metadata names one (`work_order_id`, `contact_request_id`), else the web's order: `action_url`, `vehicle_id`, `organization_id`; a nuke.ag path with no screen opens on the web, and other sites are not opened. Anything that needs a Sign stays in `my_signature_queue`. The Work badge is the unread count plus the queue's stated total. There is no push (no APNs entitlement or registration).
- **Uploads are keyed by their bytes.** The storage path is `users/<uid>/capture-relay/<sha256>/<filename>`
  (`Config.storagePath`). The filename alone wraps at IMG_9999: by 2026-10-15, 586 old paths each held rows of
  different photos (1,266 rows, at least 598 showing another photo's bytes). Never key an object by a name the
  camera reuses. A pass reads no original for an asset it already settled (`SyncEngine.processAsset`, by
  `localIdentifier`), gives each asset three attempts before it stops holding the watermark or the queue, and
  stops on a refused session (`SupabaseService.isAuthFailure`) instead of failing every remaining photo.
- **Photos file to the owner's vehicles; strong evidence makes a profile.** Owner direction, 2026-10-15: "the app
  after vision run is supposed to assign the vehicle to a profile under the image owners associated vehicle profiles,
  its supposed to create new profiles if theres enough data to support it." `AttributionEngine.run` files an uploaded
  photo through the server (`device_file_images` → `attribute_testimony`, audited) on a fresh exact VIN or chassis
  serial matching one of the owner's vehicles, or on the owner's album mapped to a vehicle (`album_sync_map`) after a
  fresh original-byte read classifies the image as a vehicle. Fuzzy reads and photos without a fresh source read stay out
  of automatic filing. A valid 17-character VIN (`VisionEngine.isValidVIN`) that matches nothing, or an unmapped album
  named "year make model" (`AlbumLabel`) with `Config.albumProfileMinPhotos` uploaded photos, goes to
  `device_create_vehicle_profile`, which resolves an existing vehicle first and creates a private profile, with the
  owner as photographer and not as owner, only when the server's thresholds hold. Vehicle identity now has its own `identityMethodVersion`: it reads original local photo bytes with on-device
  Vision OCR/classification and does not accept previous cloud, album, or deep-analysis output as identity evidence.
  A fresh VIN-anchored capture read is retained in the existing protected, reading-only `image_observations` lane.
  It records the source hash, method revision, run, bounded peer inputs, local vehicle/document classifications and
  check-digit-valid modern VINs and explicitly labelled 8–16 character classic chassis serials. It creates no subject or membership. This keeps pre-identity reads out of
  `image_analysis_records` (whose required `vehicle_id` would invent a relation) and avoids a parallel source-read
  table. Before profile admission, the server folds only reads from the same fresh run and exact source hashes, with
  the identifier anchor and independently classified vehicle frames within five minutes and 25 m by capture metadata.
  A classic serial additionally needs one unambiguous owner album label for its year, make and model; unlabeled OCR
  strings and serials without that context remain unresolved. Invoice/document language in local OCR blocks both VIN
  and serial anchors, and raw OCR text never leaves the phone.
  Documents, sensitive or rejected photos, stale hashes, missing clocks/locations, and nearby conflicting VINs block
  the fold. The existing audited profile writer then resolves a globally held VIN or creates a private profile with
  the photographer relation. For a newly created 17-character VIN profile, the server invokes the existing
  `decode-vin-and-update` owner so free NHTSA results seed canonical fields and their observation provenance; it
  reports decode unavailable/no-new-fields separately from the successfully filed photos. The live VIN trigger is
  installed but its required database URL and service-key settings are absent, so it currently skips its queue call.
  Camera make/model/lens metadata is not treated as a unique device id. This path includes a pending migration and is
  not deployed or runtime-verified. Broad day/place inheritance remains a suggestion.
  The table fold follows ownership: `vehicle_images` retains original source, owner, hash and capture facts;
  `image_observations` retains private source reads and unresolved subject testimony; `emergent_vehicle_clusters`
  carries supported unresolved depicted subjects; the profile writer uses `vehicles`, `vehicle_contributors` and
  `reattribution_audit` only after admission. `image_analysis_records` and `vehicle_field_evidence` are downstream
  vehicle-linked analysis, so neither is allowed to invent identity before that fold resolves.
  Historical analysis is not silently promoted into fresh identity evidence: the live atlas shows no
  `image_analysis_records` writes since 2026-08-02, `vehicle_observations` has a large photo-pipeline cohort whose
  rows mostly record classifier failures, and `vehicle_field_evidence` contains 238k NHTSA values literally equal
  to `undefined` plus fabricated Hagerty placeholders already flagged for exclusion. `image_identities` is a content
  root, not a vehicle identity; it can connect exact/aliased photo appearances but cannot by itself establish which
  car is pictured. The fresh v2 read is hash-pinned to the retained original and does not reuse those prior verdicts.
  Nothing in the app writes `vehicle_id` directly.
  Confirming one at a time is unrealistic at the owner's volume (owner, 2026-10-17): `SessionConfirmView` files
  photo-backed serial matches to its server suggestion (`get_orphan_sessions.suggested_vehicle_id`) with one tap, or
  across all suggested sessions at once. A session is a day/place review group and can contain several vehicles;
  quick/bulk filing never treats its day-level fallback as evidence for every photo. Remaining photos stay in review,
  and manual filing requires selecting the source photos before choosing a vehicle (60 owner-scoped references per page).
  `WorkDaySignView` signs every loaded day, or every day for one vehicle, in one `confirm_work_sessions_bulk` call.
  Every pixel-uploading sync pass also runs metadata-only album filing, after the album catalog finishes loading.
  Album-name fallback collapses whitespace and preserves competing mappings. A failed evidence read stops filing;
  a profile request counts only photos acknowledged as filed or already filed in the server's receipt.
  **Identity investigation belongs to the machine** (owner, 2026-10-18): manual filing is a correction tool.
  Inspect retained photos and historical references before asking which car they show. Distinguish a depicted
  subject from its year/VIN, existing record and ownership; an unknown specification does not justify losing a
  supported new subject. The [autonomous subject-resolution contract](../../docs/ledger/theory/data-machine-cases.md)
  records the required flow and missing admission. Current VIN/album routing does not implement visual subject
  discovery, and a time group, dirty cover or model confidence cannot substitute for that missing mechanism.
  **Uploaded photos remains a source history, separate from supported photo profiles.** The own-profile
  door reads the existing `check-image-vehicle-match` owner with `mode=read_subjects` and a `source_inbox`
  scope. It includes historical and already-filed source records; opening, paging and refreshing never
  enrolls analysis or starts inference. A single photograph or all-unknown reading remains inspectable
  without claiming one physical vehicle. Each page checks current source locators, hashes, clocks and protected
  reading heads; held or unpinned sources expose metadata without pixels. Metadata-only uploads state
  that pixels were not retained and their reason is unknown, rather than inferring personal content or
  successful analysis. Counters describe source records in the bounded page, not distinct photographs,
  account totals or accessible Photos coverage. Cached fallback is dated and requires a live visibility
  check before showing remote pixels. This does not lift privacy, source-restoration or paid-intake holds.
  The held audited-source continuation keeps immutable reading and anchor IDs separate from a current
  attribution record. A complete exact source family can represent one photograph across several records;
  the inbox still counts records in its page. A replacement needs its own current approval or a protected
  purpose receipt bound to that leaf and family. It inherits no ancestor approval. Pending replacements
  keep pixels and current interpretations hidden while retaining inspectable earlier-reading provenance;
  alias-wide rejection, privacy withdrawal or incomplete lookup keeps that provenance opaque too.
  Attribution history proves source continuity, not the current canonical vehicle attachment. Detail and
  refresh remain read-only. This proposed policy and its correction writer require separate activation.
  The own-user profile also opens **Observed cars**, private photo-backed subject profiles from the existing
  `check-image-vehicle-match` reader's `read_subjects` mode. They retain visual interpretations and unresolved physical
  identity separately from Garage vehicles, owner statements and fleet value. The profile and gallery carry source-photo
  coverage, exclusions, clocks and bounded-read limits. Visual labels use `RootedValueView` at the projected rung, dated
  by their actual reading clock and rooted in the source gallery; opening them starts no inference or filing. `LocalStore` mirrors
  exact owner-scoped backend response pages for offline use, marked saved and potentially stale. Refreshing a page clears
  its old continuations; a source withdrawal is reflected by the next qualified backend read. This consumer does not
  activate the held processing pipeline or establish autonomous identity accuracy.
  Acknowledged pixel uploads also enter an account-scoped visual-reading work queue. Each active, cool-phone sync
  submits at most one bounded comparison request: two fresh photos to start, or one fresh photo with up to two
  source-qualified retained references. Unused photos remain queued. A lone photo with no reference waits for another
  view. The server preserves complete unknown readings separately from supported memberships, reuses exact retained
  contexts before inference, and refuses to restore later-withdrawn memberships from old readings. Native ambiguous
  retries request retained results only. These operational leases bound one device's work; they are not a cross-device
  exactly-once inference guarantee. Retained-reference retrieval is bounded and reports unassessed scope; private
  subject profiles remain unresolved hypotheses, outside canonical vehicle and ownership totals. This code requires
  the protected writer deployed with the approved baseline. The additional private qualification, NULL attribution
  correction and historical reinspection proposal below remains held for separate activation; the global photo
  pipeline remains paused.
  Provider failures retain only allowlisted code, provider, HTTP status and credential-kind diagnostics. A 401 means
  the credential was not accepted by the existing API-key route; it does not prove revocation or expiry. In-memory
  sign-in/API-key shape classification never exports credential values or changes routes or provider order. A complete,
  untruncated outcome for every existing provider can certify no reading began (401, no key or lookup failure only),
  allowing the existing fresh-retry path within its same three-attempt cap and backoff. Ambiguous output/transport,
  mixed failures and already reuse-only batches stay reuse-only; finished source hashes are never reset.
  Own-account analysis status can open the existing Connected accounts screen; no key test, mutation or fallback is triggered.
  An optional `allowed_source_hashes` request map pins at most 64 exact source IDs and hashes, including all requested
  photos and any server-selected or replayed context. Outside or changed sources refuse before input capture/inference;
  it only narrows input scope and never replaces current own-account, privacy or source qualification.
- **A relation is a weight, not a status.** Owner direction, 2026-10-15: "active cant be a hard code like it is. its
  a weight. a relation goes dormant immediately after one day if not maintained by contribution. even within 24hr can
  stall." The app never shows a membership's `status` as ACTIVE. It shows the state the server cuts from
  `relation_weight` (2^(-age/6 h) of the last contribution): live, stalling, or dormant a day after the last one.
  Contributions are passive (photos at the organization's locations, its images, timeline events, contractor work),
  because nobody at work spends a minute in the app. Reads: `user_org_relations` (the profile's list) and
  `get_org_page` (`OrganizationView`). An organization opens inside the app, never on nuke.ag. The list shows on the
  person's own profile only (the owner took organizations off the profile face on 2026-06-13), and only live and
  stalling relations, warmest first: "only show active orgs. its annoying that evening side projects surface to top
  billing." Membership still
  decides permissions and the contributor gate (`fetchActiveOrgMemberships`).
- **Newest first.** Each sync pass leads with the last three days, newest first, ahead of the watermark window, and an
  original that lives only in iCloud goes to the backfill queue (the background job downloads it on Wi-Fi) instead of
  holding the watermark. On 2026-10-15 the owner's window sat in June; every open re-read the same 200 iCloud-only June
  photos and the morning's measurement shots never uploaded. Pixels follow the device rule of record
  (`VisionEngine.triage`, the same rule `scripts/ios-vision-triage` applies to stored frames): clutter and personal stay
  on the phone as metadata only; everything else, a part close-up included, uploads. The contributor firewall
  (`VisionEngine.contributorVerdict`) holds by the same rule.
  A failed decode, classifier or required face read stays in the existing bounded retry path and does not mark the
  source synced; historical photos already settled as metadata only are not automatically replayed.
  The held private-subject qualification path retains an account/hash-bound receipt from that same completed
  native pass, including original and decoded-input digests, detector completion and pinned revisions. Its protected
  intake qualifies only the owner's private subject analysis; global vision approval and processing status stay
  unchanged. Unknown or withdrawn privacy evidence stays held, including across audited copies of the same photo.
  Its held historical bridge reads bounded metadata for retained paid readings, then reinspects at most two exact
  PhotoKit originals per cool, active sync pass with network downloads disabled. A three-source reading can retain
  two leaf-specific proofs and finish the third on a later pass; replay preserves its old inputs, anchor and reading
  clock without new inference or resetting upload settlement. Missing local originals, old readings or current
  permission remain held. This separate private qualification policy requires activation approval.
  Unread historical photos are not enrolled by this replay bridge. They require a separate bounded source-enrollment
  path and approval for new paid analysis; preserving a source or correcting its filing does not create a reading.
  A finite approved repair can instead retain and verify protected readings while its original sources still qualify,
  before any separately approved NULL correction. After the audited correction, each pending leaf needs its own
  current privacy proof; the bridge then reuses the original reading and anchor. Provider authentication, an explicit
  cumulative paid-attempt budget and source/correction approval are prerequisites. An expanded cohort never resets
  the existing pilot's attempts or activates general historical enrollment.
- **Heat is a budget.** Nothing reads originals in bulk while the app is open: iCloud originals download only in
  the background job on Wi-Fi; the album review (originals + accurate OCR) runs in the foreground only on a
  charger at a nominal temperature (`LibraryIngest.mayReviewInForeground`); a foreground backfill slice waits
  when the phone is already warm (`SyncEngine.deviceWarm`); polls pause when the app is not active. Low Power
  Mode holds uploads only on battery (`SyncEngine.lowPowerHolds`): on a charger only heat holds them. A new loop
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
- **Explore keeps the ledger cohort explicit.** `LedgerMapView` browses make → family → model → year → sale,
  including a family with one model. Map/List preserves scope; Chart is deliberate, and Back returns one step.
  The confirmed-sales header opens that cohort's contributors as a list. All-sales colors are neutral; Refine
  and activity comparisons start closed. Optional comparison means sales activity share within its declared
  source cohort, not appreciation; custom windows stay on the activity board with a neutral map. The all-time
  ledger, five-year family chart ($500+; at most 600 plotted rows) and sale leaf (at most 200 rows) retain distinct
  labels. Native make labels use the shared bundled `MakeIdentityView`, with readable missing-artwork text.
- **Context survives the scroll.** The global live board, calendar and source directory start with an explicit
  All Makes boundary after the selected ledger cohort. Source rows use recorded artwork and source type;
  operational arrivals and census comparisons belong under Data coverage. A source introduction leads to its
  linked vehicle records inside Nuke. Preserve source record-date precision and keep intake clocks separate;
  an ingestion timestamp is not a new listing. Unknown vehicle bindings stay unresolved, with the attributed
  source headline and original URL behind a deliberate Source disclosure. Counts and sample limits remain qualified.
- **The board is the web's board.** `market_pulse_live` is read once per 30 s and rendered as nuke.ag renders it:
  bids in dollars (BaT runs every auction in USD; web #1061), the heat tag per lot computed exactly as
  `MarketPulse.tsx heatOf` (curve share by tier at hours left, typical = band p50 × share, hot ≥ 1.25×, cold ≤ 0.8×,
  no verdict past 120 h), the reading rows behind the tag, the week-ago line from `baseline.week_ago`. The track
  record of lots tagged this way is typed into the web page, not carried by a read, so the phone states that and
  waits (market lane plans a table + view, 2026-10-13). Prove a board change lot-for-lot against the live site as a
  stranger (Playwright pattern in memory `reference_logged_out_live_check_playwright.md`).
- **Current-bid ranges use the loaded live board.** Live offers the web's six USD bid ranges, including
  Unrecorded. Zero is recorded under $10,000; absent, negative and nonfinite bids are unrecorded. Map and
  supporting rows share the auction window and bid range; the selection count states its make/decade/window
  denominator and evaluation clock. A make or window change clears the bid range, and Any current bid restores
  all eligible rows. Filtering starts no read or inference; these are current bids, not sold prices or valuations.
- **Calendar rosters continue through the same read.** Live → Calendar uses `auction_calendar_read`, a 200-day
  horizon and explicit 100-lot pages, as the web does. More lots reads only on request. A changed read-model build,
  server day, total or repeated contributor refuses page stitching and offers refresh; a missing build clock or
  prematurely empty page leaves coverage incomplete. Retained lots are distinct from the house's listed roster.
  A lot opens its vehicle and the house's HTTPS source; earlier records retain their occurrence day, currency,
  source outcome and unconfirmed basis. Public source amounts are distinct from private ledger/value-curve money.
  Calendar and roster failures retain prior results and offer retry; no read triggers intake or inference.
- **Coverage on every counter.** A count without its population and clock is not shown; say "unknown"
  instead of guessing (fleet-relative reporting, `docs/ledger/theory/data-machine.md`).
- **No fabricated data anywhere,** including DEBUG builds and screenshots (`docs/design/CONSTRAINTS.md` C0).
  DEBUG-only deep links (`NUKE_DEBUG_*`, `NukeCaptureApp.swift`) drive the screenshot loop and are compiled
  out of Release: `NUKE_DEBUG_VEHICLE_ID=<uuid>` roots on a profile as anon, `NUKE_DEBUG_SCREEN=app|
  profile|explore|today|work|library`, `NUKE_DEBUG_JOB_ID=<uuid>` roots on that work order's `JobView` (with `NUKE_DEBUG_SCROLL_TO=job-completion|job-invoice`) (readable signed out when the reader
  allows it; `NUKE_DEBUG_CODES=1` shows raw reader codes under the plain copy),
  `NUKE_DEBUG_VEHICLE_WORK=<uuid>` hosts a vehicle's Work card alone, `NUKE_DEBUG_STATEMENT_VEHICLE=<uuid>` its statement,
  `NUKE_DEBUG_PROVIDER=<user uuid>` hosts a profile's provider face alone (no photos),
  `NUKE_DEBUG_JOBS_LOOKING=1` hosts Work's "Jobs looking for someone" alone,
  `NUKE_DEBUG_WORK_PLAN=<vehicle uuid>` hosts "Plan the work" for a listed vehicle (scroll anchors plan-work, plan-checklist), `NUKE_DEBUG_SCROLL_TO=worth|proof|asset|specs|events|photos|more`,
  `NUKE_DEBUG_EXPLORE_MODE=pulse|live|listings|map`, `NUKE_DEBUG_EXPLORE_QUERY=<text>` lands on the search
  results and `NUKE_DEBUG_EXPLORE_PAGES=<n>` walks n more pages through the door, `NUKE_DEBUG_LIVE_READING=1` opens
  the first hot or cold lot's reading on the board, `NUKE_DEBUG_LEDGER_MAKE=Chevrolet` opens that brand's models on the
  ledger map, `NUKE_DEBUG_ACTOR_ORG=<uuid>` roots on an organization's actor document, `NUKE_DEBUG_DAY=<yyyy-mm-dd>`
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

Customer cloud subject analysis uses Nuke's server credential and existing prepaid
wallet, following the owner's 2026-10-18 direction. Customers do not connect a
provider key for this path. The resolver reserves a bounded amount before one
provider call and settles only after protected reading storage acknowledges it.
Cached reading replay performs no inference or new charge. Uncertain transport or
settlement outcomes retain a pending reservation rather than starting another paid
call. The platform key, monetary migration and phone runtime must be verified
before claiming this path is active; monthly plan fulfillment is not established
by this wallet integration.

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

The own profile's **Garage** door (`Garage/`) opens the same fold (`GarageReaders.ownGarage`, shared
with the profile list) grouped by the server's relationship: owned, other interests, previously owned,
contributed; the footer states the total and its clock. A photographed or contributed vehicle is never
shown as owned. `my_unorganized_photo_count` (the web's inbox badge, capped at 1,000 and shown as
"1,000+") leads to `SessionConfirmView`, which reviews only this app's dated uploads; the screen says so.
Each vehicle opens a hub: visibility, removal or merge from `vehicle_row_read`, the Work card (jobs,
"Post a job" for an owned vehicle until `vehicle_access` says otherwise, else an inspection) and the
profile. `my_vehicles` is not read: on 2026-10-19 no `work_record` observation carried an observer and
the reader ran past the statement timeout.

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
  TodayView.swift                  native value screen: counters, thumbs, Sync Now (CaptureSections)
  Work/WorkConsoleView.swift       the Work tab: signature queue, jobs in motion, Capture
  Work/WorkSessionSignSheet.swift  confirm one work day (confirm_work_session), explicit button
  Account/ProviderLinkView.swift   technician-profile link: my_identity_read claims + self-claim filing
  Jobs/JobQuotes.swift             quote, people and statement DTOs (open prices; payments to parties)
  Jobs/AcceptQuoteSheet.swift      the customer's Sign on one quote version (accept_work_order_quote)
  Vehicle/                         Work card (vehicle_work_orders_read) and statement view
  Garage/                          owner's garage, photos to organize, per-vehicle work hub
  Profile/                         provider face (provider_profile_read) and jobs on record
  Provider/                        provider standing: link evidence (actor_link_claim_evidence_read), work days and
                                   day-rate terms (provider_productivity_read), agent-signed register (owner_delegated_signs_read)
  Contact/                         Contact via Nuke: request sheet, Work inbox, thread (in-app only)
  Explore/                         Plan the work (listing_work_plan_read) and the Order inspection Sign
  Jobs/JobCloseout*.swift + CloseoutSheets.swift  completion, invoice, payment witness, evidence Signs
  Library/JobAttachBar.swift       select mode → Attach to job (job_evidence_candidates_read + attach_job_evidence)
  Jobs/JobOffers.swift + Work/JobsLookingSection.swift  open requests, match table, offers (offer/accept Signs)
  Jobs/                            JobView over work_order_job_path_read; DTOs, readers, stage rail
  SyncEngine.swift                 PhotoKit watch + watermark + dedupe + GPS gate
  SupabaseService.swift            auth, storage upload, vehicle_images insert
  Config.swift                     public URL/anon key, shop-gate geometry, tuning
```
