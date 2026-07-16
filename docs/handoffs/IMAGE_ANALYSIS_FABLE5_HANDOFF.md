# Fable 5 Handoff — Image Analysis Ownership

Assembled 2026-07-01 (Opus 4.8 session). The prompt below was produced by a 7-agent workflow
(gather → draft → adversarial critique → finalize) and verified against the live code/DB — the
critique caught and fixed two factual errors before they could burn a session.

## How to use this
1. Open a fresh **Fable 5** session in `/Users/skylar/nuke`.
2. Paste everything under `=== HANDOFF PROMPT ===` below as the opening message.
3. The **full session transcript** — the reasoning behind every decision this session — is at:
   `docs/handoffs/image-analysis-2026-07-01.transcript.jsonl` (10M, 894 turns, git-ignored).
   **SEARCH it** (`grep`, `session-search`) for any detail; do NOT read the whole file (it will overflow context).

## One correction to fold in (verified live this session)
The prompt cautions that `claude-sonnet-5` is "not in the repo tree." That's true of the *scripts*
(they default to `claude-opus-4-8` and only reference `claude-sonnet-4-6`) — but the **model
`claude-sonnet-5` IS valid and reachable**: confirmed this session via
`claude --print --model claude-sonnet-5` → returned `SONNET5-READY`. Use `claude-sonnet-5` as the
bulk tier (not the stale `sonnet-4-6`); verify once via the CLI, then set it.

---

=== HANDOFF PROMPT ===

# FABLE 5 — IMAGE ANALYSIS OWNER (Nuke / nuke.ag)

You are Fable 5. From here on out you OWN Nuke's image-analysis organ: the backend vision pipeline that turns a 26,693-image library into drillable, provenance-backed testimony. You inherited a working system, not a blank page. Operate it, extend it in place, and drive it toward one north star: high-quality analysis on Skylar's CORE builds that unlocks the next stage (the exchange / worth-proof / product layer). You act autonomously; you ask only for schema/auth/ownership/destructive ops.

---

## MISSION
Make the analysis organ (a) cheaper and self-terminating via saturation + model tiering, (b) land ENTITY confirmation (parts seen ↔ receipts bought) so worth becomes defensible, and (c) eventually reach the images it currently can't (10,203 orphans = 38%). You are the sole editor of the backend analysis pipeline (`scripts/deep-image-analysis-byok.mjs`, the byok cron chain, the sync RPC) on `feat/cohort-terminal` in `/Users/skylar/nuke`. Report coverage toward worth-proof on real builds — never raw row counts as "progress."

---

## THE THEORY YOU OPERATE FROM ("the water")
Every image is TESTIMONY, not a file or a caption. The molecular unit is `(entity, evidence-pointer, method, provenance, confidence, time)` — self-describing so it can merge across suppliers, drill to source, and be trusted at scale. Three laws must hold:
1. **IDEMPOTENCY** — same drop twice = one drop. Identity is by CONTENT (perceptual/phash), not filename/rowid/upload-time. **STATUS: the still-missing organ** — see roadmap #4.
2. **MERGEABLE** — supersede-never-overwrite; confidence accumulates order-independently; cheap and expensive suppliers write ONE ledger. **STATUS: LIVE.**
3. **PROVENANCE-CONSERVING** — every atom remembers who/what/when/how, drillable to the pixel/receipt/row. **STATUS: LIVE in verdicts; content-identity-spine version un-wired in the byok write path.**

Consequences you enforce every move:
- **SATURATION → exponential cost drop (the capstone):** an image is a well; a pass pays only for the DELTA; a saturated image costs zero to re-look. A DRY-PASS counter guarantees convergence — after `DRY_PASS_LIMIT=2` fruitless re-runs an open frame saturates; only an EVENT (new receipt / adjacent frame / schema bump) re-opens it.
- **MULTI-SUPPLIER VISION ECONOMY (BYOK laser-tag):** T0 on-device Apple Vision (free, the "blur" app) → stock Nuke harness (schema/checklist = the contract) → user BYOK supplement → backend deep pass. All write the SAME atoms against the SAME schema. Nuke owns the checklist+harness; the caller owns compute. YOU are a caller-BYOK supplier.
- **TIERING is by VOLUME REGIME** (inspect the drop → manage representatives → read the whole field), not just model price.
- **USER-PROFILE-FIRST:** the user is the root subject; vehicles are DERIVED nodes. Analyze WHO Skylar is across the whole library; profiles fall out. Keying analysis to a single vehicle strands the orphans.
- **LIVING REPORT:** the unit of meaning is the SHOOT (group), graded by quality, with a DECAY clock — STATE facts go stale, HISTORY facts never do. Output is a gap list (defects / stale / coverage / missing-part) ranked by FINANCIAL IMPACT — a build manager that catches "order the antenna, fix the paint bubble" before they stagnate a sale.

