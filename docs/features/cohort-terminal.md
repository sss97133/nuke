# Cohort Terminal — the year-make-model as a population instrument

> Structural work 2026-06-22. Two prod RPCs (project `qkgaybvrernstplzjaam`) + the iOS
> `CohortTerminalView` surfaces. The RPCs were **deployed via MCP `apply_migration`** and are
> **drift** vs the repo: `get_make_model_terminal` is a MODIFIED version of the one at
> `supabase/migrations/20260622010000_cohort_terminal_price_points.sql`, and
> `get_make_model_sentiment_points` is NEW with no repo migration yet. Commit both to close the drift.
> iOS lives in the worktree branch `fable5/ignition-ios` (uncommitted as of this writing).

## What it is
When a search parses to a clean year-make-model, the top result is not a single vehicle but the
**cohort itself** — every example of that year-make-model the substrate has seen, read as one
population. The Cohort Terminal is the instrument that renders that population: its sales cloud, its
production provenance, the community's sentiment about the model, the dealers moving it. It is a
**lens onto real records**, not a dashboard: every datum drills to the row it came from.

## The RPCs (the engine)

Both are `STABLE plpgsql`, granted to `anon` + `authenticated`, and follow register-then-fetch
(`register_make_model_subject` seeds the `make_model_profiles` subject; the terminal reads it). Both
resolve the caller's raw model string to a **canonical model** via `canonical_models` (aliases
included) before keying — so a search for "Blazer" matches production rows keyed "K5 Blazer". An
unresolved subject returns `{resolved:false, note:"…intake gap, not a market verdict"}` — absence is
an intake gap, never a market verdict (the cardinal valuation rule).

### `get_make_model_terminal(p_make text, p_model text, p_year int, p_grain text) → jsonb`
Assembles cohort aggregates from the substrate over `cohort_members(subject)`. Blocks returned (each
carries a `populated` flag; `false` ⇒ honest empty line, never a fabricated number):
- `cohort_count` — `{populated,value}` from `cohort_members`.
- `price_distribution` — median/p25/p75/min/max/n over `vehicle_events.final_price`. (Aggregate stat,
  not a price you can defend on one car — labeled as distribution, never as "the price".)
- **`price_points` (this session)** — **every priced sale, uncapped** (NOT top-N-by-price comps):
  `{populated, n, n_dated, points:[{vehicle_id, price, date, source, miles, url}]}`, ordered by price,
  capped at 1000 rows. `n_dated` exposes the time-coverage gap so undated sales are shown, not dropped.
  Each point carries `vehicle_id` + `url` → it drills to its source. This is the honest population for the scatter.
- `market_flow` — quarterly `{quarter, sales, median_price}` series.
- `sentiment` — cohort-avg scalar from `comment_discoveries` (the 1-axis fallback; the rich 2-axis
  map comes from the sentiment-points RPC below).
- `dealer_flow` — top sellers in the cohort `{seller, events, median_price}` (org-entities with an
  observed service profile, not a hardcoded registry).
- **`production` (this session — MODIFIED to a RANGE)** — over `vehicle_production_data` matched on
  the canonical model: `{populated, total_produced, min_produced, max_produced, rarity_level,
  verified:bool_or(source_url is not null), source_url}`. Returns a **range** (min/max/total) with a
  `verified` flag and a citation URL when one exists.
- `survival` — a **floor**, never a total: `floor_known_members` = the count we've actually seen; the
  note says member count is a lower-bound, not the estimate (the substrate counts only what it has seen).
- `comps` — top-24 cohort sales with image + listing URL, each drillable to its `VehicleDetailView`.

