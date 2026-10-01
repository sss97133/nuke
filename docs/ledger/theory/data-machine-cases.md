# DATA MACHINE — the case ledger (opened 2026-09-30/10-01)

Companion to `data-machine.md`. That card is the model. This file is the **open cases**, the **vocabulary the owner
asked every agent to use**, the **measurements worth keeping**, and the **compass**. It was written at the end of a
long session with the owner (from a phone, between flights) that resolved several structural questions. Read it
before touching the database, a monitor, a fold or a page that shows data. Keep it current: close a case with the
commit that closed it and the number that proves it.

## 0. The compass (the owner's intent, verbatim fragments)

- "the postgres is not good enough. i want to mine out every single possible grain."
- "we are measuring at stock market speed."
- "final minutes is where all the action is ... bids which trigger 2 min extensions ... it's where the market is made."
- "running hot should show the metrics ... the hot cold should actually be a spectrum calibrated by the entire group."
- "our goal is to zero in on the interesting edge cases across markets. no one wants to see huge lists of porsches."
- "don't try to be a player on the board, just be the board."
- "a lack of data doesn't mean it doesn't exist."
- "chain exists always. it just has to be observed."
- "you don't put a lion's neck monitor on a tree frog."
- "the folds are not being keyed."
- "I don't believe any healthy metrics ... the measurement we want is how long the data point stays in the pinball
  game. how many times does it fold and respond to other data points."
- "the water flows. and if it stops it means the Postgres isn't written right. send the investigation."
- "the system is a shape ... supposed to work when the life force comes to it, human, agentic or financial."
- "I want to see all the 1977 K10 fenders in Tennessee."
- "the next cli agent that spawns on my computer will really need to have this comprehension in its decision making."

## 1. Vocabulary (say it this way; the owner is learning these words on purpose)

In addition to the card's list:

- **Market event**: one act of bringing an asset to a room. Grain: one presentation. Its **method** is a dimension
  value: timed with soft close, live block, sealed, fixed ask, surge. "Auction" is a value, not the entity. Every
  method has a scheduled start, an end, an opening price and a closing price. Duration is a property of the lot,
  never assumed from the platform.
- **Blip**: one observation that an asset was presented at a place and time with a price. Appear, change,
  disappear, relabelled sold are blips. Days on market is a fold over blips. Existence is the first blip.
- **Soft close / extension / chain / closer**: BaT's rule: a bid inside the last 2 minutes moves the close to bid
  time + 2 minutes. The **chain** is the maximal run of bids with gaps ≤ the extension length; a **closer** is a
  bidder who bids inside it. The **scheduled end** sits inside the 2 minutes before the first chain bid; the
  **final end** is what the page records. The extension length is a fact per platform, as-of a date, with a source.
- **Edge**: one row relating two entities at a time (this tool, this component, this vehicle, this person, this
  moment, this witness). Not a Supabase edge function. A **query** is a request for a match; a match is a join
  across edges; the quality of matching is the density of edges.
- **Fold**: state computed from the whole log so far through a named function (state = f(log)). A profile is a fold.
  **Replay** recomputes it from the log; a fold that cannot be replayed is not a fold.
- **Dimension**: an axis you can slice by (make → model → generation → trim; county → state → region; hour → day →
  week; method; condition tier; provenance tier; person; organization; source). Its table holds the allowed values
  and hierarchy. A fact points at each dimension by **key**; a **bridge** lets one fact belong to many values;
  slicing is GROUP BY; cohort stacking is intersecting dimensions; a **residual** is the fact minus what the stacked
  dimensions expect.
- **Join**: "I want to see all the X in Y." Needs an entity for X, an entity for Y, and a key or bridge between them.
  When the relation sits inside a row as columns (13 location columns on `vehicles`), it cannot be joined.
- **Assay**: the one test that proves a monitor or fold works: rows landed per cycle against what the source was
  expected to yield, with the threshold that turns `v_job_health` red.
- **Vein**: a hypothesis written as a query, tested on a sample, promoted to a feature only if it shows signal against
  its cohort. **Prospecting** is survey → sample → assay → drill → mine.
- **Fold depth / fan-out**: how many derived rows key back to a row. A row with fan-out 0 is unobserved. The owner's
  "pinball" measure. Computable from foreign keys; the atlas should carry it per table.
- **Open world**: absence means unobserved, never false. Every fact carries its source and trust for that reason.

## 2. The structural resolutions of 2026-09-30