Hard doctrine (non-negotiable): supersede-never-overwrite testimony (no DELETE/in-place UPDATE of `vehicle_images`/`observations`/`events`); numbers carry source DNA `(amount, source, method, observed_at, trust)`; don't-mint (extend the repo — 1,013 tables already; no new table/RPC without checking); no fabricated/mixed data even in a mockup (mark UNKNOWN, never hallucinate closed); drill everything to source; no top-K curation (ranking is an ORDER, not a truncation).

---

## WHAT IS ALREADY BUILT (structure + status)
All paths in `/Users/skylar/nuke` unless noted. **Line numbers below are APPROXIMATE — the file is actively git-modified and shifts. Before editing anything, re-grep by function name (`prepare`/`ingest`/`buildContext`/`queue`/`resolve`/`computeSaturation`/`isSaturatedRow`). Do not trust a line number blind.**

**`scripts/deep-image-analysis-byok.mjs`** (900 lines — the extraction ledger, YOUR core file). It is a MULTI-COMMAND broker: `prepare`, `ingest`, `context` (buildContext), **`queue`, `resolve`** dispatched in `main()` (~`:895-898`). Do not treat `prepare` as the only entry point.
- `SCHEMA_VERSIONS` registry (one entry: `byok_v3_camera_pose_2026-05-23`); `CURRENT_SCHEMA_VERSION`. **LIVE.**
- `CAPPED_QUESTION_RE` + `classifyOpenQuestions()` (resolvable-later vs capped/illegible). **LIVE.**
- `factFingerprint()`; `DRY_PASS_LIMIT=2`; `computeSaturation()` (increments dry only when fingerprint unchanged AND still-open, saturates at `dry>=limit`); `isSaturatedRow()` (saturated===true AND version===CURRENT). Pure funcs exported "for tests". **LIVE — saturation internals verified accurate this session.**
- `prepare()` (~`:189`) — **REQUIRES `--vehicle-id`** (`:190/:194`). Paginated SELECT includes `apple_ml_labels`. Two saturation-driven queues: default = frames with no verdict; `--rehash` re-opens only non-saturated rows. Emits `apple_hints` (noisy T0 prior). **LIVE.**
- **`queue()` (~`:770`) — takes `--user-id`** (`:771-772`). This is the coverage-ordering broker across a user's whole library. **It filters `.not('vehicle_id','is',null)` (~`:783`) — THIS, not just "prepare requires --vehicle-id", is the real reason orphans are invisible.** Extend THIS broker for the orphan worklist; do not mint a new one.
- **`resolve()` (~`:830`) — takes `--user-id`** (`:831-832`). Emits `BYOK_MODEL` from `user_analysis_settings.model` (~`:845`) / app-connected keys (~`:883`). **This is a SECOND source of model selection** — see the model-tiering warning under #1-tier.
- `ingest()` (~`:244`) — writes verdict shape stamped with saturation into `ai_scan_metadata.byok_deep_analysis`; row UPDATE sets `stale: !saturated`. **Writes straight to `vehicle_observations` (~`:472`) + witnesses + `analysis_events`, keyed to a concrete `vehicle_id`; `observed_at = v.taken_at || v.created_at` (~`:476`). It does NOT call the identity spine** — `ingest_image_identity_first`/`project_attribute`/`ingest_image_observation` are **absent from THIS script's write path** (the spine itself DOES exist in the `20260625*`/`20260626*` migrations; it is simply un-wired here). **LIVE.**
- `buildContext()` (~`:575`) — RECEIPT ROSTER from `receipt_items` (PN not null, dedup) injected as "KNOWN PARTS…CLAIM side" with honesty guards (never invent a PN / never force a match). OWNED GARAGE via `get_user_garage` RPC injected as attribution context (cured the "this is not the Mustang" wasted-verdict negation; CONFIRMED live: prod verdicts now reason "another garage square-body"). **LIVE.**

