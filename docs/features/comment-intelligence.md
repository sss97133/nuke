# Comment Intelligence Layer

**Status:** structural foundation deployed, pilot scored (227 comments), pipeline EXISTS (operate, don't rebuild). Blocked on one index + two citation bugs before scale-out.
**Owner subject for the pilot:** 1977 Chevrolet K5 Blazer cohort, subject prefix `6fd682a8…` (full id resolves via `make_model_profiles` / `cohort_members`).
**Repo:** `/Users/skylar/nuke` · **Supabase:** `qkgaybvrernstplzjaam`
**Last structural session:** 2026-06-22.

> Read the doorman `/CLAUDE.md` and `supabase/functions/CLAUDE.md` first. Universal invariants apply: facts are sacred, write only through `ingest-observation`, don't mint, testimony is never deleted (`.claude/rules/agent-trust-invariants.md`).

---

## 1. The concept

BaT (and other auction) comment threads are the densest unstructured signal we have about a vehicle and its cohort — ~364k comments in `auction_comments`. The comment-intelligence layer turns each comment into three calibrated, drillable products:

1. **Two decoupled polarity axes** (per comment, numeric −1..1):
   - `community_stance_score` — the community's stance toward the **seller / the deal** (skeptical ↔ supportive). Moves on seller-honesty engagement, not on the car's condition.
   - `condition_polarity` — the **car's condition** as asserted in the comment (a noted defect is condition-negative even when stated neutrally). This is a SEPARATE axis from stance.
2. **Extracted claims → citations** — each factual assertion becomes a structured claim that carries its source `comment_id` + author + a corroborates/challenges flag, drillable back to the exact BaT comment. Claims land as `vehicle_observations` (Category C) or `field_evidence` (Category A/B).
3. **Cohort-level rollups** — per-comment points feed the cohort terminal page: a sentiment-alignment map (stance × condition) and the scored corroboration behind every claim.

The product is **calibrated polarity + stance + clues → citations**, surfaced on the cohort/vehicle pages and drillable to source. This is an instance of the cardinal rule: every surface is a window onto a real entity wired to its evidence (`feedback_nuke_is_drillable_ontology_not_placeholder_surfaces`). A sentiment dot that doesn't drill to its comment is sabotage, not a feature.

---

## 2. What's deployed (verified in prod 2026-06-22)

### 2.1 New columns on `auction_comments`
Applied via MCP `apply_migration` — **NOT yet in a repo migration file = DRIFT to fix** (see §7).

| column | type | meaning |
|---|---|---|
| `community_stance_score` | numeric (−1..1) | seller-stance axis |
| `stance_scored_at` | timestamptz | when scored |
| `stance_model` | text | model that scored it |
| `condition_polarity` | numeric (−1..1) | the car's condition axis (SEPARATED) |
| `extracted_claims` | jsonb | array of claim objects, each carrying its source `comment_id` |
| `rubric_version` | smallint | which scoring rubric produced the row (currently `1`) |

### 2.2 RPCs (signatures verified live)
- **`get_make_model_sentiment_points(p_make text, p_model text, p_year int, p_grain text) → jsonb`** — NEW. Per-comment points: X=sentiment (`community_stance_score`), Y=community_stance, `second_axis` populated. Granted to `anon` + `authenticated`. Powers the iOS/web sentiment-alignment map.
- **`get_make_model_terminal(p_make, p_model, p_year, p_grain) → jsonb`** — MODIFIED. Added a `price_points` block (EVERY priced cohort sale, uncapped, each with date-or-null + source + `vehicle_id`, plus `n_dated`) and the `production` block now returns a RANGE (min/max/total) with a `verified` flag + canonical-model match. The deployed version is AHEAD of the repo file `supabase/migrations/20260622010000_cohort_terminal_price_points.sql` (which has the older price_points-only version — read its header comment, lines 1-10, for the "median is a lie for individuated collectibles" rationale).
- **`get_vehicle_pulse(p_vehicle_id uuid) → vehicle_pulse`** and **`arbitrate_vehicle_pulse(p_vehicle_id uuid) → void`** — see §2.4. (Pulse is an adjacent live-signal layer, not comment intelligence per se, but shares the same demo and was deployed the same session.)

### 2.3 The pilot scoring run (BYOK, this session)
- **227 cohort comments** for the 1977 K5 Blazer (subject `6fd682a8…`) scored on `community_stance_score`, then **RE-SCORED on rubric v1** (the two-axis rubric: stance + condition) producing **102 extracted claims**, each carrying its source `comment_id`.
- Claims proven drillable: `comment_id` + author + `corroborates_or_challenges` resolve back to the BaT comment.

### 2.4 `vehicle_pulse` (adjacent, demo-safe core)
NEW canonical live-signal table — verified columns: `vehicle_id, mode, headline_kind, headline_label, headline_amount, is_live, live_state, liveness, urgency_pulse_ms, ends_at, live_bid, bid_count, source_platform, updated_at`. Plus `arbitrate_vehicle_pulse(uuid)` + `get_vehicle_pulse(uuid)`, RLS mirroring `vehicles` (is_public/user_id/owner_id), added to the `supabase_realtime` publication.
**DEMO-SAFE CORE deployed:** NO trigger on `vehicle_events` (hot path — deferred to go-live), NO `bid_events` trigger, NO `pg_cron`. The full verified arbiter spec is in the repo at `supabase/migrations/20260622000000_vehicle_pulse_arbiter.sql` — **NOT deployed** (the triggers/cron are the not-yet-live part).

---

## 3. The investigation decision: operate the existing pipeline, don't build

### 3.1 The pipeline ALREADY EXISTS — do not mint
| Component | Path | What it does |
|---|---|---|
| Claim schema + 5-category router (A/B/C/D/E) | `supabase/functions/_shared/commentRefinery.ts` | claim density pre-filter (regex), prompt builder, response parser (quote-substring verification), corroboration engine, temporal-decay confidence |
| Local extraction runner | `scripts/refinery-extract-claims.mjs` | runs on Ollama ($0), reads `comment_claims_progress`, writes Category A/B → `field_evidence`, Category C → `ingest-observation` |
| Triage queue | `comment_claims_progress` table | **22,285 rows triaged** (`claim_density_score`, `llm_processed`, `claims_extracted`) |
| Write path | `supabase/functions/_shared/observationWriter.ts` → `ingest-observation` | the ONLY sanctioned write into `vehicle_observations` |

The claim categories (from `commentRefinery.ts` header): **A** Specs → `field_evidence`; **B** Condition → `field_evidence` (temporal decay); **C** Provenance → `vehicle_observations` via `ingest-observation`; **D** Market signals → `comment_discoveries`; **E** Library knowledge → `comment_library_extractions`.

### 3.2 Compute matrix (the engine is a commodity, ~$0.00002/comment)
| Option | Cost (~7M comments) | When |
|---|---|---|
| **Local Ollama** (`qwen3:30b-a3b`, default in the script) | **$0 marginal** | DEFAULT — claim extraction + bulk scoring |
| DeepSeek V4 Flash (direct API, off-peak) | **≈ $110** | when local throughput is the bottleneck |
| Claude Haiku Batch | reserved | gold-set + contested/conflicted comments only (best quality, not bulk) |
| **ChatGPT *subscription*** | — | **RULED OUT** — the subscription is a separate product with zero API quota; calling it via API violates ToS. Not an engine option. |

Decision: the LLM is a commodity. Run bulk on Ollama, escalate only the gold/contested set to Haiku Batch.

---

## 4. Calibration status

- **Rubric v1 is collinear.** The two axes correlate at **r = 0.656** — too high. Condition leaked into stance (a car-condition complaint dragged the seller-stance score negative even when the comment was neutral toward the seller).
- **v2 decouple rule (the fix):** `community_stance_score` moves **ONLY** on seller-honesty engagement (disclosure, responsiveness, deal fairness). A defect noted neutrally = `condition_polarity` negative but `community_stance_score` ≈ 0. Stance and condition must be scored from disjoint evidence in the prompt.
- **Method:** discrete buckets (don't ask the model for a raw float — bucket to e.g. {−1, −0.5, 0, +0.5, +1} then map), anchored to a hand-labeled **gold set** of exemplar comments per bucket. Re-score the 227 K5 comments under v2 and re-measure r (target: well below 0.656, ideally < 0.3).
- Bump `rubric_version` to `2` on the re-score so v1 and v2 rows are distinguishable.

---

## 5. Citation schema + where claims land

**The citation chain is PROVEN.** Each claim is a structured object carrying its provenance back to the comment:

Claim shape (from `commentRefinery.ts` `ExtractedClaim`, plus the rubric-v1 citation fields):
- `claim_type`, `category` (A–E), `field_name` (null for C/D/E)
- `proposed_value`, `confidence` (0–1), `temporal_anchor` (ISO date | "current" | null)
- `quote` — **exact substring of the comment** (parser rejects any claim whose quote isn't a verified substring — `parseClaimResponse` / `parseClaims`)
- `comment_id` (source), author, `corroborates_or_challenges`
- `observation_kind` (Category C: sighting | ownership | work_record | previous_sale)

**Landing:**
- **Category A/B** → `field_evidence` (`source_type='auction_comment_claim'`, `supporting_signals` carries `{quote, author, temporal_anchor, claim_type, model}`).
- **Category C** → `vehicle_observations` via `ingest-observation` (NEVER a raw insert — see `.claude/rules/extraction.md` single-write-path). `extraction_method='comment_refinery_v1_local'`.
- **Corroboration** (`runCorroboration` in `commentRefinery.ts`): cross-references new claims against existing `field_evidence`; VIN-decode corroboration is weighted extra; produces status `pending|accepted|conflicted|rejected`.

The `extracted_claims` jsonb column on `auction_comments` is the per-comment cache of the same claim objects (so a comment row is self-describing without a join).

---

## 6. Pipeline shape (how scale-out runs)

Three modes, all reusing `comment_claims_progress` as the queue (do NOT mint a second queue):

1. **On-demand** — score a single vehicle/cohort's comments now (the 227-comment pilot path). `node scripts/refinery-extract-claims.mjs --vehicle <id>`.
2. **Drain** — work the triage backlog by density: `--all --max-vehicles N`, highest `claim_density_score` first. Marks `llm_processed=true` per comment as it goes.
3. **Ingest-hook** — when a new comment is extracted, triage it (compute `claim_density_score`) and enqueue into `comment_claims_progress`; the drain picks it up. (Triage step `claim_triage` must run before the refinery — the script no-ops if nothing is above `--min-density`.)

Stance/condition scoring should run as a sibling pass over the same queue rows (write the two axes + `rubric_version` + `stance_model` back to `auction_comments`), so a comment is scored AND claim-extracted in one drain.

---

## 7. Blockers (fix before scaling)

1. **CRITICAL — missing index on the score columns.** `auction_comments` has NO index on `community_stance_score` / `condition_polarity` / `rubric_version` (verified: zero matching indexes; any scored-vs-unscored COUNT over the full table **times out** at the 15s/120s role limit — reproduced this session twice). Fix: a partial index, built with `CREATE INDEX CONCURRENTLY` **OUTSIDE a transaction** (so `apply_migration`'s implicit txn won't work — run it via direct `psql`). Suggested:
   ```sql
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_auction_comments_unscored
     ON auction_comments (vehicle_id)
     WHERE community_stance_score IS NULL;
   ```
   Until this exists, all progress queries MUST be scoped by `vehicle_id` (indexed), never by the score columns.

2. **HIGH — citation rot on existing comment-sourced observations.** The ~20 existing comment-sourced `vehicle_observations` rows have their source `comment_id` left NULL (it lives in `structured_data`, not a top-level column — `vehicle_observations` has no `comment_id` column), which **breaks drill-to-source**, and `proposed_value` ≠ the `quote` on some rows (**citation rot** — the stored value doesn't match the cited text). Fix BOTH before scaling: backfill `structured_data->>'comment_id'` from the originating comment, and enforce `proposed_value` derivable-from / consistent-with `quote`. Do this via supersession, not overwrite (testimony invariant).

3. **DRIFT — deployed-but-not-in-repo.** The §2.1 columns, `get_make_model_sentiment_points`, the MODIFIED `get_make_model_terminal` (price_points + production RANGE), and the `vehicle_pulse` table/RPCs/RLS were applied to prod via MCP and are NOT in repo migration files. Capture them as idempotent migrations under `supabase/migrations/<timestamp>_<name>.sql` (justify the new `vehicle_pulse` table in a comment per `.claude/rules/platform-hygiene.md`). The repo files `20260622000000_vehicle_pulse_arbiter.sql` (full arbiter, with the deferred triggers/cron) and `20260622010000_cohort_terminal_price_points.sql` (older terminal) exist but do NOT match what's live.

Log these in `.claude/ISSUES.md` (read first, append, don't clobber — format in `.claude/rules/qa-loop.md`) if not already present.

---

## 8. Ordered next steps

1. **Rubric v2 re-score.** Implement the §4 decouple rule (stance moves only on seller-honesty; discrete buckets; gold-set anchors), re-score the 227 K5 comments, write with `rubric_version=2`, re-measure axis correlation. Gate: r meaningfully below 0.656.
2. **Land the 102 proven claims.** Route the pilot's 102 extracted claims through `ingest-observation` (Category C) / `field_evidence` (A/B) with `comment_id` populated at the top level of `structured_data` so they drill. This is the first production batch — verify each lands drillable before scaling.
3. **Build the partial index** (§7.1) via `CREATE INDEX CONCURRENTLY` over direct `psql`, then confirm a scored-vs-unscored count returns in <1s.
4. **Fix the ~20 rotten observations** (§7.2) via supersession — backfill comment_id, reconcile proposed_value↔quote.
5. **Drain.** With the index in place and v2 calibrated, run `scripts/refinery-extract-claims.mjs --all` (Ollama, $0) over the `comment_claims_progress` backlog (22,285 triaged), escalating only contested/gold-set comments to Haiku Batch. Add the stance/condition sibling pass to the same drain.
6. **Fix the drift** (§7.3) — write the four idempotent migrations so repo == prod.

---

## 9. iOS surface (consumes this layer)

Worktree `~/.worktrees/foundation-ios`, branch `fable5/ignition-ios`, ALL UNCOMMITTED as of 2026-06-22. The comment-intelligence outputs render in:
- `CohortTerminalView.swift` — cohort sales scatter (from `price_points`), production-provenance drill, and the **sentiment-alignment map** (from `get_make_model_sentiment_points`).
- `VehicleDetailView.swift` — sale-history section, comp-barcode suppression.
- `BuildStoryHero` IdentityChips — drillable identity chips.
- Living header subscribing to `vehicle_pulse` via Realtime (live bid + countdown + chime).
Proof shots in `~/Desktop/nuke-app-proof/`.

---

## Reference index
- Pipeline: `supabase/functions/_shared/commentRefinery.ts`, `scripts/refinery-extract-claims.mjs`, `supabase/functions/_shared/observationWriter.ts`
- Queue: `comment_claims_progress` (22,285 rows)
- Write path: `ingest-observation` (single sanctioned path)
- Migrations (drift): `supabase/migrations/20260622000000_vehicle_pulse_arbiter.sql`, `…/20260622010000_cohort_terminal_price_points.sql`, `…/20260616120000_make_model_subject_cohort_terminal.sql`
- Rules: `.claude/rules/extraction.md` (single write path), `.claude/rules/agent-trust-invariants.md` (supersede, don't overwrite), `.claude/rules/db-safety.md` (CONCURRENTLY outside txn), `.claude/rules/platform-hygiene.md` (justify new tables)