1. **The folds are not keyed.** Five large folds were built and abandoned as islands: `vehicle_grades` (301K),
   `vehicle_live_metrics` (296K), `analysis_events` (1.36M), `vehicle_field_provenance` (146K), `write_receipts`
   (1.15M). None has a key in or out, a described column, a reader, or an assay. 195 non-empty tables are islands.
2. **Relations were stored as columns, not keys.** Location is 13 columns on `vehicles` and no place entity.
   Bidders are strings (`author_username`) with identity keys half filled (55% on comments, 0% on
   `bat_listings` buyer/seller) although 87–99% resolve by handle. `vehicles.platform_source` is NULL on every
   vehicle created in the last 7 days (55,507). The platform is a string inside the URL, not a key.
3. **Discovery without observation.** Every dead monitor recorded "a car exists" once and never "still here / gone /
   relabelled sold". `dealer_inventory_seen` has seen_count = 1 on all 1,389 rows. 785,126 sitemap URLs were
   discovered on 2026-02-11 and never consumed. That is why the blip model never produced a lifecycle.
4. **A derived time was computed from ingest time.** `auction_comments.hours_until_close` is wrong on 73% of
   checkable rows (median error about 2 years); rows written since 2026-09-27 are 98.8% right. The 2026-01..04
   loaders subtracted event time from ingest time. `live_lot_temperature` keys its comparables on this column, so
   54% of the comparable rows it reads are noise. Fix by recomputing from `auction_events.auction_end_date`, never
   by trusting the column.
5. **The recorded close is the extended close.** "The last 2 minutes before the close" is empty by construction:
   321 of 400 recent lots ended exactly 2 minutes after their last bid. The unit is the chain (§4).
6. **"Healthy" measured exit 0.** The live pull's check cannot see 760 never-read lots or the peak-hour starvation
   (about 332 reads/hour needed against a ceiling of 180). The ceiling (3 lots a minute) is a chosen number, not a
   derived one; cadence must come from the data's physics with the REST-latency governor as the only ceiling.
7. **Two truths for the sale of record.** `vehicle_price_facts()` is right for post-09-27 rows; the cohort readers
   (`get_make_model_terminal`, `market_pulse_filtered`, `price_histogram`, `treemap_live`,
   `vehicles_by_filters`, `county_density_filtered`) read `vehicle_events.final_price` or
   `canonical_sold_price` with no status guard. 83,636 BaT `vehicle_events` read 'ended' with no price;
   `canonical_sold_price` is the running bid on 1,313 live lots.
8. **The analysis organs are frozen.** Sentiment last 2026-03-06 (11.5% of comments), question classification
   2026-04-14 (8.7%), stance 0%, `vehicle_sentiment` 2026-02-07, `vehicle_pulse` 0 rows, `nuke_estimates`
   2026-08-03 with 94% "cold" meaning nothing measured. 15 of 16 analysis crons inactive.
9. **The atlas cannot say who writes.** `writers_30d` / `last_write` are filled for 3 of 925 tables while
   `write_receipts` holds 1.15M rows. The ledger exists and is not wired to the map.
