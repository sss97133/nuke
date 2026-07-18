# ANALYSIS DIRECTIVE — addendum: the data-scope axis & the missing local store

> **Why this file is HERE (not in a side-doc):** the disease we keep hitting is
> agents missing the architecture and re-hardcoding. A doc you must go *find* gets
> missed. So the load-bearing summary of this addendum lives in the auto-read
> `apps/nuke-capture-ios/CLAUDE.md` (the harness injects it — an agent cannot miss
> it) and points HERE for the long form. Contract-with-the-code: the auto-read
> channel carries the rule; this file carries the reasoning.
>
> **Status:** agent contribution for corroboration (Claude Code, 2026-06-25),
> extends `ANALYSIS_DIRECTIVE.md`. NOT canon until Skylar reconciles it with the
> other agents. Current-code claims were read directly (cited); unverified claims
> are marked **[HYPOTHESIS]** per `production-engineering.md`.

---

## 1. The frame (Skylar, 2026-06-25)

The product pipeline is NOT the dev dynamic (Skylar + Claude + BYOK on 75K photos).
In the product **we are not in the loop**: a mass user downloads the app; the app is
a dumb local agent that gets image access + an instruction book ("the app version of
our DB") and runs **local-first**; the user **chooses** to escalate to the cloud.

**Two orthogonal axes** — conflating them is why the pipeline feels tangled:

- **Axis A — compute tier** (*who runs analysis*): T0 on-device → T1 BYOK → T2 hosted.
  Already canon (`ANALYSIS_DIRECTIVE.md` §"three analysts").
- **Axis B — data scope** (*where data lives / what confidence it draws on*): local
  instance → garage/org federated ("local cloud") → global cloud. **Modeled nowhere.**

**Governing principle (resolves local-vs-remote):** *local by default; reach for
remote only when (a) the user wants what only other users' data can give, or (b) you
need confidence that by definition can't live on one device.* The remote DB is **built
from** the thousands of local DBs — "remote confidence" is just pooled local instances.
That is the chicken-and-egg, answered.

---

## 2. What EXISTS (verified by reading `apps/nuke-capture-ios/Sources/NukeCapture/`)

The local-first instinct is substantially built. Develop from it; do not rebuild.

- **Free local map — `IgnitionEngine.swift`:** scans the whole library reading only
  `creationDate` + GPS (no pixels, no network, L142–197), clusters ~75 m work-site
  candidates (L205–246), one-tap "That's my shop / Not mine" (L273–288), "NOTHING
  uploads during ignition" (L5). = the free-tier → group → human-confirm loop.
- **Gate-by-architecture — `VisionEngine.swift`:** `triage()` (L161–169) is the
  pixels-vs-metadata split (`pixelsEligible = isVehicle && !prominentFace`, returns
  Apple ML labels, caller ANDs `!isSensitivePhoto`); `contributorVerdict()` (L130–135)
  the multi-user firewall. Free, Neural Engine, ~50ms/img.
- **Upload gate — `SiteStore.swift`:** confirmed sites are "the gate the SyncEngine
  checks before any photo leaves the phone" (L4–6). `fetchAndMergeServerSites()` already
  syncs priors DOWN and caches locally — the pattern to generalize.
- **Escalation plumbing — `SyncEngine.swift` / `NetworkMonitor.swift`:** watermark sync,
  backfill, `drainUntilEmpty`, Wi-Fi-gated drain. Consent surface = live gauge + pause.

**Implication:** the public-bucket leak class is already structurally addressed on-device.
The missing piece is not the gate — it's the **store** behind it.

---

## 3. The VERIFIED gap — there is NO local store (the real greenfield)

> **✅ RESOLVED 2026-06-25 — this gap is CLOSED.** The local store is **built**:
> `Sources/NukeCapture/LocalStore.swift` (GRDB, identity-first mirror of prod:
> `image_identity → appearance → vehicle_image`, v1–v3 migrations), wired into the Library
> glasses + info sheet. **§7 Q1 is decided: GRDB, not SwiftData.** The section below is the
> original diagnosis — kept for the reasoning, no longer the to-do. **Extend `LocalStore`;
> do NOT create a second/parallel store.** What's still open is *closing the loop* (wire
> `ingest()` + a `dayCounts()` window so a record renders network-off) — see the iOS
> `CLAUDE.md` ▶ NEXT BUILD, not a rebuild of the store.

