# Pre-mint memo: dense dated sales (2026-10-11)

**Status:** proposal, docs only. Nothing in this memo has been applied. It is the SCHEMA_LAW pre-mint checklist for
an abstract need in `v_stacks.needs_missing`, written by the unattended night run. Every number below is a read-only
production read through `scripts/data/q.sh`, taken between 2026-10-11 08:42Z and 08:44Z.

**Recommendation: do not mint.** A sale clock on every sale already has a home: `vehicle_events.sold_at` (event clock)
with `final_price`, one row per vehicle × platform × listing. The gap is clock coverage, not structure. 90,421 of
348,960 sold episodes (25.9%) carry no `sold_at`, and 53 of the 66 platforms with a sold episode carry no clock at all.
The repair is (a) a sale-clock back-fill from retained evidence through the existing episode supersession writer,
(b) a written rule for what "dense" means per cohort-month, and only then (c) declaring `vehicle_events` as the
substrate in `stack_substrates`.

## The need

```sql
select need, count(*) as stacks, array_agg(stack_id order by stack_id) as stack_ids
from (select s.stack_id, unnest(s.needs_missing) as need from v_stacks s) x
group by need order by 2 desc, 1 limit 10;
```

Read at 08:42:07Z. These are the top missing needs, with the reason each was or wasn't taken:

| Need | Stacks | Taken? |
|---|---|---|
| `text fold` | 5 | No. Memo already open: #910 (2026-10-09). |
| `parts and labor taxonomy` | 4 | No. Memo already open: #922 (2026-10-10). |
| `climate dimension` | 3 | No. Lost the tie-break. |
| `dense dated sales` | 3 | **Yes.** |
| `odometer observation kind` | 3 | No. Lost the tie-break. |
| `option keys` | 3 | No. Memo already merged: #804. |
| `state-history dimension` | 3 | No. Lost the tie-break. |
| `S12` | 3 | No. This is a stack, not an abstract need. |

**Tie-break.** Five needs tie at three stacks. I broke the tie by the coverage the need alone would add: the sum of
`1/n_needs` over its stacks. The scores are:

| Need | Coverage it would add |
|---|---|
| `dense dated sales` | 2.000 |
| `odometer observation kind` | 1.611 |
| `state-history dimension` | 1.533 |
| `option keys` | 1.250 |
| `climate dimension` | 0.644 |

**The stacks.** All three are at coverage 0.0 and status `measured`:

| Stack | Question | Needs |
|---|---|---|
| **S38** Event impact studies | How do outside events move the prices of the cohorts they touch? | 1. This is its only need. |
| **S18** Seasonality and macro per cohort | Per cohort, how do dated residuals move with season, the auction calendar and macro conditions? | 2. The other is `market index series beyond BaT live bids`. |
| **S51** Rate and fuel betas | How do interest rates and fuel prices move each cohort's prices? | 2. The other is `macro series`. |

