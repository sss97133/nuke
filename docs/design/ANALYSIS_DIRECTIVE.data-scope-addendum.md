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

1. **Local-store tech:** SwiftData (native) vs GRDB/SQLite (portable, closest to "app version of our DB").
2. **The local schema:** which prod tables mirror DOWN (vehicle_images, vehicle_observations, work_sessions, user_sites) and at what grain — the "instruction book" the app gets at download.
3. **Garage/org tier:** wait for the contributor graph, or design the local store NOW so the federated tier is a later read-up, not a rebuild?