**Verified (grep, 2026-06-25):** no `GRDB/SQLite/CoreData/SwiftData/Realm` anywhere in
`Sources/NukeCapture/`. All on-device state is **`UserDefaults`**: counters/flags
(`totalSynced`, `totalSkipped`, `totalHeldPrivate`, `backfillQueue`, `seenSet`,
`watermark`, `libraryTotal`, `relevantTotal`, `paused`, `contributorMode`) + `confirmedSites`
as JSON. So local today = **scanner + gate + sync-bookkeeper that forwards to the cloud.**
It is NOT a store of the user's own observations. Consequences:

1. **The directive's core promise is currently FALSE.** `ANALYSIS_DIRECTIVE.md` L69–71:
   *"run T0 forever, never upload a byte, still get every window."* Can't — no local
   landing zone, no window reads local. Every window reads the cloud ⇒ **value REQUIRES
   upload.** That inverts local-first.
2. **The T0 on-device analyst (directive L80, "the only greenfield") has nowhere to
   write.** Even once built, without a local store its verdicts can only upload.
3. **"Finite local value" is unrealized.** A single user's data should be a complete,
   sovereign local product; today the local instance produces a gated upload queue.

**Missing organ = the local store ("the app version of our DB").** It is the foundation
the whole data-scope axis stands on, and the piece Skylar correctly flagged as unstable —
because it's the one nobody built.

---

## 4. The bridge — cloud teaches, local remembers

Resolves the "triggers" tension (does detecting a *known* workspace break local-first?):
split **learning** from **inference**. The cloud LEARNS priors from all users (the
garage-GPS map, known-site labels, learned thresholds, known-VIN set) and SYNCS them
DOWN; the device REMEMBERS them and infers free/offline. **Remote calls = occasional
learning, never per-photo inference.** Already the shape of `SiteStore.fetchAndMergeServerSites()`
— generalize from "sites" to "all priors."

---

## 5. Data-scope tiers (proposed; for corroboration)

| Scope | Lives | Unlocks | State today |
|---|---|---|---|
| **Local** | device store ("app DB") | the user's own map/timeline/worth-proof | **store missing** — UserDefaults only |
| **Garage/org** ("local cloud") | shared org record | coworkers, shared sites | "blocked until contributor graph fills" (iOS CLAUDE.md) |
| **Global cloud** | big-brain DB | year/make/model/geo across users | exists; the ONLY scope a window reads today |

Higher scopes are built FROM lower ones. Promotion local→shared→global is a
human-confirmed trust climb (proven › attributed › projected) — never silent.

---

## 6. Verified-vs-hypothesis ledger

**Verified by reading code:** §2 on-device facts; §3 no-local-DB; directive promises cited.

**[HYPOTHESIS] — from the earlier read-only ingestion map, NOT live-probed:**
- "Analysis orchestrator dead since 2026-05-03 (~73K snapshots unextracted)." Probe before acting.
- "Publish surfaces never read `vision_gate_status`." Partly in `ISSUES.md`; confirm vs prod.
- "`ingest_image_observation()` is phantom." May be `database/migrations` tree drift, not a real gap. Verify before declaring the image→observation chain broken.

---

## 7. Open questions — Skylar's / the fleet's to decide

> **Q1 CLOSED (2026-06-25): GRDB** — built as `LocalStore.swift`. Q2 partly answered (the
> identity-first appearance schema is in place). Q3 still open.

1. ~~**Local-store tech:** SwiftData vs GRDB/SQLite.~~ → **GRDB, decided + built (`LocalStore.swift`).**
2. **The local schema:** which prod tables mirror DOWN (vehicle_images, vehicle_observations, work_sessions, user_sites) and at what grain — the "instruction book" the app gets at download.
3. **Garage/org tier:** wait for the contributor graph, or design the local store NOW so the federated tier is a later read-up, not a rebuild?

---

