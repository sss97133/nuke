# DATA MACHINE — theory card

## Construction direction, owner priority 2026-10-04

The worked examples below are a construction brief, not a ceiling or evidence that Nuke is complete.
Recurring engineering should develop missing structure and useful answers from existing testimony:
useful question → source testimony → canonical entity relationships → current/replayable measurement
→ reader or downstream consumer. Each bounded capability names its grain, keys, event and ingest
clocks, writer and executable acceptance assay. Extend this brief and the case ledger as behavior is
proved, retaining dated owner intent and exact implementation, test, merge, deployment and runtime
stages. A masked current reader may expose useful work history while lacking the clocks and fields
needed for a historical financial model; record that boundary rather than inventing the missing inputs.

Promoted by the owner on 2026-09-30 as "the absolute most important thing": the database structure, its vocabulary,
and how the owner and every agent talk about it. Read this before designing any table, feature, cohort or prediction.

**The model:** the internet publishes the raw material (listings, bids, comments, photos, results); Postgres is the
refinery. The machine has five layers, each defined inside the database itself so any agent can read it cold:

1. **The log.** Every bid, comment, photo and fact lands once as an append-only row with two times: *event time*
   (when it happened at the source) and *ingest time* (when we learned it). `auction_comments` (18.4M rows) is the
   auction log; `vehicle_observations` (10.1M rows, "immutable event store for all vehicle observations") is the
   fact log.
2. **The state.** One row per live thing (a live lot, a bidder) holding running measures, updated as each event lands
   at a fixed cost per event (incremental maintenance: counts, sums, distinct sets, sketches such as t-digest and
   HyperLogLog). No rescans of the log at page time.
3. **The baselines.** Cohort distributions (what comparable lots looked like at each hour to close), recomputed on a
   schedule, because history does not change when one comment lands.
4. **Features, and features of features.** Measures keyed to an entity and an as-of time, built in levels: a record
   (what a bidder has done), an effect (what happens when they enter), and the lot-level sum of effects present.
5. **Predictions.** A defined bet on an outcome, graded against a baseline, backtested by replaying the log.

The present is a **fold over the log** (state = f(every event so far)). The past matters because every new feature
has to be computed for every past lot by **replay** before anyone can test whether it predicts anything. Rebuilding
the log from the published record (the backfills) is how the machine gets its past.

**The invariant(s):**
- **Append, never overwrite.** Events are immutable; corrections supersede (SCHEMA_LAW, `lofficiel-concierge/supabase/SCHEMA_LAW.md`).
- **Bitemporal.** Every event table names its event-time column and its ingest-time column, in the column comments.
- **Idempotent ingest.** Every event has a source key (e.g. `bat_comment_id`), so a replayed or re-read event counts once.
- **Point-in-time correct.** A feature used at moment *t* may use only events with event time before *t*. A lifetime
  number computed today (e.g. `bat_user_profiles.win_rate`) must never feed a past prediction: that is *leakage*.
- **Every reference is a foreign key.** Text that names another entity (a handle, a listing, a place) becomes a key to
  that entity's table. The identity entity already exists: `external_identities` (platform + handle, 593K rows, 19
  tables keyed to it). Extend it; never mint a parallel identity table.
- **The database describes itself.** Every live column carries `COMMENT ON`: meaning, unit, source, grain, and which
  time it is. `v_schema_atlas` (`n_cols_described`, `fk_in`, `fk_out`) is the scoreboard.
- **Per-event work is incremental; cohort work is batch.**
- **One owner per computed field** (`pipeline_registry`).
- **No prediction without its six blanks** (below).

**The vocabulary** (say it this way):
- *Entity (dimension table)*: a thing that exists: a vehicle, a person, a place, a model.
- *Event (fact table)*: something that happened at a moment: a bid, a comment, a photo, a sale.
- *Grain*: what one row means (one comment; one lot; one lot at one hour to close; one bidder as of one date).
- *Foreign key*, *one-to-many*, *many-to-many (bridge table)*: how rows point at each other.
- *Event time / ingest time*, *as-of join*, *point-in-time*, *replay / backfill*, *leakage*.
- *Feature*: one measure of one entity at one moment. *Label*: the outcome a prediction is graded on.
- *Cohort*: a set of dimension values; *stacking*: their intersection; *residual*: observed minus what the stacked
  cohorts expect (the anomaly score).