10. **Anonymous doors.** Fixed 2026-10-01 by P0.5 (#488): `exec_batch(text)` and `execute_readonly_query(text)`
    were SECURITY DEFINER arbitrary-SQL executors executable with the public anon key; three testimony tables had
    `USING (true)` write policies open to everyone. Still open: about 66 writing SQL functions reachable by anon
    (the P0.4 census matched only plain `UPDATE t SET`), 127 deployed edge functions with no repo folder and so
    outside `check-write-guard`, anon UPDATE on `vehicle_custom_circuits` (qual = true, not in any migration),
    `vehicle_build_manifest` prices and invoice refs anon-readable, the public photo bucket serving sensitive
    objects by UUID path. The owner's rule from this session: **anon may write testimony only as proposals into
    quarantine, never truth, until verification folds promote it.** Close every anon write path to truth.
11. **Monitors are shot because one poller shape was applied to every species.** The dimension to fix it,
    `source_registry.monitoring_strategy` / `monitoring_frequency_hours`, exists and is empty.
12. **The owner's prompts were narrowed, not lost.** Of 109 asks in the captured notes, 72 traced: 13 built and
    verified, 44 partial (almost all "narrowed": the nearest buildable piece was built), 8 planned only, 5 captured
    only, 2 not addressed. The matrix is in the session scratchpad (`prompt_coverage_2026-09-30.md`) and should be
    moved into this ledger when an agent has the budget.

## 3. Open cases (close with the commit and the number)

| # | Case | Evidence | Status | Remote | First step |
|---|---|---|---|---|---|
| C1 | Live pull starves lots beyond 48 h; check blind to never-read lots | 760 of 1,347 never dispatched; 106 of 243 closing <12 h overdue at 19:45Z | open | yes | in `bat_live_pull_run` reserve one slot per run for `next_poll_at IS NULL`; in `bat_live_pull_check` count never-read lots older than 2 h as overdue; measure buckets before/after |
| C2 | The final minutes are not read live | median last read 48 min before close; 0 of 5 within 15 min; chain observed only at settlement next morning | open | yes | a closing-window cadence: within 10 min of the current end read every minute until 5 min after it stops moving; each read that sees the end move writes an extension event |
| C3 | Scheduled end is overwritten by the reader | `auction_end_date` upserted on every read; `monitored_auctions.extension_count / is_in_soft_close / last_extension_at` empty on all rows | open | yes | keep the first-read end as the scheduled end; write extensions as events (pre-mint check: `timeline_events` vs a fact table keyed to `auction_events.id` and the trigger bid) |
| C4 | Soft-close fold for every closed lot | 400-lot sample: 80% extend; 39% of bids in chains; median +25% price made in chain | open | yes | read-only chain function; batch fold per closed lot as-of its close; bidder record as-of date keyed to `external_identities` |
| C5 | `hours_until_close` defect | 73% wrong; 98.8% right since 09-27 | open | yes | `live_lot_temperature` computes h from `auction_events`; a sanctioned recompute for the derived column in batches, or a view; never trust the column |
| C6 | Identity keys half filled | comments 55%, `bat_listings` 0%, `auction_events` no key columns; 17,389 of 17,600 live-pull rows without identity | open | yes | live path first: set `external_identity_id` at insert in `batAuctionRecord.ts`; then a batched backfill by vehicle_id ranges; retire `bat_users` (4 dead FKs) |
| C7 | `platform_source` NULL on every new vehicle | 55,507 in 7 days | open | yes | the writers stamp the platform key; backfill from the URL host |
| C8 | Place is not an entity | 13 location columns; `geocoding_cache` 26K idle | open | yes | a place entity with hierarchy (county → state → region); keys from vehicles, organizations, listings |
| C9 | Comparables too narrow for half the lots | 6 of 12 lots closing within 10 min had < 8 same-model comparables | open | yes | widen model → make → department per `TEMPERATURE_PLAN.md`; store level and n |
| C10 | Two truths for the sale of record | §2.7 | open | yes | every cohort reader goes through `vehicle_sale_basis()`; `canonical_sold_price` nulled on live lots through the chokepoint |
| C11 | Analysis organs frozen | §2.8 | open | partly | decide which folds have a reader; revive those as scheduled, assayed folds; archive the rest |
| C12 | Atlas has no writers column | §2.9 | open | yes | fold `write_receipts` into `v_schema_atlas.writers_30d` / `last_write`; add fan-out per table |
| C13 | Dealer monitors dead since 2026-02-17 | 495 of 496; no second visit ever | open | yes | the diff step inside `poll-listing-feeds`: presence ledger (dealer, listing_url, observed_at, status, price), appear/disappear/sold events |
| C14 | Craigslist stores share URLs, no post id, no HTML diff, no second sighting | 100% of rows since August | open | yes | read the post id from the detail page; snapshot the detail page (`archiveFetch`); diff the search snapshot per poll into appear/disappear events |
| C15 | Block auctions: no sale entity, no catalog-before, no video | `auction_events` last house row 2026-04-01 | open | yes (catalog); video needs a cost plan | a sale entity (house, start, end, location, catalog); catalog-before per event; results after; video clips as documentation later |
| C16 | Facebook dead since 2026-06-12, 111,669 phantom actives | monitor cron off | open | no (Mac fetch) | per-metro request budget and sighting log; the cloud only folds and checks |
| C17 | Photo classifier fails 100% silently | 1,042 rows `classifier_failed=true`, no error text; cron 478 paused | open | yes (diagnosis) | read the orchestrator's classifier path and the function logs; fix; re-drive 452 pending in a bounded batch |
| C18 | Sensitive photos hidden by RLS, still public by URL | 474 flagged | open | yes | move sensitive objects out of the public bucket or sign URLs |
| C19 | Anon writers remaining (§2.10) | 66 functions, 127 unguarded deployed functions, `vehicle_custom_circuits` | open | yes | a census that matches every DML form and dynamic SQL; revoke; a policy fix; a deploy-list diff against the repo |
| C20 | DDL tripwire is a record, nobody reads it | 1,486 rows, 0 readers | open | yes | a daily drift check that alarms on DDL not from CI; `ddl_audit_log` into `v_job_health` |
| C21 | Lock 3 refills via default privileges | `superseded_rows` got DELETE/TRUNCATE for service_role | open | yes | ALTER DEFAULT PRIVILEGES; REVOKE on `bat_bids`, `superseded_rows` |
| C22 | Five profile subpages silently empty for visitors | TablePage, LifecyclePage, VendorsPage, PartPage, VendorPage read `work_record` directly | open | yes | read `vehicle_build_log_public` for non-owners with an "owner-only" notice |
| C23 | Band writer is a laptop cron nobody monitors | 294 of 1,347 board lots without a band; silent for 10 h | open | partly | a `v_job_health` row for the band writer; move the band into the temperature fold (model 40) |
| C24 | `bat_listings` coverage collapsed in Aug 2026 | 1 of 3,802 Aug lots; `vehicle_id` NULL on every row ending May–Sep | open | yes | find the loader that stopped; key `bat_listings` by URL and vehicle |
| C25 | Vein ledger, residual view, Prospector lane | none exist | open | yes | §5 |

## 4. Measurements worth keeping (2026-09-30, read-only, reproducible)

- **The soft close, 400 settled BaT lots (closed 12 h to 10 days before):** 322 extended (80%); 5,471 of 14,026
  bids inside chains (39%); chain median 14 bids / 3 bidders / 7 minutes, p90 37 bids, max 86 bids over 38 minutes;
  price made in the chain median +25%, p90 +78%; 1,739 comments during chains; 1,079 distinct closers, 57 in two
  or more chains; repeat closers took the high bid on 22% of entries, one-time closers 28.5%. Axiom test: 0 lots
  closed less than 120 s after their last bid.
- **Scale, 0.6% sample of the archive, 2022–2026:** extension rate 77–100% every quarter (structural); chain size
  6–12 bids and price made 15–34% swing by a factor of two between quarters (the signal).
- **Listing proxy to scheduled end:** median 6.86 days (p10 6.73, p90 7.08); closes cluster at about 3:24 pm ET.
  "Listed at" is derived from the first comment, so the start is a proxy.
- **Live pull, first day:** 426 runs, 0 failed; 586 of 1,347 lots read; 17,600 comment rows (5,314 bids),
  100,974 image links; VIN on 388 of 586 read lots vs 4 of 760 unread; `outcome='live'` on 583 of 586.
- **Residual roster (untouched mass, written tables, 0 described, 0 keys):** `analysis_events` 1.36M,
  `write_receipts` 1.15M, `bat_user_profiles` 691K, `vehicle_live_metrics` 296K, `vehicle_grades` 301K,
  `vehicle_field_provenance` 146K.
- **Monitors:** `scrape_sources` 576 (dealer 496, last success 2026-02-17); `listing_feeds` 760 (441 enabled,
  Craigslist 708); `source_targets` 785,126 never consumed; `marketplace_listings` 115,741 FB rows, 9 new in 7 days.
- **Cost:** database 161 GB; 24 active crons; 2,758 runs and 44 minutes of cron time a day. Nothing in the cloud
  burns compute; disk and the compute tier are the bill.

## 5. The lanes, extended (one lane at a time, each with its scoreboard)

Lanes 1–5 are in the card. Add:

6. **Prospector.** Input: the residual view (mass with no keys, no descriptions, no reader, still written; plus
   fold freshness against each fold's cadence). Output: the **vein ledger**, a table, not a document: one row per
   vein with hypothesis, query, sample size, numbers, verdict, as-of, the intent it served, and a bridge to the
   columns and cohorts it touched. Scoreboard: veins assayed per week; veins promoted to features. The lane a
   cloud agent can run alone.

**Not abandoning a fold** means all five hold, checkable from the atlas: an owner in `pipeline_registry`; a scheduled
writer; an assay row in `v_job_health`; a described output keyed to the trunk; a reader (a page or a downstream
fold). A fold with no reader is dead on arrival.

**Growth rule for tables:** a table is born attached (a key to the trunk: vehicle, identity, place, source, market
event), described (COMMENT ON), owned (a registry row) and read. Not fewer tables. No islands.

## 6. Monitoring by species (cadence from physics; one reader per species; one assay each)

| Species | Physics | Reader to extend | Event table | Assay |
|---|---|---|---|---|
| Timed with soft close (BaT, C&B, PCarMarket, Hagerty) | seconds in the last minutes, hours otherwise | `extract-bat-core` via `bat_live_pull_run` | `auction_comments`, extension events | reads landed and rows landed per cycle; never-read lots; last read before close |
| Block houses (Mecum, BJ, Bonhams, RM, Gooding, Broad Arrow, GAA) | an event weekend; catalog weeks before; hammer on video | the routed `extract-*` for each house | a sale entity + `auction_events` | catalog lots before the sale; results within a day after |
| Dealer sites (496) | inventory changes over days | `poll-listing-feeds` with a diff step | presence ledger (blips) | second sightings per visit; disappear/sold events per week |
| Classifieds (Craigslist 708 feeds, KSL, GovDeals) | lives days; relists; cross-metro duplicates | `poll-listing-feeds` + `extract-craigslist` | blips keyed by post id | post id captured; appear/disappear per poll |
| Auth-walled marketplaces (Facebook, eBay) | bans and sessions; the source fights back | the owner's Mac fleet | `fb_listing_sightings` | sightings per pass under a request budget |
| Aggregators (Classic.com, Hemmings, ClassicCars.com) | a map of who exists; never the truth | discovery only | `scrape_sources` / `source_registry` | new dealers found per week |
| Media, forums, video | slow, unstructured, high provenance value; vision costs per minute | none yet | documents keyed to vehicles | cost per clip; claims extracted per clip |
| Owner's private data (Photos, receipts, K5 registry) | private; Mac-bound | `photo-sync-daemon`, receipts reconcile | observations, masked | classifier success rate (today 0%) |

## 7. Hypotheses the owner wants tested as veins (in the vocabulary)

- **The repair chain precedes the market event.** "How many thermostats had to sell before an AC system sold, before
  a whole vehicle sold." Theorem: lots with documented repairs in the N months before listing sell at a higher rate
  and make more price in the chain, cohort fixed. Needs the provenance edge keyed to the vehicle.
- **The players are the drivers.** Bidder records as-of the scheduled end (chains entered, win rate, segments)
  joined to the chain: does the presence of known closers predict chain size and price made, cohort fixed? If the
  buyer lift explains more variance than the calendar, the drivers are the players.
- **External events.** Chain size and price made in the weeks around a dated external fact (rates, seasons, a
  show), against the cohort baseline. External facts enter as testimony with a source and date.
- **Ownership is an entity, not a column.** Single, group, fractional, a share of a cohort, a share of a job.
  A bridge: asset × party × share × as-of. The sale rule is one transfer event on that bridge. Open the beast only
  after the market event and the chain are folds.
- **Value = cohort baseline + provenance residual.** KBB computes the first and cannot compute the second. The
  S tier is a residual that persists across every stacked cohort. Arbitrage is the residual between the price on
  offer and what cohorts plus provenance expect at the moment of the market event. A plan of action (a build, a
  channel) is a predicted change in edges, priced as the residual it creates. This is the six-blank prediction.
- **Fold depth as health.** Rows that fold many times are alive; rows that enter and never fold need observation.
  Compute fan-out per table from foreign keys and put it in the atlas.

## 8. How to ask in database language (for the owner, and for agents translating the owner)

| You want to say | Say |
|---|---|
| "show me all the X in Y" | "a join from X to Y: which entity is X, which is Y, what key or bridge joins them, and which dimension is Y on" |
| "we keep storing it in the row" | "that relation is columns, it needs a key to an entity" |
| "a car belongs to many cohorts" | "that's a bridge" |
| "compute it every time something lands" | "make it a fold, with an owner, a schedule and an assay" |
| "is the monitor working" | "what's the assay, and what does it read today" |
| "the number on the page" | "which fold is the page reading, and does the fold have a reader" |
| "the thing that drives all this" | "the dimension we slice by, and the residual against its baseline" |
| "we are blind here" | "that table is an island: no keys in or out, nothing describes it, nothing reads it" |
| "is this a guess" | "is it replayable from the log" |
| "I think there's something here" | "that's a vein: write the hypothesis as a query, assay it on a sample" |

## 9. Operations while the owner is away

- The cloud runs itself: 24 crons, 44 minutes of cron time a day, `bat-live-pull` at 3 lots a minute. Nothing needs
  the Mac to keep running. The Mac lanes (photo-sync, band writer, FB fleet, K5 toolchain) are paused when it sleeps.
- Do not change compute, plan or disk (AGENTS.md). A compute downgrade restarts the database; the live pull's pause
  rule reads REST latency, so it will pause itself if the smaller box is slow.
- Deploys only through `supabase-deploy.yml`, one migration per commit. Check the workflow is idle before pushing.
- Every change carries before and after numbers. Every monitor carries an assay. Unknown is an answer.