## 8. Corroboration contribution — source-wiring + compute-tier evidence (Claude Code, 2026-06-25, later session)

Second agent, same goal. Everything below was **live-probed against prod or read from
code/build** this session — not inferred. It corroborates §1–§3 and corrects one ledger
hypothesis.

**A. Axis A proof — T1 currently runs OUTSIDE the app (verified, prod).** The deep verdict
on Skylar's Mustang frames (e.g. `IMG_0195` = `d0de3544-fff2-4a7c-9a9b-15f64b527b71`,
`analyzed_at` 2026-06-21) carries `extraction_method: "byok_claude_print_read_tool"`,
`agent_model: claude-opus-4-8`. That is the Claude CLI reading the image via the Read tool
in a **script** (dev/launchd), not an in-app call. → Hard confirmation of the addendum's core
point: the T1 loop is **not in the app**. The app does T0 (Apple Vision `triage` → the noisy
`apple_ml_labels` on the row) + observe + upload only. **This is the "key-exchange loop is not
in the app" gap, with provenance.**

**B. Corrects ledger [HYPOTHESIS] §6.1 ("orchestrator dead since 2026-05-03, ~73K unextracted").**
Partly false. The BYOK deep path produced real `byok_v3_camera_pose` verdicts as recently as
**2026-06-21** (cited above). "Dead" overstates it — it's "runs only when a human/launchd fires
the script" (= the same root as A: not in the app). The **backlog** is real (prior session:
~11.5K of 42K Mustang images ever analyzed), the **"dead orchestrator"** is not.

**C. NEW layer this addendum doesn't yet cover — source-of-truth wiring (EXIF date/GPS).**
Even where cloud rows exist, capture-relay provenance is corrupt: `taken_at` was written from
`PHAsset.creationDate` (the iCloud re-add / device-migration date), proven **~6 months off** on
real frames (file EXIF `2019-04-29` vs stored `2019-10-25`), device wrong (file `iPhone XS` vs
DB `iPhone 11 Pro`), GPS absent from `exif_data` (it IS in the `latitude`/`longitude` columns).
The corruption is non-uniform → only re-reading the file fixes it. **Forward fix already in code
on BOTH branches** (`SupabaseService.swift:345` prefers `exifCaptureDate`; `CameraEXIF.captureDate`
reads the file's `DateTimeOriginal`); the corrupt rows are from older builds.
→ **Design consequence for the local store (§7):** the local "app DB" must source date+GPS from
`PHAsset`/file EXIF, NEVER trust a mirrored cloud `taken_at`. The DB column lies; the file is truth.

**D. The write-back / consequence gap (verified).** The engine self-polices integrity — IMG_0195
& IMG_0196 verdicts both say *"NOT the subject 1966 Mustang"* with `needs_clarification: true` —
yet both rows are **still bound to the Mustang with the wrong date.** Nothing forks/demotes on the
flag. §5's promotion trust-climb needs its inverse: a **demotion/fork path** when a verdict
contradicts its binding. Today verdicts are produced and parked. A parked verdict = silent failure
(`production-engineering.md` §6).

**E. Coordination flag (branch divergence — clobber risk).** A backfill reconcile —
`SyncEngine.reconcileLibrary()` + `SupabaseService.fetchReconcileTargets()/reconcilePhoto()` —
that re-reads each synced asset's true EXIF **on-device via `PHAsset` (NOT storage re-download —
egress-safe, honors the §"Images + cost" rule)** and patches `taken_at`+GPS, joined by
`exif_data.uuid` = `localIdentifier`, is **built + `BUILD SUCCEEDED`** on branch
`fable5/engine-surface` (worktree `ios-engine`). It is **NOT on `ignition-ios`.** Needs porting/
reconciling. It is the first concrete "wire source → consequence" artifact (corrects only the date
half; the fork-on-misattribution half from D is unbuilt).

**Net for the path forward:** §3's missing local store remains the foundation, AND it must be fed
by a corrected source layer (C) and drain to a consequence layer (D). Three organs, one spine:
**source-of-truth (file EXIF) → local store (the greenfield) → consequence (correct/fork/promote).**
Today only the middle has a gate but no body, the source leaks, and the consequence is unwired.