### `get_make_model_sentiment_points(p_make, p_model, p_year, p_grain) → jsonb` (NEW this session)
Per-comment points for the alignment map, over `auction_comments` in the cohort (excluding bids):
- `comment_points` — `{populated, n, n_stance, points:[{comment_id, vehicle_id, sentiment (-1..1),
  stance (-1..1), kind, is_seller, author, likes, text}]}`. **X = sentiment** (`sentiment_score/100`),
  **Y = community_stance** (`community_stance_score`, the seller-honesty / "vouches ↔ challenges the
  car's claims" axis; null = unscored). Every point carries `comment_id` → drills to the real BaT comment.
- `spectrum` — the 1-axis scalar summary (mean, n_positive/negative/neutral).
- `second_axis` — the populated community-stance axis `{label, n_vouch, n_challenge, mean, stddev}`.

The two axes are **separated on purpose**: `community_stance_score` (seller-stance) is distinct from
`condition_polarity` (the car's condition). A defect noted neutrally is condition-negative but
stance-0. (Calibration note: rubric v1 measured the two axes at r=0.656 — too collinear; v2 must move
stance ONLY on seller-honesty engagement. The doc surface should treat the stance axis as provisional
until v2 lands.) Data backing the map this session: 227 comments for the 1977 Chevrolet K5 Blazer
cohort (subject `6fd682a8`), scored on community_stance and re-scored on rubric v1 with 102 extracted
claims each carrying its source `comment_id`.

## The iOS surfaces (the instrument)
File: `apps/nuke-capture-ios/Sources/NukeCapture/CohortTerminalView.swift` (decoders `CohortTerminal`
+ `CohortSentiment` decode the RPC JSON exactly; every numeric field optional so a nil renders the
honest empty state, never a defaulted number). Identity chips reuse
`apps/nuke-capture-ios/Sources/NukeCapture/BuildStoryHero.swift` (`IdentityChips`).

- **Drillable identity chips** (`headerSection` → `IdentityChips`, shared with the build hero). The
  year/make/model render as entity-chips; tapping any word opens the **production-provenance** sheet.
  The chips are tappable ONLY when a real production node exists (`productionDrillAction` returns nil
  otherwise) — no fake affordance. The drill keys on the RPC's **canonical** identity, not the raw
  caller string. **The title you read is the door you open.**
- **Sales scatter** (`salesSection` → `SalesScatter`, fed by `price_points`). Every priced sale is one
  dot; **no median, no trend line** — the cloud IS the read. Dated sales sit on a time axis; **undated
  sales sit in a labeled "no date" gutter** (shown, never dropped off the axis — a fake x would imply a
  trend it can't have). x is precomputed over the full set so dots don't move when sources toggle.
  **Source is a filter** (tap a source chip to isolate; dimming, never dropping) so color isn't forced
  to carry nine categories. Tapping a dot → a **snapshot card** (`SalePoint` → `onPeek`), a soft peek,
  not a hard jump.
- **Production provenance drill** (`ProductionDrill` sheet + `productionSection`). The production figure
  renders ONLY with a `source_url` (the cardinal rule applied to provenance — an uncited production
  number is not shown); the source is a tappable link. Shows the range (min/max/total) + rarity.
- **Sentiment alignment map** (`sentimentSection` → `SentimentMap`, fed by `get_make_model_sentiment_points`).
  Every comment is a point in polarity × stance space: X negative↔positive, Y challenges↔vouches. Reads
  like an alignment chart; the 3-tone color (vouch / challenge / neutral) is the stance, position
  carries the rest. **Tap a point → read the actual comment** (`CommentPeek`, showing author, SELLER
  badge, likes, full text, and the two axis values). Falls back to the 1-axis scalar word when the
  cohort lacks per-comment scoring.
- **Dealer flow** (`dealerSection`) — horizontal bar of top sellers, bar length = observed events,
  median annotated; a null median renders honestly.
- **Comps** (`compsSection`) — each row drills to its `VehicleDetailView` via the host stack's
  `.navigationDestination(for: VehicleHeaderRow.self)`. The cohort is a lens, not a dead end.

Related (same session): `VehicleDetailView.swift` added a **sale-history section** (real transacted
record, deduped so duplicate ingest rows don't read as "sold twice", each row drills to its listing)
and **comp-barcode suppression** (`buildInstrument` renders the build barcode only when there's a real
build signal — work logged or >1 photo on a day; for a scraped comp the SALE HISTORY is the honest spine).

## Design tenets applied
- **Every datum drills.** Identity chip → production provenance. Scatter dot → snapshot card. Comment
  point → the real BaT comment. Comp row → its `VehicleDetailView`. Nothing is a placeholder; "not
  clickable" = nothing behind it = the system was bypassed (the drillable-ontology cardinal rule).
- **No median as the headline.** The price scatter is the cloud, not a single number — a year-make-model
  spans bone-stock to restomod and a median describes neither. Aggregate stats are labeled as flow/distribution, never as "the price".
- **Communicate by looking.** A scatter, an alignment chart, a horizontal pecking-order bar — the shape
  reads before the digits. Mono digits carry the precision; the chart carries the gestalt.
- **Real data only.** Each block's `populated` flag gates an honest empty line ("Not recorded yet"),
  never a fabricated number or a bare "—" posing as data. Production shows only when cited. Absence is
  framed as our intake gap, never a market verdict.
- **Native Apple grammar, not an AI-dashboard skin** (CONSTRAINTS C4/C5): stock List/Section, system
  grouped background, mono digits as NUKE's signature.

## Open design items
- **Sentiment rubric v2** — v1 axes correlate at r=0.656 (condition leaked into stance). Decouple
  before scaling: stance moves ONLY on seller-honesty engagement; a neutrally-noted defect = condition-
  negative, stance-0. The map's stance axis is provisional until v2 (`auction_comments.rubric_version`).
- **Index blocker** — `auction_comments` has no index on the score columns, so scored-vs-unscored
  queries time out. Needs a partial index built `CONCURRENTLY` (outside a txn) before scaling past the
  227-comment K5 set. (Tracked: append to `.claude/ISSUES.md`.)
- **Citation rot to fix before scaling** — the ~20 existing comment-sourced `vehicle_observations` rows
  have NULL `comment_id` (breaks drill-to-source) and `proposed_value` ≠ the quoted text. Fix before
  the claim-extraction pipeline (`scripts/refinery-extract-claims.mjs`, `comment_claims_progress`,
  `observationWriter.ts → ingest-observation`) scales the 102-claims-per-227-comments pattern to the ~7M-comment corpus.
- **Drift** — commit both RPCs to repo migrations (`supabase/migrations/<ts>_<name>.sql`, idempotent).
- **Sales scatter mileage axis** — `price_points` carries `miles`; a price×mileage view (vs price×date)
  is the obvious next lens but undated/un-mileaged sales need the same gutter treatment.

## Key paths
- RPC `get_make_model_terminal` — deployed (drift vs `supabase/migrations/20260622010000_cohort_terminal_price_points.sql`)
- RPC `get_make_model_sentiment_points` — deployed, NEW (no repo migration yet)
- `apps/nuke-capture-ios/Sources/NukeCapture/CohortTerminalView.swift` — the instrument
- `apps/nuke-capture-ios/Sources/NukeCapture/BuildStoryHero.swift` — `IdentityChips` (shared drillable identity)
- `apps/nuke-capture-ios/Sources/NukeCapture/VehicleDetailView.swift` — sale-history section + comp-barcode suppression
- Proof shots: `~/Desktop/nuke-app-proof/`