- *Percentile rank within a cohort*: the calibrated spectrum ("hot" means the same thing at every table).
- *Lift*: P(outcome | X present) ÷ P(outcome | cohort without X). *Shrinkage*: pulling a small-sample estimate toward
  the cohort, so one lucky result does not make a legend.
- *Backtest*: replay the past hour by hour with only what was known then; grade the predictions.
- *Calibration*: 80% ranges contain the truth 80% of the time.

**Worked shapes (the owner's examples, 2026-09-30):**
- **The consequential bidder.** Level 1, record as of a date: auctions entered and won, win rate, median top bid, share
  of bids in the final 2 minutes, segments, comments per auction. Level 2, effect: *entry lift* on an outcome such as
  "closes above its cohort's 75th percentile", shrunk toward 1 on few auctions; and the *event study*, bidding pace in
  the hour after entry against the hour before. Level 3, the lot: the lift of everyone who has entered so far. Measured
  2026-09-30 in `bat_listings.buyer_username`: 68,957 distinct buyers; 685 won 10 or more lots, 39 won 50 or more, one
  won 703; the top 1% won 14.0% of all lots.
- **Cohort stacking.** Dimensions are hierarchies (make → model → generation → trim; state → region → coast; era;
  condition tier; provenance tags read from listing text: "California car", "rust-free", "Florida"). A lot belongs to
  many cohorts at once (bridge table lot × cohort). The 1600 Veloce in New England is a residual: normal against the
  model nationally, an outlier against the region, which says where the money is. Location today is about 13
  overlapping columns on `vehicles` (`state`, `city`, `zip_code`, `registration_state`, `bat_location`,
  `listing_location_raw`, `gps_latitude`, …) with no geography entity to key them to.
- **The live lot.** The SL500 of 2026-09-30 at 2 h to close (`live_lot_temperature`, PR #482): bid $10,000, higher
  than 68 of 273 comparable sold lots at that point; 38 bids and 15 bidders. Price cold, activity hot.

**Built current reader shape, 2026-10-04.** Permitted work testimony can reach a searchable vehicle
table (PR #564) and a Lifecycle count/supplier/activity reader (C22 local assay at 22:22 UTC).
A work filter makes older work reachable when newer conditions fill the recent-activity window.
The original observation ID gives idempotent reader merging; the public contract's recorded date
is not an ingest clock, supplier text is not an organization key, build stage is not installation
evidence, and a readable-amount subtotal is not complete investment. These boundaries expose the
next structural dependencies without treating a current reader as a historical financial feature.
See the C22 case for the assay and separate delivery stages.

**A prediction is six blanks.** At moment **t**, from only what is known at t, for lots in population **P**, a
distribution over outcome **Y** in a stated **form**, graded by rule **S** against baseline **B**. Example (proposed,
awaiting the owner): "At 2 h to close, for BaT lots with at least 8 same-model comparables, predict the final price as a
median and an 80% range; grade by absolute % error against the cohort median; backtest on every lot closed since 2025
using only data known at 2 h."

**Measured state, 2026-09-30** (`v_schema_atlas`): 925 tables (654 non-empty); 16,403 columns, 2,967 described (18%);
195 non-empty tables with no foreign key in or out. `auction_comments`: 56 columns, 2 described, nothing keys to a
comment. `bat_user_profiles`: 689K rows, 26 columns, 0 described, no keys in or out (an island). `bat_listings`: 157K
rows, 0 of 28 columns described. `vehicles`: 342 columns (157 described), 285 tables key to it.

**The team (one lane at a time, each with its scoreboard):**
1. *Cartographer:* describe every column of the event and entity tables (meaning, unit, source, grain, event or
   ingest time) and list every text field that names another entity, with its match rate. Scoreboard: described %.
2. *Keys:* turn those fields into foreign keys (comment author → `external_identities`; listing → vehicle; location
   → a geography entity). Plan-first: big tables take `NOT VALID` keys, validated in the background.
3. *Time:* event and ingest time declared on every event table; the per-event state rows for live lots.
4. *Features and cohorts:* bidder records and effects as of a date; the cohort dimensions and their bridge.
5. *Prediction:* the six blanks filled with the owner; the replay backtest.

**Canonical entrypoints:** `v_schema_atlas` and `v_job_health` (read with `scripts/data/q.sh`); `auction_comments`
fed by the cron `bat-live-pull` (live lots) and the `import_queue` backfill; `vehicle_observations`;
`external_identities`; `pipeline_registry`; `live_lot_temperature(p_vehicle_id)`; `market_index_values`
(`BAT-LIVE-BIDS`, hourly).

**Do NOT:** feed a lifetime aggregate into a past moment; build a feature that cannot be replayed from the log; mint a
second identity, geography or cohort table beside an existing one; store a derived number without its as-of time;
describe a column in a doc but not in the database.

## Drilling through cohorts, 2026-10-04

The owner's "repair" and "sale" are names for recursive cohorts of connected evidence (§10 of the case ledger).
A useful drill has two kinds of depth: **relationships** into smaller/shared evidence cohorts, and **folds** into
measures and measures of measures. A larger diagram alone does not establish either one.

For each node, declare its grain before connecting it. A catalog part design, one physical part, one purchased
line and one installation are different grains. A labor task, its entry author, its performer, a skill claim and
a dated record of supported outcomes are different grains too. Reuse the same evidenced entities across jobs,
ownership periods and market events; bridges carry role, period and attribution. Preserve unresolved matches.

An example drill is **repair → labor task → performer → skill record → prior job → observed outcome → supporting
observation → original source**. The prior job can point back into the repair graph: fan-out is a graph with shared
nodes, not duplicated ownership of every descendant. A missing outcome is unobserved, not successful work. A
rating has a reviewer, criterion and work context; it is not automatically a measurement of technical skill.

Above that evidence, follow the card's five layers:

1. **Log:** source-keyed claims/events and corrections, with their event and recording clocks.
2. **State:** supported records keyed to an entity and as-of time; update affected records incrementally.
3. **Baselines:** distributions over explicitly eligible comparison populations and stacked dimensions.
4. **Features of features:** contextual records → measured associations with outcomes → a combined job/vehicle/lot
   assessment with declared dependence and uncertainty. Do not silently add overlapping effects or call an
   association causal. Sparse or unqualified evidence can withhold the measure.
5. **Prediction:** the six blanks, then replay and grading against the declared baseline.

Comparison membership is explicit: for example procedure × part family × vehicle specification × region × date ×
evidence coverage. Keep all retained source episodes available before qualification and relevance; retain unknowns,
conflicts and the reason for each exclusion. For every aggregate name its unit, denominator, eligibility, source
lineage, event cutoff, knowledge cutoff and revision. A retrospective assessment using later evidence is distinct
from what was supportable at the earlier moment. A row-created timestamp alone is not proof of commit availability.

A new event updates the affected incremental folds and marks affected baseline/feature work for their declared
cadence. A duplicate source event counts once. Later evidence may revise today's reading of an earlier ownership
period while an earlier assessment receipt remains reproducible. No full-log rescan belongs in a page request.
Every proposed fold still needs an owner, writer, assay, described keys and a reader before it can count as operating.

**Existing anchors, checked 2026-10-04:** the capability map designates `work_sessions` as the work ledger and
`catalog_parts` as the parts catalog. Live metadata confirms typed work-session links to vehicles, users, places
and technician phone links, and a catalog-part link to catalog sources. This does not establish a complete
performer/skill/payment/part-instance chain. The repository's `create-work-session-from-evidence` currently creates
an image-backed pending-analysis `timeline_events` row; its name alone cannot prove work-session ingestion. These
are a bounded design and metadata/code inspection, not a runtime assay or permission to mint parallel structures.

**Before you build here:** read this card, SCHEMA_LAW, `docs/ledger/CAPABILITY_MAP.md`, and the `v_schema_atlas` row
of every table you touch.

## The owner's words, 2026-09-30 (typed to the lead from the airport)

> theres so many factors and this data discussion needs to be promoted significantly in our heirarchy as i need deeply
> to internalize this core functionality. it for far to long has been getting brushed over as if the DB is perfected
> when it is far far from it. when i see the postgres example i already know that map reaches FAR deeper than that
> example shows so either i havent illustrated enough what i need or youre pulling an extract. its the first option as
> no matter what we need to continuously develop meaningful branches of data. the internet is giving us freely
> information. its the raw material that we refine and our only tool in that refining process is i guess at its core a
> postgres [...] the postgres is not good enough. i want to mine out every single possible grain. we havent enough
> defined what each entity, dimension table, event, fact table, foreign key, one-to-many, grain... can become. we
> havent made enough foreign keys out of the source data. i love the "how the data is laid out" we need to get a team on
> that. "measuring a lot at the moment" ok so this already i hit a wall because data is a constant. its always coming in
> and the measuring is always recalibrating. period the end. the entire entity of bat in theory shifts as every comment
> arrives. its pushes the data most certainly. so stop - how does that effect our db, our processing.. how do we make
> that whole situation free? hard algorithms, hard equations that run everytime a data point lands and lets say they
> are landing a lot and fast. its not like we are measuring at the end of the day. we are measuring at stock market
> speed [...] whys it so hard to get this method on paper so an agent can begin to build it with me. [...] if the data
> system is set up to constant monitering doesnt only the present matter? all the sudden things kind of collapse. the
> past really becomes the past.. far less interesting than whats happening BUT... the big but is if we didnt properly
> set our postgres up or our jargon up then we have to go back into the past and pick up those measurements. [...]
> point-in-time like i said, thats where we need to fix. we are picking up all the old pieces, atoning for not having
> had the perfect tool from day one. but as we pick up to pieces we are seeing more and more relations thats why all
> areas of the machine have to grow in unison. its only possible with coordinating always turning agents who know what
> they are doing and have an understanding of time. like its bad when a vanilla agent jumps in and assumes but i guess
> we are building or might need to build in a way that a new agent is forced to work as if they are a context rich
> agent... thats possible if the posgres is really good right? ok so yeah we have features. features need to grow, but
> what about features of features. when you add things like bidder, how it becomes a consequential bidder, what
> measurements do you have to be tieing in to eleveate a biddder into one that when they enter the auction the auction
> has then a higher probability of something happening. [...] once, a known in the crowd guy bid and commentors were
> like oh shit when he shows up hes never lost an auction... these types of guys wow weve got to know their behaviors so
> how do we create the postgres definition equation of what that bidder looks like. cohort... we have a lot of
> different types of cohorts, from year make model to west coast car or east coast car. so cohort stacking creates a
> profile on a vehicle often seen in marketing... clean california car for sale.. west coast truck... new england rust
> bucket... id never buy a car from florida.. type shit. so many measurements and then anomoly opportunites when u see
> 1600veloce operating out of the new england area. ultra high end.. but thats cuz theres money out there.. [...] the
> visuals we need to unlock first is to see the posgres in its best form and developing. path to prediction starts with
> defining prediction if its what we are both talking about

(The elisions `[...]` drop the owner's market-strategy remarks about a named company, kept out of this public repo; the
lead holds them.)

## Additions, 2026-10-01 (from the owner's phone session of 2026-09-30)

- **The case ledger.** `data-machine-cases.md` beside this card holds the open cases, the extended vocabulary
  (market event, method, blip, chain, closer, edge, fold, dimension, bridge, join, assay, vein, fold depth), the
  measurements of the soft close, the monitoring-by-species table, the hypotheses to test, and the compass. Read it
  with this card; close cases there with the commit and the number.
- **Lane 6, Prospector.** Input: the residual view (mass with no keys, no descriptions, no reader, still written).
  Output: the vein ledger, a table. Scoreboard: veins assayed per week, veins promoted to features.
- **Market event.** The entity is one act of bringing an asset to a room; "auction" is a value of its method
  dimension. The soft-close chain is the first fold over it (80% of BaT lots extend; 39% of bids and a median +25%
  of price happen inside the chain, measured on 400 lots).
- **Not abandoning a fold:** an owner in `pipeline_registry`, a scheduled writer, an assay in `v_job_health`, a
  described output keyed to the trunk, and a reader. A fold with no reader is dead on arrival.
- **Anon rule:** anon may write testimony only as proposals into quarantine, never truth (P0.5, #488).