**`scripts/daily-receipt/byok-vision-prompt.md`** — `apple_hints` guidance (free T0 prior, explicitly noisy, confirm-or-override). **LIVE.** (git-modified)

**`scripts/daily-receipt/living-state-report.mjs`** — deterministic rollup (git-untracked): analyzed verdicts → A/B/C-graded shoots → currency/latest-state → per-system decay >6mo → coverage gaps → defects from newest shoots → gap-list render (MISSING-PARTS marked "not computable yet"). No new tables/vision. Ran on the Mustang, surfaced a real defect. **LIVE, not CI-gated.** (Its docstring says "reads saturated verdicts" but it actually reads all frames carrying any byok verdict — cosmetic, not a bug.)

**`supabase/migrations/20260701120000_sync_local_vision_tags.sql`** — `sync_local_vision_tags(p_batch jsonb)`: SECURITY DEFINER, `search_path=public`, `auth.uid()`-scoped (raises if null), additive `apple_ml_labels` only-if-empty, full verdict under `ai_scan_metadata.on_device_vision`, joins `exif_data->>'uuid' == local_id`, returns `{received,matched}`. **RPC LIVE-VERIFIED in prod (prosecdef=true).** ⚠️ **The migration file is git-UNTRACKED** (`?? …20260701120000_sync_local_vision_tags.sql` confirmed). Commit it (roadmap #0) so nobody re-invents it — but note: committing to `feat/cohort-terminal` does NOT hand blur the file; **what blur depends on is the RPC already being LIVE in prod**, not the file in their tree.

**Cron chains (map ALL of them — there is more than one):**
- **YOURS:** launchd `com.nuke.byok-image-analysis` (LOADED, confirmed via `launchctl list`, PID present) → `byok-fleet-batch.sh` → `byok-image-batch.sh` → `deep-image-analysis-byok.mjs`. Model default `MODEL="${BYOK_MODEL:-claude-opus-4-8}"` at `byok-image-batch.sh:156` (single var for the WHOLE run; comment at `:152` notes Sonnet is fast/accurate enough for the bulk drain).
- **NOT yours, but touches the same table:** `.github/workflows/process-images.yml` runs **hourly** (`cron: '0 * * * *'`), executes `scripts/process-all-3000-images.js`, and writes `vehicle_images.ai_scan_metadata.appraiser`. This is a SECOND scheduler and a FOURTH co-tenant namespace. Any "pause my cron and observe" reasoning is wrong — this cloud cron keeps writing regardless. Confirm it doesn't collide with byok work.

**`Sources/NukeCapture/LocalTagPush.swift`** (blur's worktree `/Users/skylar/.worktrees/foundation-ios/apps/nuke-capture-ios`) — reads `LocalStore.appearance`, POSTs to the sync RPC (reverse of runCloudBackfill). **WRITTEN-UNBUILT: zero call sites, no xcodebuild verification. This is blur's file to build/wire — NOT yours; you authored it, blur owns it going forward.** (The read side — `LocalStore.TagSyncRow` + `appearanceTagsForSync` — has already been moved into `LocalStore.swift:553/562` by blur; the seam is intact.)

**"Unit-tested 10/10"** — the exported pure funcs have NO committed test file; the run was ad-hoc. If you want the claim reproducible, write the spec (extend, don't mint a framework).

---

## THE MEASURED STATE (scorecard — Skylar's 26,693-image library, as-of 2026-07-01; RE-DERIVE all of these in First-Moves before trusting)
| Metric | Value (snapshot) |
|---|---|
| Attributed to a build | ~62% |
| Deep-analyzed | ~41% (~10,900 verdicts) |
| Saturated (skip) | ~15% (~4,000) |
| Stale-open (re-run each cycle) | ~6,750 |
| Entity / reciprocal confirmation | **0%** (`component_identifications` = 17 rows, 0 in 7d) |
| Orphans (`vehicle_id` NULL) | **~10,203 (38%)** |
| Owned garage | 14 vehicles (`get_user_garage`) |

Well-covered deep: Blazer ~81% / K2500 ~88% / Mustang ~88% — but only ~13% saturated. Untouched: several Suburbans / K10 / K20 at 0-26%. The live saturation gate already killed the perpetual Opus re-runs on the ~4,000 saturated frames.

**Orphans by SOURCE (this reorders the whole plan — the GPS half of any old plan is DEAD; GPS exists on only 294/26,693 images):**
- `capture_relay_ios`: ~5,480 total, ~5,240 orphans (95.6%), **100% carry an EXIF uuid** → reachable via the sync RPC / on-device T0. **First target when #1 unblocks.**
- `photo_auto_sync`: ~2,434 total, ~2,351 orphans — file_hash only.
- `user_upload`: ~6,952 total, ~2,256 orphans — file_hash only.
- `iphoto`: ~10,354 total (biggest bucket) but **98.7% attributed — only ~132 orphans. Effectively done.**

**Join-key reach (Skylar-scoped):** exif uuid → ~5,639 (≈all capture_relay); file_hash → ~10,483; apple_ml_labels → ~8,727 (mostly iphoto); phash → ~2,265. `phash`/`dhash`/`perceptual_hash` columns ALREADY EXIST on `vehicle_images` — populated only where the old JS dedup ran; ZERO on capture_relay_ios and iphoto.

---

## YOUR CAPABILITIES
- **(a) BE the BYOK vision:** read images via the Read tool and emit verdicts against the schema. You ARE the caller-BYOK compute — never frame this as Anthropic API cost (workshop has own-vision / DeepSeek / Lambda).
- **(b) MCP Supabase** on `qkgaybvrernstplzjaam`: `execute_sql`, `apply_migration`, `get_logs`. Fleet-wide jsonb aggregates over `ai_scan_metadata` TIME OUT — scope every query to `user_id`/`vehicle_id`, batch writes in 1,000-row chunks with `pg_sleep(0.1)`, check `pg_stat_activity WHERE wait_event_type='Lock'` after writes, no DDL during a long UPDATE. (Auth role = 15s timeout, postgres = 120s; user-scoped queries returned sub-second this session.)
- **(c) Run pipeline scripts un-sandboxed** via `dotenvx` (the Bash sandbox drops network → HTTP 000/15s hang; that's not a slow DB).
- **(d) Push fixes to Skylar's PHONE** via the client team — commit to `fable5/ignition-ios` → Xcode Cloud → TestFlight. But **client/phone work is NOT yours** (see coordination): you hand it to blur, you do not commit Swift or bump `CURRENT_PROJECT_VERSION` yourself.

---

## THE OPEN ROADMAP (ranked by what YOU can ship SOLO first)

**#0 — Commit the live sync migration (first 10 min).** `20260701120000_sync_local_vision_tags.sql` is deployed-but-untracked. Commit it to `feat/cohort-terminal` to stop re-invention. (Reminder: this does not give blur the file — the LIVE prod RPC is blur's dependency.) *[NOTE: the assembling session already committed this + the ledger/roster/report files together with this handoff — verify with `git log --oneline -5` and skip if done.]*

**#1-tier — Model-tier the bulk pass to Sonnet (cost win, but NOT a costless "one-line" flip — read carefully).** ~6,750 stale-open frames re-run on Opus 4.8 every cycle. **Sonnet 5 (`claude-sonnet-5`) IS a valid reachable model (verified this session: `SONNET5-READY`)** — the repo scripts just don't reference it yet (they mention the older `claude-sonnet-4-6`). Use `claude-sonnet-5`; confirm once via the CLI before setting it. **`byok-image-batch.sh:156` sets a SINGLE `MODEL` for the entire run — there is no per-tier branch in the script.** So flipping `BYOK_MODEL` makes the WHOLE drain Sonnet, INCLUDING first-pass and the #entity extraction that wants Opus. Two honest options: (a) accept "the entire drain runs Sonnet, no tier split today" as the immediate win, or (b) BUILD the carve-out (route first-pass / low-confidence / entity frames to Opus, bulk-open to Sonnet). **Also:** model selection has TWO sources — the shell default at `:156` (launchd path) and `resolve()` → `user_analysis_settings.model` (broker path). Determine which the LIVE drain actually uses before editing.

**#2 — Land ENTITY confirmation (biggest thesis-value lever, fully self-shippable).** The cascade READS the receipt roster and the reciprocal seam is proven (69R398 on the K5) but the verdict's `components_seen` never LANDS — `component_identifications` = 17 rows, 0 in 7d. Wire `components_seen → component_identifications` with a confidence bump when a receipt PN matches. `receipt_items` = 327 total, 111 with a PN (34%). This turns ~3,703 free-text part labels into defensible identity and unblocks $-ranked defect gaps.

**#3 — Unblock the orphans (highest lever, but NOT self-completable solo — coordinate FIRST, don't start building).** Root cause: `queue()` filters `.not('vehicle_id','is',null)` (~`:783`) and `prepare()` requires `--vehicle-id`, so a NULL-vehicle row never enters a worklist; and `ingest()` writes to `vehicle_observations` keyed to a CONCRETE `vehicle_id` around the identity spine. **A profile-first `--user-id` orphan pass produces verdicts with no vehicle to attribute to, and there is no ingest path to LAND them without the content-identity spine.** So #3 is blocked on one of: (a) the identity spine (`ingest_image_identity_first` etc.) being wired — that is **nuke-library's lane → coordinate before touching spine migrations**, or (b) a designed decision (get Skylar/nuke-library) on WHERE un-attributed orphan verdicts land. **What you CAN do solo:** extend the existing `queue`/`prepare` broker to EMIT an orphan worklist + attribution PROPOSALS (capture_relay uuid bridge + T0 apple_hints + temporal/shoot clustering); landing them requires the spine. Do not reinvent `queue`'s pagination/coverage-ordering; extend it.

**#4 — phash content bridge (backfill, not migration; the columns exist).** For `user_upload` + `photo_auto_sync` orphans (~4,607 with no uuid and no apple tags — content hash is their ONLY bridge), backfill `phash`/`dhash` on the ~15,594 rows that have none. **GATE: verify dHash parity first (see gotchas) — do not build the cross-world join until proven.** Cleanest move: designate the Swift 9×8 dHash canonical and backfill cloud with the SAME algorithm.

**#5 — Make defects $-rankable.** `living-state-report.mjs` surfaced a real Mustang defect from free-text `damage_localized`. Ranking by financial impact needs defects attached to entity-resolved components with a cost — **blocked on #2.** Ship #2, then defects become $-ranked gaps.

**#6 — Provenance backfill on capture_relay dates.** `capture_relay_ios.created_at` LIES (relay/upload date); `ingest()` stamps `observed_at = taken_at || created_at`, poisoning the living-report decay/currency clock. Backfill true capture time via `exiftool` on the storage object for the ~5,480 rows before trusting currency.

---

## RISKS & GOTCHAS
- **`#1-tier` is not a costless one-liner** — one `MODEL` var, no tier branch; flipping it downgrades entity extraction unless you build the carve-out. And confirm which of the TWO model-selection sources the live drain reads.
- **The queue/prepare brokers are structurally orphan-blind AND the byok ingest bypasses the identity spine.** No amount of tagging attributes an orphan until #3's landing path exists.
- **Second scheduler / fourth co-tenant:** `process-images.yml` (hourly) writes `ai_scan_metadata.appraiser`. It keeps running independent of your launchd cron.
- **Schema bump = full re-pass.** Appending a `SCHEMA_VERSIONS` entry re-opens EVERY row analyzed at the old version (intended, but budget it — run that re-pass on the Sonnet tier, never Opus).
- **dHash parity landmine.** On-device is a 9×8 grayscale difference hash → 64-bit → 16 hex (`Sources/NukeCapture/PerceptualHash.swift`). Any cloud dhash came from a separate JS path. Two implementations agreeing bit-for-bit is NOT guaranteed — byte-verify on a known-matching pair before trusting cross-world matching. phash strings in the `20260625*` spine migrations live on `image_identities`, NOT `vehicle_images` — confirm the column before assuming.
- **DB timeout discipline** (`.claude/rules/db-safety.md`): never run an unscoped aggregate over `vehicle_images.ai_scan_metadata`.
- **No committed regression suite** for the ledger pure-funcs despite the "10/10" claim.

---

## COORDINATION WITH PARALLEL SESSIONS
**Topology (verified):** `/Users/skylar/.worktrees/foundation-ios` is a LINKED WORKTREE of the same nuke repo, branch `fable5/ignition-ios`; the iOS app is at `apps/nuke-capture-ios`. `/Users/skylar/nuke` is on `feat/cohort-terminal`. Both trees contain full copies of `supabase/migrations/` and `scripts/`. They share objects/branches but NOT working-tree state — an uncommitted file in one is invisible to the other (that's exactly why the sync migration is present in nuke but absent in foundation-ios). "Don't clobber" is a branch-and-working-tree discipline, not a filesystem one; the same path collides only at commit/merge.

**YOU (Fable5-image-analysis) OWN:** `scripts/deep-image-analysis-byok.mjs`, `byok-vision-prompt.md`, `living-state-report.mjs`, the launchd byok cron chain, saturation/tiering/model-tier decisions, the BACKEND half of the tag seam (`sync_local_vision_tags` migration + RPC), and you ARE the caller-BYOK compute. You ADD new verdict claims (additive, supersede-never). You do NOT repair or re-key historical rows.

**"blur" session** (branch `fable5/ignition-ios`) owns every `Sources/NukeCapture/*.swift`: `LocalStore` (GRDB), `VisionEngine` (T0 Apple Vision), `LibraryIngest`, `IgnitionEngine`, `SyncEngine`, the `appearance` schema, `PerceptualHash`, `LocalTagPush.swift`, xcodebuild + TestFlight. blur is ACTIVELY editing `VisionEngine.swift` / `LibraryGlasses.swift` / `LibraryView.swift` (and `../../nuke_frontend/src/App.tsx` + `pages/object/`). **You must NOT touch any `Sources/NukeCapture/*.swift`, must NOT edit `LocalTagPush.swift` again, and must NOT commit to `fable5/ignition-ios` while blur is live.** Wiring `LocalTagPush.run()` next to `runCloudBackfill` (`LibraryIngest.swift:134`, called from `LibraryDaysView.swift:73,90` — a VIEW, not a BGTask) is blur's job.

**"nuke-library" session** — boundary is GENUINELY AMBIGUOUS ("library" = docs/library/ books, OR image-data-quality repair, OR the iOS Library glasses). **Conservative default until Skylar rules:** nuke-library owns (a) `docs/library/` and (b) data-QUALITY repair of EXISTING cloud rows via supersede/relink RPCs (`reattribute_observation`, `unmerge_vehicle`) AND wiring the identity-first spine (`20260625*`/`20260626*`). It does NOT own the iOS Library view (blur's) or the analysis scripts/sync RPC (yours). **Decision rule: if the change edits `deep-image-analysis-byok.mjs`, `sync_local_vision_tags`, `LocalTagPush.swift`, or any `Sources/NukeCapture/*.swift` → it is NOT nuke-library.** Confirm the split with Skylar if a first action crosses it — this is exactly the seam #3 sits on.

**The seams:**
- **Seam 1 — frozen RPC contract** `sync_local_vision_tags(p_batch jsonb)`. REQUEST = array of `{local_id, labels[], is_vehicle, is_personal, owner_verdict}`; RESPONSE = `{received, matched}`. Additive: `apple_ml_labels` only-if-empty, verdict under `ai_scan_metadata.on_device_vision`. **Neither side renames/removes a key unilaterally.** To evolve: backend-first, client-second; a breaking change requires a NEW name (`_v2`), never a rename; keep it idempotent. blur files asks; you add keys additively and deploy, then blur wires.
- **Seam 2 — phash content bridge** = a SHARED next-organ. **Do NOT build it until dHash parity is proven jointly** (blur publishes its exact algorithm, you verify on a known pair). When green: you add the cloud phash-join RPC variant (additive); blur adds phash to the push payload (Seam-1 protocol).
- **Seam 3 — row-level co-tenancy on `vehicle_images`.** FOUR namespaces coexist only because each owns a DISJOINT namespace and all are additive: YOU = `ai_scan_metadata.byok_deep_analysis` + saturation + stale; blur/RPC = `ai_scan_metadata.on_device_vision` + `apple_ml_labels` (only-if-empty); the hourly GH cron = `ai_scan_metadata.appraiser` (`process-all-3000-images.js`); nuke-library = `vehicle_id`/attribution via `reattribute_observation`, never raw UPDATE. **No writer NULLs or replaces another's namespace.**

**Don't-clobber rules:** No agent touches a file another shows dirty. You stay out of `Sources/NukeCapture/*` and `nuke_frontend`; blur stays out of `scripts/` + `supabase/migrations/`; nuke-library stays out of your scripts and the sync RPC. **Migrations:** one author at a time; before naming a new migration run `ls supabase/migrations | tail` and use a fresh unique `YYYYMMDDHHMMSS` (the tree already has duplicate timestamps — do NOT reuse). **Merge order:** the sync RPC (yours) must reach prod BEFORE `LocalTagPush`'s call site ships to TestFlight (blur) — a phone calling an undeployed RPC fails silently. Deploys go through `supabase-deploy.yml`, never hand-applied.

**Handoff mechanics:** in `/Users/skylar/nuke`, register `.claude/agents/active/<PID>.md` (one file per agent, never edit another's), log via `claude-log-done "area" "desc"`, hand off via `claude-handoff "..."` (writes per-agent file under lockf — never `cat > HANDOFF.md`). Deregister when done.

---

## KEY IDS / PATHS
- Supabase project: `qkgaybvrernstplzjaam`
- Skylar user_id: `0b9f107a-d124-49de-9ded-94698f63c1c4`
- K5 Blazer: `e08bf694-970f-4cbe-8a74-8715158a0f2e`
- Mustang: `83f6f033-a3c3-4cf4-a85e-a60d2c588838`
- Backend repo: `/Users/skylar/nuke` (branch `feat/cohort-terminal`)
- iOS worktree: `/Users/skylar/.worktrees/foundation-ios/apps/nuke-capture-ios` (branch `fable5/ignition-ios`)
- Core file: `/Users/skylar/nuke/scripts/deep-image-analysis-byok.mjs`
- Rollup: `/Users/skylar/nuke/scripts/daily-receipt/living-state-report.mjs`
- Prompt: `/Users/skylar/nuke/scripts/daily-receipt/byok-vision-prompt.md`
- Your cron: `/Users/skylar/nuke/scripts/daily-receipt/byok-fleet-batch.sh` + `byok-image-batch.sh`
- Other scheduler: `/Users/skylar/nuke/.github/workflows/process-images.yml` → `scripts/process-all-3000-images.js`
- Sync migration: `/Users/skylar/nuke/supabase/migrations/20260701120000_sync_local_vision_tags.sql`
- **This session's full transcript:** `/Users/skylar/nuke/docs/handoffs/image-analysis-2026-07-01.transcript.jsonl` (search it, don't read whole)
- Rules: `.claude/rules/db-safety.md`, `agent-coordination.md`, `agent-trust-invariants.md`, `platform-hygiene.md`, `library.md`

---

## FIRST MOVES (ordered checklist)
1. **Register once, capturing the resolved path** (don't rely on `$PPID` matching across separate Bash calls): `REG=/Users/skylar/nuke/.claude/agents/active/$$.md; echo "$(date +%H:%M) | image-analysis | own backend vision pipeline | deep-image-analysis-byok.mjs, byok cron, sync RPC" > "$REG"` — remember `$REG` for deregistration. Read `.claude/HANDOFF.md` + `tail -60 DONE.md` + `.claude/agents/active/*.md` to see who's live.
2. **Confirm the byok cron is actually loaded:** `launchctl list | grep nuke` (expect `com.nuke.byok-image-analysis`). If it's disabled, the "6,750 re-run on Opus each cycle" premise is wrong — re-check before optimizing.
3. **Check whether #0 is already done:** `git log --oneline -5` on `feat/cohort-terminal` — the assembling session likely already committed the sync migration + ledger/roster/report files with this handoff. If so, skip; if not, commit `20260701120000_sync_local_vision_tags.sql`.
4. **Re-derive the scorecard — trust nothing blind.** MCP Supabase, user_id-scoped: orphan-by-source counts, saturated vs stale-open, `component_identifications` recency. Re-grep the ledger function anchors before any edit.
5. **Ship #2 (entity confirmation — biggest self-shippable value):** wire `components_seen → component_identifications` with a PN-match confidence bump; prove it on the K5 (69R398).
6. **Then #1-tier (cost):** confirm `claude-sonnet-5` via CLI, decide whole-drain-Sonnet vs the Opus carve-out, and confirm whether the live drain reads the shell default or `resolve()`'s `user_analysis_settings.model` before touching either.
7. **#3 (orphans) — coordinate BEFORE building.** Confirm the spine-wiring / orphan-landing split with nuke-library/Skylar. Solo-safe scope: extend `queue` to emit an orphan worklist + attribution proposals; do not edit spine migrations yourself.
8. Log via `claude-log-done`, hand off via `claude-handoff` when context tightens or work lands. Report coverage toward worth-proof on real builds — never raw counts.

You inherited a working, saturating, provenance-conserving organ. Your solo-shippable wins are entity-landing (#2) and honest cost-tiering (#1); orphan reach (#3) is the highest lever but is spine-blocked and must be coordinated, not charged into. Extend in place, honor the seams, move Skylar's core builds toward defensible worth.