**The substrate row.** `stack_substrates` describes `dense dated sales` as "A sale clock on every sale, across venues
(case ledger §13 row 18, 13.2 items 38, 51)". Its `declared_table` is NULL. All three `stack_needs` rows are `layer
log`, `kind abstract`, with no denominator or freshness written.

## The seven questions

### 1. §1 search before mint: candidates read, no fit proven?

I searched `v_schema_atlas` for names matching sale, sold, transaction, price_hist, transfer, auction_event,
vehicle_event, external_listing, residual and hammer. I read these candidates live:

| Table | Rows (atlas) | Grain | Sale clock | Fit |
|---|---|---|---|---|
| `vehicle_events` | 469,884 | vehicle × platform × listing | `sold_at` (event clock, documented in its column comment), `ended_at`, `final_price`, `event_status` | **Fits.** It is the episode log across venues. 348,960 rows are `sold`; 258,539 of them carry `sold_at`, and 258,323 carry both `sold_at` and `final_price > 0`. |
| `auction_events` | 370,953 | vehicle × lot URL | `auction_end_date`, `outcome`, `winning_bid` | A lot table for auction venues. Of the 37,900 undated BaT sold episodes, 36,917 have a matching lot row (same vehicle and URL), but only **2** of those lot rows carry `auction_end_date`. It can't supply the missing clock today. |
| `ownership_transfers` | 140,612 | one transfer | deal-to-title dates | A transfer workflow, not a market sale log. It is a later reader, not the substrate. |
| `vehicle_price_history` | 381,960 | change log of `vehicles` price columns | change time (a write clock) | A write-clock log. It is not eligible as a sale clock. |
| `external_listings` | 139,309 | listing | `sold_at` | RETIRED in favor of `vehicle_events` (atlas purpose). |
| `sale_residual_*` (S01 fold) | 12–548 | cohort-month and episode revisions | derived | A consumer of dated sales, not their log. |

**Conclusion: there is no fit for a new table.** `vehicle_events` is the log, with the right grain and the right clock column.

### 2. §2 is this a fact class that should be observation rows instead?

**No new fact class.** A sale and its time are testimony from the venue, and they already land as episode rows in
`vehicle_events`, with retained source captures behind them. What is missing is the clock on a quarter of those rows.

The retained evidence for that clock already exists. I sampled 2,000 of the undated BaT sold lots. **1,985 have keyed
`auction_comments` with `posted_at`** (sample read at 08:44:08Z; `limit 2000`, not random), so a bound on the close
time is retained. A comment clock bounds the close but does not equal it. The repair must record which witness set the
clock: the method, plus the original evidence ids.

### 3. §3 DNA columns canonical, trust T1/T2/T3, vocabularies CHECKed and documented?

**Partly.**
- **Documented.** `sold_at`, `ended_at`, `final_price` and `event_status` carry column comments, including the clock
  kind for `sold_at` ("Clock: event").
- **Not CHECKed.** `event_status` has no CHECK. The live values are sold 348,960, ended 113,207, active 6,366, unsold
  851, bid-goes-on 454, pending 79, listed 43, cancelled 7.
- **Not at the row.** The episode row doesn't carry the DNA tuple for its sale clock. Which witness set `sold_at`
  (page end time, live frame, comment bound) is not recorded per row.

The back-fill should write the witness and method into the episode's supersession record. It should not mint a new
column until a reader needs to filter on it.

### 4. §4 could a view do this? Are corrections modeled as supersession?

**Yes, and yes.**
- **"Dense" is a reading, not a table.** A view over `vehicle_events` can count dated, priced sales per cohort-month
  with the denominator beside each count. One month measured:

  | June 2025 | Count |
  |---|---|
  | Dated, priced sales | 2,861 |
  | Make/model text cohorts | 1,981 |
  | Cohorts with at least 5 sales in the month | **60** |
  | Sales in those 60 cohorts | 422 (14.7%) |
  | Cohorts with at least 10 sales | 9 |

  So "dense" has to be defined on a coarser cohort (`make_model_profiles` subjects, or the model → generation →
  purpose ladder of C27/§11) and a coarser time unit before any stack can claim it.
- **Corrections are supersession.** `sold_at` on a live episode is clock-locked by `trg_guard_vehicle_event_clock_locks`
  (#703). Corrections go through `supersede_vehicle_event_episode(s)` (#696), which archives the original into
  `superseded_rows`. The 2026-10-06 lanes used that path for 1,710 + 1,773 episodes.
- **Not every undated row is a sale.** The undated "sold" rows on classified venues (craigslist 5,304,
  facebook_marketplace 5,106, plus unknown 1,881 and gaa-classic-cars 540) carry a price but no clock. Under C27 an ask
  with no closing evidence cannot become a confirmed sale. Those rows need their evidence read before any clock is
  written; they are not back-fill input.

### 5. §5 invariants as constraints or triggers, attack tests written?

**Existing:**
- the clock-lock guard on `vehicle_events` (#703, 16 PG17 contracts)
- the sale-date retraction guard on `vehicles` (#710)
- the supersession writer's contract (#696)

**Owed with the back-fill:** a PG17 contract beside the existing ones that proves four things:
1. A comment-bounded clock never lands as an exact sale time without its method.
2. A write-clock day (a date that matches the episode's `created_at` or `extracted_at`) is refused.
3. A classifieds ask with no closing witness is held, not dated.
4. A replay leaves the original in `superseded_rows`.

### 6. §6 writer disjointness stated, registry rows included?

- **Who writes `sold_at` today:** `extract-bat-core` (copies `ended_at` when a sale price exists) and
  `ingest_bat_live_events` (frame sale time), per the column comment. The other venue extractors write it unevenly:
  13 of 66 platforms have any dated sold row.
- **The back-fill is one more caller** of the sanctioned supersession writer, not a new writer. Its `pipeline_registry`
  row is the existing writer's, with the new run named in `write_via`, and its receipts are written under
  `app.writer`.

### 7. §7 migration file, WHY comment, live-verification notes, RLS posture?

There is no new table, so there is no RLS decision. The follow-ups, each one PR:

1. **Declare.** Once the "dense" rule is written, a migration sets `dense dated sales` → `vehicle_events` in
   `stack_substrates` (the `place entity` path, #791). It records the rule as the needs' `denominator` and
   `fresh_within`, with `evidence[]` on any `schema_proposals` row.
2. **Back-fill.** A bounded back-fill of `sold_at` for the 36,883 undated BaT lots whose lot row says `outcome = sold`,
   from retained page captures first and comment bounds second, through `supersede_vehicle_event_episodes`.
3. **Classifieds read.** A read-only evidence pass over the 10,410 classifieds "sold" rows.

## What it would unblock

| | Before | After |
|---|---|---|
| S38 Event impact studies | 0/1 | **1/1** (coverage 1.0) |
| S18 Seasonality and macro per cohort | 0/2 | 1/2 (still waits on `market index series beyond BaT live bids`) |
| S51 Rate and fuel betas | 0/2 | 1/2 (still waits on `macro series`) |
| Total registry coverage added | | **2.0** |

**The first reader is the S01 sale residual fold** (`sale_residual_fold_queue` → `sale_residual_episode_measurements`).
It already computes dated residuals per cohort-month and is the natural consumer of the density rule. Whether its
inputs read `vehicle_events.sold_at` directly is **Unknown**: no `*residual*` migration in the repo names `sold_at`
(grep at origin/main 3d9c76346). The declare PR should check the fold's live function bodies first.

## Limits of these numbers

- **Live rows only.** The `vehicle_events` counts are live rows. Superseded originals are archived in `superseded_rows`
  (lane V, 2026-10-06), so they are not counted twice.
- **Raw text cohorts.** The June 2025 cohort density uses `vehicles.make`/`model` text, which is not normalized. Density
  on registered subjects is **Unknown** tonight: a full-year cohort query exceeded the statement timeout and was narrowed
  to one month.
- **Not a random sample.** The 2,000-lot comment sample is the first 2,000 rows the join returned. Its 99.25% rate is
  not a population estimate.
