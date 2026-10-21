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
- 2026-10-06: "it's not extracted because the data model isn't shaped out properly. It's OK to have empty data that's not
  being reported because it's not there, but we still need to shape it out cause there's plenty of signal from each data
  source to help shape some measure of data ... our product exists in the edges and in the folds of source data; that's
  our big win, when we do it in the millions and done properly."
- 2026-10-06: "devise a more efficient way and the terminology on the process we need to run 24/7, the whole data pipeline,
  ensuring the model grows as data is discovered and needing organization ... point to me where it's defined in our
  codebase / documentation / agent .md ... data is still in its raw state for the most part. we have millions of points but
  very little keys, foreign keys, joins, edges, residuals, queries, sql ... we have yet to identify the expertise and what
  it encapsulates, we just know there's a huge demand and our job is to put name and meaning to it." (§12)

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
| C1 | Live pull starves lots beyond 48 h; check blind to never-read lots | 760 of 1,347 never dispatched; 106 of 243 closing <12 h overdue at 19:45Z | **closed** fc5fc212f (20261001000100): one of 3 slots per run reserved for `next_poll_at IS NULL`; the check counts never-read lots > 2 h as overdue. Before 01:00Z 10-01: 517 of 1,217 live lots never dispatched (all beyond 48 h), check said ok. After 07:41Z: 0 never dispatched, 0 overdue in every bucket, check ok (it was red for the ~6 h the backlog took to drain, which is right) | yes | done |
| C2 | The final minutes are not read live | median last read 48 min before close; 0 of 5 within 15 min; chain observed only at settlement next morning | open | yes | a closing-window cadence: within 10 min of the current end read every minute until 5 min after it stops moving; each read that sees the end move writes an extension event |
| C3 | Scheduled end is overwritten by the reader | `auction_end_date` upserted on every read; `monitored_auctions.extension_count / is_in_soft_close / last_extension_at` empty on all rows | open | yes | keep the first-read end as the scheduled end; write extensions as events (pre-mint check: `timeline_events` vs a fact table keyed to `auction_events.id` and the trigger bid) |
| C4 | Soft-close fold for every closed lot | 400-lot sample: 80% extend; 39% of bids in chains; median +25% price made in chain | open | yes | read-only chain function; batch fold per closed lot as-of its close; bidder record as-of date keyed to `external_identities` |
| C5 | `hours_until_close` defect | 73% wrong; 98.8% right since 09-27 | **closed for the reader** 2f48581f4 (20261001000200): `live_lot_temperature` keys comparables on `auction_events.auction_end_date` (else the vehicle's clocked end) minus `posted_at`; lots with no defensible close are not counted (`lots_without_close`). SL500 cohort before: the "bid at 2 h" equalled the final bid on 179 of 312 lots (median 20 bids by 2 h); after: 7 of 183 (median 6). Live lot 99fcbbd4: above 157 of 182 sold comparables, 101 lots without a close, 0.78 s as anon. The column itself is still wrong: a recompute or view is a separate case | yes | the column: recompute from `auction_events` in batches, or a view; never trust it |
| C6 | Identity keys half filled | 2026-10-02 08:17Z: latest 10,000 comments, 9,971 identifiable, 7,960 missing keys; 6,905 missing keys match existing exact identities. At 12:11Z: all 187/187 identifiable arrivals since deployment linked, 0 mismatches, 0 missing vehicle/event links (10,000-row cap; arrivals 08:25–12:11Z). | open — fresh writer verified | yes | `e96ba7f02`: shared bounded identity resolver in core reader + archive loader, deployed `extract-bat-core` v155 via [CI](https://github.com/sss97133/nuke/actions/runs/36983740279). Re-measure with `node scripts/check-comment-linkage.ts --since 2026-10-02T08:24:02.906Z`. Historical rows untouched; historical repair through sanctioned supersession, listing/event identities and `bat_users` retirement remain. |
| C7 | `platform_source` NULL on every new vehicle | 55,507 in 7 days | **writers fixed** 567bf9b0d: extract-bat-core stamps `bringatrailer` on insert and fills it on update; ingest maps its platform to `source_registry.slug` (the platform entity exists: slug matches the column's main values). Measured 10-01: 56,243 of 58,566 rows created 09-24..10-01 NULL (45,612 BaT, 9,963 Craigslist); 10 of 1,227 live BaT lots NULL and so unscheduled by the live pull. **Backfilled** 4191be659 (`backfill_vehicle_platform_source`, cron 512, self-retiring): NULL on vehicles created since 09-24 went 56,243 → 217 (59,549 filled) in 60 runs 08:12Z–10:10Z (2 hit the 50 s timeout), then the job turned itself off; the 217 are hosts outside the map. (PR #498 closed: merging is agent work, not the owner's.) Tested live 10-01 ~09:30Z: a Facebook Marketplace listing (1993 Land Cruiser FZJ80, item 1081313484286582, $9,500, 266,000 mi, Moreno Valley CA) sent through the `ingest` edge function with the service key landed as vehicle 6044cfee with `platform_source = facebook_marketplace`, anon-visible. Found: fan-out 1 (one `marketplace_listings` row); 0 `vehicle_observations`, 0 `vehicle_events`, 0 `vehicle_images`: the ingest writer makes an entity and a blip but no event in the log (§2.3 again). The Nuke MCP connector returned 401 (not a JWT), the wall the Opus session also hit | yes | a `NOT VALID` key to the platform entity `observation_sources(slug)` (declared 20261007233000), not `source_registry.slug`, once the writers' spellings have entity rows (2026-10-14: 285,417 of 570,508 non-null public values, 50.0%, matched an entity slug; `bringatrailer` alone is 210,828). Steps proposed: the `source_registry.observation_source_id` bridge fill (3 of 97 filled; #1251), the alias rows (the #798 proposals, #1246), and the resolver fix (#1253). The sale-provenance writer also writes non-platform values into this column (memo #1500) |
| C8 | Place is not an entity | 13 location columns; `geocoding_cache` 26K idle | **declared at county grain** 2026-10-07 (migration 20261007210000, memo `docs/proposals/2026-10-07-place-entity.md`): `us_county_boundaries` (3,231 counties) is the place entity; `vehicle_location_observations.county_fips` and `zip_to_fips.fips` key to it (NOT VALID). County coding had stopped in 2026-04 (0 of 207,324 rows since carried a code): migration 20261007213000 keys `county_fips` at insert from the postal code through `zip_to_fips` (trigger `trg_key_vehicle_location_county`, ZIP grain, method in `metadata.county_key`) and back-fills the 183,478 eligible rows through `key_vehicle_location_county_from_zip()` (receipted). Still open: state → region levels; non-US places; the 3,244 `_none` rows and 244 retired ZIP codes | yes | a state level when a reader needs it; the per-county residual fold for S01 |
| C9 | Comparables too narrow for half the lots | 6 of 12 lots closing within 10 min had < 8 same-model comparables | open | yes | widen model → make → department per `TEMPERATURE_PLAN.md`; store level and n |
| C10 | Two truths for the sale of record | §2.7 | open | yes | every cohort reader goes through `vehicle_sale_basis()`; `canonical_sold_price` nulled on live lots through the chokepoint |
| C11 | Analysis organs frozen | §2.8 | open | partly | decide which folds have a reader; revive those as scheduled, assayed folds; archive the rest |
| C12 | Atlas write-receipt coverage incomplete | 2026-10-02 12:06Z: atlas join exists, but 0 comment receipts in 30 days, NULL comment writer/last-write, 0 comment receipts among newest 100 receipts despite 100 sampled new comments. After CI, first 2 fresh comments produced 2 receipts naming `extract-bat-core` (12:10Z); atlas shows writer/last-write, receipt-covered tables 3 → 4, 0 lock waiters. | comment log wired — wider coverage open | yes | `58fb870b0` (20261002000100), [CI](https://github.com/sss97133/nuke/actions/runs/37004973159): attach existing INSERT statement observer; reader declares X-Nuke-Writer. PG17 tests cover batch/empty/conflict/mixed replay, preserved testimony/times, unknown writer, SQL precedence and sensor failure. Live caps: 10,000 comments / 1,000 receipts since 12:09:38Z, measured 12:10:50Z. No historical DML. Writer names are caller declarations, not authentication. Next: sensor coverage for one more active trunk table; fan-out remains. |
| C13 | Dealer monitors dead since 2026-02-17 | 495 of 496; no second visit ever | open | yes | the diff step inside `poll-listing-feeds`: presence ledger (dealer, listing_url, observed_at, status, price), appear/disappear/sold events |
| C14 | Craigslist stores share URLs, no post id, no HTML diff, no second sighting | 100% of rows since August | open | yes | read the post id from the detail page; snapshot the detail page (`archiveFetch`); diff the search snapshot per poll into appear/disappear events |
| C15 | Block auctions: no sale entity, no catalog-before, no video | `auction_events` last house row 2026-04-01 | open | yes (catalog); video needs a cost plan | a sale entity (house, start, end, location, catalog); catalog-before per event; results after; video clips as documentation later |
| C16 | Facebook dead since 2026-06-12, 111,669 phantom actives | monitor cron off; 2026-10-18 the iMac runner lands ~900 listings/day with custody, but 5% reached a vehicle (see "Facebook listings reach the graph", 2026-10-19) | open | no (Mac fetch) | per-metro request budget and sighting log; the cloud only folds and checks |
| C17 | Photo pipeline operating coverage | Opening sample: 1,042 rows `classifier_failed=true`, no error text. Writer repair [#506](https://github.com/sss97133/nuke/pull/506) and typed witness [#507](https://github.com/sss97133/nuke/pull/507) merged. Read-only 2026-10-04 UTC: one existing observation has one typed witness and reaches the public field drill; 3/3 cited images load. Cron 478 remains paused. | open — one image-to-reader path verified | yes (bounded diagnosis) | Continue the existing cached-result/receipt lane; prove eligible arrivals reach durable observations, witnesses and a useful reader. Preserve processing holds; the opening backlog count is not a current re-drive instruction. See follow-up below. |
| C18 | Sensitive photos hidden by RLS, still public by URL | 474 flagged | open | yes | move sensitive objects out of the public bucket or sign URLs |
| C19 | Anon writers remaining (§2.10) | 66 functions, 127 unguarded deployed functions, `vehicle_custom_circuits` | open | yes | a census that matches every DML form and dynamic SQL; revoke; a policy fix; a deploy-list diff against the repo |
| C20 | DDL tripwire is a record, nobody reads it | 1,486 rows, 0 readers | open | yes | a daily drift check that alarms on DDL not from CI; `ddl_audit_log` into `v_job_health` |
| C21 | Lock 3 refills via default privileges | `superseded_rows` got DELETE/TRUNCATE for service_role | open | yes | ALTER DEFAULT PRIVILEGES; REVOKE on `bat_bids`, `superseded_rows` |
| C22 | Five profile subpages silently empty for visitors | Opening evidence: all five read `work_record` directly. Table delivered in [#564](https://github.com/sss97133/nuke/pull/564), ordinary-anonymous production 0 → 6 work rows. October 4 Lifecycle assay: six permitted work records, zero production work rows; local connection and work filter show 6/6. | partial — table delivered; Lifecycle locally verified at 22:22Z | yes | Publish and verify the Lifecycle connection; then connect VendorsPage, PartPage and VendorPage where the masked contract supports their question. |
| C23 | Band writer is a laptop cron nobody monitors | 294 of 1,347 board lots without a band; silent for 10 h | open | partly | a `v_job_health` row for the band writer; move the band into the temperature fold (model 40) |
| C24 | `bat_listings` coverage collapsed in Aug 2026 | 1 of 3,802 Aug lots; `vehicle_id` NULL on every row ending May–Sep | open | yes | find the loader that stopped; key `bat_listings` by URL and vehicle |
| C25 | Vein ledger, residual view, Prospector lane | none exist | **closed** ee23d384d (table, Opus session) + b8a9d584f (20261001000500): `v_residual` over `v_schema_atlas` (no key in or out, 0 described, tagged island_written / island_idle); veins V010-V013 (soft-close chain, quarterly chain signal, consequential bidder, live-lot activity at h) registered with pass rules and their 09-30 discovery runs (counts = false). Live 10-01: 184 residual tables (14 still written); 4 veins, 3 discovery runs after edd92d8fd (20261001000600; V011 has none: its 09-30 sample size was not kept, so no number was invented). Fold freshness against cadence is unknown: `pipeline_registry` has no cadence column | yes | the Prospector lane: a scheduled assay per vein (`confirmation` runs on held-out lots) |
| C26 | Buy-and-recondition decision: "to what condition do I bring it to lock in a profit" | §10 | open | yes | land the `lx450_condition_v0` observations; run `run_vein_lx450_condition('confirmation')`; make the rubric a scheduled fold over listing text |
| C27 | Stored market evidence cannot reach an immediate vehicle/opportunity answer | 2026-10-04 Corvette conversation; bounded DB and public-reader probes, §11 | partial — public RPC context and private Mecum capture preview delivered; typed binding, price/configuration qualification, UI and latency open | yes, within each lane's existing authorization | Reconcile stored source fields and event identities; extend the shared reader to retain broad market context, nested cohorts, unresolved evidence and measurable arrival performance |
| C28 | The repair loop has no queue in the database and no standing runner | 2026-10-06 20:40Z: 385 live tables, 377 with a model gap (369 describe, 90 key, 66 owner, 3 assay), 8 complete; 2 of 26 active jobs carry an assay; the night-shift plist unloaded since 10-02; the headless Claude form is blocked by the local permission classifier; the queue is PLAN.md and lane memos | open | queue yes; the runner is the owner's call | `scripts/discovery/repair-backlog.sql` ranks the backlog from the atlas; extend `v_residual` into that ranked view; the owner picks the runner form (§12) |

**C22 table connection — 2026-10-04 UTC.** Useful question: what work was recorded on this vehicle,
by which permitted supplier, and at what build stage? Existing `work_record` testimony is read through
`vehicle_build_log_public(uuid)` alongside observations the caller may already read. `TablePage.tsx`
merges by original observation ID, preferring the direct row for owners. Its consumer is the searchable
`/vehicle/:vehicleId/table`, with a work-record filter and an owner-only detail notice. It changes no
testimony, permissions, writer, cron or schema. C22 remains partial for the other four readers.

Entity: vehicle. Grain: one currently permitted, non-superseded work observation. Keys: RPC parameter
and the existing `vehicle_observations.vehicle_id = vehicles.id` join; original `observation_id` is the
merge key. Direct rows retain their source registry connection. The masked contract does not return a
source ID/URL or part number, so these remain unknown. Its event date `done_on` is the recorded
transaction date, otherwise the observation date; it exposes no ingestion clock. The adapter leaves
ingestion time unknown, rather than substituting the event date. Build stage is displayed as build stage
text, not promoted to installation evidence. This is a current reader, not a historical as-of reconstruction.
The existing canonical writer is `ingest-observation`; the reader recomputes on vehicle-page load and
is idempotent on observation ID. No new computed field or scheduled fold is introduced.

Bounded assay, 17:38–17:43Z: ordinary anonymous RPC for public vehicle
`a90c008a-3379-41d8-9eb2-b4eda365d74c` returns six permitted rows, while the production table shows
zero work records. The local corrected table shows all six, zero withheld-detail links, no amounts,
and the missing-ingestion-clock notice. Four executable `TablePage.test.tsx` tests cover search,
direct/public deduplication, zero labor, unknown dates, empty results and explicit reader failure;
typecheck, build and enforced guardrails pass. Production deployment and the same runtime assay remain
to be verified at publication. This sample does not establish fleet coverage or completeness of the
other observation slices, which retain their existing per-kind limits.

**C22 Lifecycle connection — 2026-10-04 22:17–22:22 UTC, preparation evidence.**
Useful question: how many permitted work records are recorded on this vehicle, by which named
supplier, and on which recorded dates? The existing Lifecycle reader now merges the same masked
`vehicle_build_log_public(uuid)` contract by original observation ID, preferring directly readable
rows. Its work filter prevents newer condition observations from crowding older work out of the
12-row activity window. Work records are counted as work records, not receipts; public build stage
is shown as build stage and does not enter purchased/installed part counts. Supplier strings are
presentation groups, not canonical organization identities. Public-only rows have no withheld
observation/vendor drill links. Visible spend is a subtotal of readable amounts, excluding masked
amounts; it is not ownership-period investment or profit.

Entity/grain/keys and clocks are those in the table connection above: current non-superseded work
observations joined to the vehicle by the existing RPC, ID deduplication, recorded transaction date
or observation date as `done_on`, no public ingest clock. The 22:16Z atlas identifies
`ingest-observation` among the observation owners/writers; no new writer, cadence or computed field
is introduced. Recompute happens on page load; the same inputs produce the same rows/counts. This
is a current permission-filtered reader, not a historical as-of fold. The observation-to-vehicle join
is implemented in the RPC; an enforced FK to `vehicles` remains a separate structural prerequisite.

Anonymous production before: six permitted RPC rows, zero Lifecycle work rows. Local after at
390px: work count six, filter exposes all six original IDs and recorded dates, zero withheld-detail
links or visible amounts, unknown-ingest notice, no horizontal overflow. Six executable
`LifecyclePage.test.tsx` contracts cover masking, zero labor, direct/recent/public deduplication,
owner drill and subtotal, date ordering/unknown dates, condition crowding and filter round trip,
reader failure, empty results and transport rejection. Final enforced typecheck/build/guardrails pass.
These are local preparation stages; the publication receipt records the subsequently checked head,
merge, deployment and production assay. C22 remains partial for the other three readers, and the
masked contract supplies no part number for a public part-specific join.

**C22 supplier directory — 2026-10-05 UTC, bounded consumer repair.** Table and Lifecycle
readers were delivered by [PR564](https://github.com/sss97133/nuke/pull/564) and
[PR584](https://github.com/sss97133/nuke/pull/584); their dated opening assays above remain historical.
The next useful question is which supplier is recorded for work on a vehicle, including work whose
supplier relationship is unresolved. At 02:53:40Z the same public vehicle's anonymous vendor directory
shows no groups, despite six permitted `vehicle_build_log_public` rows. All six supplier fields are
unknown; this assay does not prove a named supplier or canonical organization relationship.

Entity: vehicle; source grain: one permitted non-superseded work observation; consumer grain: one
case-insensitive supplier-text group or an explicit unrecorded-supplier group. The existing
`vehicle_observations.vehicle_id` FK selects the entity, and original observation ID deduplicates
masked/direct copies with the directly readable row preferred. Text grouping is not a canonical
organization bridge. Recorded transaction/observation date remains event time; the public contract
has no ingestion time. Canonical writer remains `ingest-observation`; the existing RPC and consumer
recompute on page load, with no new stored measure, writer or cadence. Current reader only; no
historical reconstruction or complete spend is claimed.

`VendorsPage.tsx` now connects the existing masked RPC, retains unnamed work explicitly, and labels
visible totals as excluding masked amounts. Public groups link onward through the existing work-table
evidence reader rather than offering inaccessible vendor-detail drills. The seven focused
`VendorsPage.test.tsx` contracts cover the source connection, owner/public ID deduplication, event
dates, unknown suppliers/dates, punctuation collisions, masked fields, empty sources and failures.
The source-connection test fails on the previous reader. At 02:56:30Z the local anonymous 390px
reader retains the same six source IDs in one explicitly unrecorded group, with count 6 and recorded
date 2026-02-25; its table link reaches all six original observations, with no inaccessible vendor
links, amounts or page overflow. Enforced typecheck, build and guardrails pass. Production deployment
and the same frozen six-source runtime assay remain pending publication; C22 stays partial for VendorPage and PartPage.

**C22 supplier detail — 2026-10-05 UTC, bounded construction evidence.** The directory delivery
above is recorded by [PR615](https://github.com/sss97133/nuke/pull/615). The next question is which
permitted work observations belong to a supplier group, including an unresolved supplier. At 07:42Z,
the anonymous detail reader returned zero observations for the same six retained public work rows.
Connecting `vehicle_build_log_public(uuid)` to `VendorPage.tsx` exposes those six original IDs and
recorded dates; directory links carry either an exact case-insensitive supplier text or an explicit
unrecorded selector. Punctuation-distinct names do not collapse through a lossy slug. Legacy
substring links remain supported. No supplier text is promoted to a canonical organization key.

Entity: vehicle; grain: one currently permitted non-superseded work observation, grouped by recorded
month or directly readable shipment. The existing RPC vehicle selector and original observation ID
are the bridges and replay/deduplication keys, with directly readable copies preferred. Writer remains
`ingest-observation`; page load recomputes this current reader. Recorded work/observation dates are
event dates; masked rows expose no ingest clock, source URL, part number, amount or organization key.
No historical as-of fold, new writer, schedule, testimony or permission change is introduced. Direct
kind slices retain their existing bounds; errors or filled bounds expose incomplete coverage.

Same frozen-source local assay at 390px: zero -> six rows, 6/6 original IDs, identical source
fingerprint, zero visible amounts, withheld-detail links or page overflow. Thirteen focused reader
contracts cover exact/unresolved selection, owner overlap, replay, zero amounts, unknown dates,
punctuation collisions, legacy links, empty sources and failed reads. The enforced typecheck/build/
guardrail gate passes. These are preparation stages; the private completion receipt records the
checked head, PR, deployment and same-source production verification. C22 remains partial for
PartPage and for canonical supplier relationships unavailable in this contract.


**C17 follow-up — 2026-10-04 UTC, bounded read-only trace.** The October 2 intake receipt records observation
`6c3ca7fa-0147-4542-8785-9f8ffe724ed2` and an exact replay returning `duplicate: true`. The current check finds its
single derived witness `f25d069e-3a1b-49a9-852e-8681f105ee4b`, the enabled insert trigger and the same IDs in
`get_field_provenance`. An anonymous visitor to the [1967 Corvette profile](https://nuke.ag/vehicle/12cde831-8981-471b-9631-588bc1251259)
can open interior color and inspect all three cited photographs; no browser errors were observed.

The traced claim is **visible blue upholstery**, confidence 0.6, from source family `mecum:1159827`. Review time
and ingest time are distinct; photograph capture time and model identity remain unknown. The reader preserves
those limits and warns that multiple views from one source family are not independent confirmations. The
canonical “Teal Blue” remains a listing claim; this trace does not prove the appearance claim changed that field.

Operating evidence at this check: the live atlas reported NULL `writers_30d` and `last_write` for
`vehicle_observations`, `observation_witnesses` and `vehicle_images`. The witness projector has a registered owner,
but its registry entry explicitly records no scheduled cadence/health reader registered by that migration.
Sample success does not establish corpus throughput, historical coverage or a completeness alarm. Continue
through the existing receipt/health machinery; do not recreate the repaired classifier or another observation
store. Preserve the paused drain and OWNER-OFF desktop intake. No intake, replay, model call, production write or
schedule change was initiated by this trace. Private evidence: `~/nuke-logs/observation-trace-2026-10-03/trace-receipt.json`;
prior intake/replay evidence: `~/nuke-logs/dm-ui/image-witness-live-deployment-receipt.json`.

**C17 receipt coverage implementation.** Migration `20261004052152_observe_image_observation_writes.sql`
attaches the existing `record_write_receipt()` INSERT observer to observations, witnesses and images.
`ingest-observation` declares its writer on its actual database requests. These labels are producer declarations,
not authorization; image analysis UPDATEs and historic arrivals are outside this sensor coverage.
Run the bounded read-only check after CI deployment, with `--since` set to that deployment's time:

```bash
bash scripts/check-ingestion-health.sh --image-observations \
  --vehicle <public-vehicle-uuid> --since <deployment-ISO-time> --field interior_color
```

It checks at most 1,000 observations plus a truncation sentinel for one vehicle and ingest window, same-vehicle
image links, typed witnesses, public reader citations, enabled sensors and recent table-level receipts. Exit 0
means `passed_in_scope`; exit 1 means failed/unknown query or missing evidence; exit 2 means incomplete, including
no eligible arrivals, no measured reader, undeclared writers or truncation. Receipt presence alone is not
per-observation coverage proof. No new schedule, processing, model call or historical replay is implied.
Detector failure tests run in the local ENFORCE gate; disposable PG17 fixtures test actual sensor and SQL behavior.
C17 stays open for processing coverage, historical edges and a scheduled completeness assay.

**C17 cached input coverage assay.** The arrival check above begins with landed observations. To detect
qualified cached readings whose claims never arrived, use the same worker's canonical projection and
readback rules in explicit read-only mode:

```bash
bash scripts/check-ingestion-health.sh --image-observations --cached-coverage \
  --vehicle <public-vehicle-uuid> --sources 20
```

This uses the existing Supabase environment configuration. It inspects one public vehicle, at most 100 newest
approved public-source image candidates, and up to 20 qualified cached sources by default (`--sources` accepts
1–100). It selects current immutable BYOK testimony through the existing bounded parent reader, computes
expected qualified claims, and verifies existing canonical output and typed public reader citations. Source
and image eligibility reuse the worker's rules; mutable image metadata is not promoted to testimony.
The budget is 20 client requests, 10 seconds per request and 60 seconds overall, with zero intake/model calls
or processing checkpoint writes. Scheduled apply settings do not affect this command.

Exit 0 means the selected vehicle's uncapped eligible sample was verified; exit 1 means missing claims,
invalid output, absent witness/reader evidence or query failure; exit 2 means incomplete, including no eligible
claims or a work cap. This measures cached output coverage, not new photo throughput, capture-clock accuracy,
source independence, fleet completion or recurring execution. The scheduled processing entry point and its
push/apply trigger are unchanged. Both detector suites run in the existing image-projection CI job.

**C17 fresh image admission.** The October 4 read-only trace found 20 new BaT links marked
`skipped`, gallery eligible, with no processing receipt or linked observations. The public vehicle
page loaded its BaT gallery images. This is the extractor's deliberate cost boundary: indexing
external links does not request paid analysis. New links declare that policy under
`ai_scan_metadata.image_intake`; existing rows are not rewritten. The declaration is operational
metadata, not testimony, a model result or permission to resume processing.

```bash
bash scripts/check-ingestion-health.sh --image-observations --fresh-images
```

This reads `get_pipeline_pulse_24h().fresh_image_flow`, also included in the existing heartbeat's
pulse snapshot. It selects the newest public BaT vehicle among at most five public feed arrivals
in 24 hours, then at most 20 recent BaT links plus one truncation sentinel. It reports gallery
eligibility, explicitly deferred links, unexplained skips, processing states and receipt presence.
Old skips retain an unknown reason; a later processing receipt or processing clock prevents an
initial admission declaration from hiding later work. Empty/capped samples stay incomplete.
Exit 1 means a sampled failed processing status or query/contract failure; otherwise exit 2:
claims, witnesses and reader output are not measured here, even for completed statuses.
No new alert rule, schedule, inference, re-drive or paid processing authorization is implied.
Use the arrival/cached assays above for testimony and reader evidence. C17 remains open.

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
- **Session of 2026-10-01 (Fable, solo, ~$40):** C1 517 → 0 never-dispatched lots in ~6 h; C5 the SL500 comparable set re-keyed on event time (179 of 312 "bids at 2 h" were finals; now 7 of 183); C7 writers stamp the platform key, 56,243 NULL rows wait on PR #498; C25 `v_residual` and V010-V013. Found: the live pull's schedule sync filters on `platform_source`, so C7 and C1 are one organ.
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

The species is a column (2026-10-18): `observation_sources.species`, with `species_set` and the evidence it was read from (`species_evidence`); a listing takes its own species where its URL or metadata shows it (`v_listing_species`). The extractor's builder declares it from the source itself (`.claude/rules/extraction.md`, Source species), and the Sources board groups by it with the names above. Barn Finds is an aggregator (a curator: its posts point at eBay, Craigslist and Facebook listings), with its own 'BF Exclusive' ads as classifieds.

### BaT native transport pressure — bounded repair, 2026-10-21

At 18:47 UTC the live assay covered 0 of 24 eligible current subscriptions. In the 18:45–18:52:15 UTC
log window, seven extractor background exceptions reported fetch rate limits during stream
admission. Read-only closing-target selection took 0.383s cold and 0.350s warm for 27 targets;
that is selection latency, not continuous capture. Existing code launched one recovery request
per subscription and admitted lots separately, multiplying requests before acknowledgement.

The existing collector now bounds recovery to two reads, preserves queued recovery as an
explicit coverage gap and respects its original deadline. Its buffer combines healthy lots
inside the existing 50-frame canonical admission limit, isolates atomic mixed failures and
preserves unacknowledged per-lot prefixes. The transport honors runtime and HTTP rate-limit
delays without extra fetches during the delay, with HTTP limits scoped to their server origin.
Deterministic tests cover request reduction,
cross-parent binding through actual HTTP intake, poison-lot isolation, arrivals during a pending
acknowledgement, source-control liveness and truthful unfinished recovery. These are fixture
claims; deployment and the identical live coverage/latency assay still need dated receipts.
No source cadence, budget, capacity, schema, retained-sale admission or episode-v2 hold changes.
PR #2451 reached normal deployment at 19:13 UTC (extractor 4.5.4, platform version 191).
All twelve post-deployment health samples still failed; coverage ranged from 0 to 21 of the
22–24 currently eligible subscriptions. A later session inspection found 60 recovery-backoff
records and 22 without errors, not a distinct-lot denominator. The next correction keeps
unattempted recovery queued during cooldown, paces starts and coalesces frame/coverage admission
within the existing limits. Shared failure acknowledges neither caller; an explicit semantic
refusal restores independent requests. This follow-up still requires its own deployment and
live verification; the first deployment did not establish continuous capture or fleet gain.
PR #2452 deployed extractor 4.5.5 (platform 192) at 19:40 UTC. All twelve subsequent
health samples also failed: 0–10 covered of 26–27 currently eligible subscriptions. These are
current subscription snapshots, not a continuous or fleet denominator. Endpoint-wide intake
latency mixes other modes and cannot locate the native stage responsible for the gap.
The next bounded diagnostic extends the existing collector and intake: a control-plane run UUID
joins start/end records to native request labels, and at most twelve sampled intake records per
worker separate authentication, monitor/source/parent reads, preparation and canonical RPC time.
Transport counters describe attempts, backoff and acknowledgement processing, not unique testimony
or usable coverage. Missing end/timing records remain unknown. No source bodies, prices, headers
or credentials are logged. Deployment and a six-start/full-lifetime trace remain pending; diagnostic
delivery alone cannot close the capture-integrity assay.
The retained sold gold case still lacks parser/parent attestations; repairing transport does
not manufacture them or establish fleet-wide supported-answer gain.

### Cars & Bids capture integrity — bounded repair, 2026-10-18

The source question is whether a retained auction reading contains a usable keyed and clocked
thread, before its current state is updated. `scripts/cab-api-sync.mjs` previously treated a failed
comments request as an empty thread. The existing `inspect-cab-snapshot.mjs` now owns the deterministic
`cab-capture-integrity-v1` assessment, called before the collector's first write. Failed/malformed
responses, wrong listing identity, missing/duplicate thread IDs, missing source clocks, invalid bid
amounts, source bid-count disagreement and a full limited page refuse the extraction. A disagreement
between concurrently fetched detail and thread can cause refusal; it is not proof the source is wrong.
No pagination protocol is invented. Unknown source bid counts remain unassessed; matching counts do
not prove source enumeration or semantic accuracy. Comment-counter semantics, retained DB links and
public delivery remain separate, unassessed gates.

Offline replay: `node scripts/inspect-cab-snapshot.mjs --api-json <retained-json-file>`. Output contains
counts and reasons, not comment bodies or handles. `scripts/inspect-cab-snapshot.test.mjs` exercises
the actual collector's pre-write refusal and unknown/disagreement cases. The historical skip rule and
dispatch population are unchanged, labelled previously processed rather than complete; legacy mixed
row telemetry is explicitly not new-row or model coverage. No collection, replay or paused job is
started by this repair. Three explicit retained captures passed the local capture assessment; their
bid counts matched the stored totals. This is bounded validation, not fleet/public readiness.

Next relationship to assay: the collector's listing observation uses source URL/identifier but does
not pass typed snapshot or presentation pointers through `observationWriter`. Inspect canonical intake
admission and existing binding owners before extending that path. Original source-ID reconciliation,
capture identity, disagreement, withdrawal and anonymous-reader behavior must be proved together;
adding a pointer alone does not close the case. Current stage: local implementation and focused tests;
publication/deployment evidence belongs in the private lane receipt.

The October 18 observation-load replay uses one retained C&B page and the live observation-index
definition in disposable PostgreSQL 17. The old writer returns no observation ID and a contained
error: its 6,808-byte index row exceeds the 2,704-byte limit. Compact fields occupy 1,380 bytes;
full text stays in `content_text` and import metadata in `extraction_metadata.raw`. Opt-in raw-data
hashing retains materially different evidence in dedup while existing callers keep their old hash.
The source capture clock stays separate from database ingest time. A caller must await the writer,
inspect its errors, and read back the same source, vehicle, clock and evidence on an unsuperseded
row; a duplicate ID alone is insufficient. The local replay proves admission, identical-input dedup
and supersession refusal, with registry/provenance branches isolated. Earlier vehicle writes are
separate and are not rolled back by an observation failure. Production delivery, full intake/RLS,
typed capture bindings and fleet coverage remain separate evidence in the private ETL receipt.
The next private PG17 counterexample changes only the stored clock by one microsecond. JavaScript
millisecond equality falsely accepts it; the readback must also constrain `observed_at` through
PostgreSQL's native timestamp equality. That refuses the different instant while accepting equivalent
time-zone representations. This is a local receipt-verification assay, not evidence of production
clock corruption or a new production admission; exact deployment/runtime stages stay in the receipt.
An independent collector replay uses a qualified retained response and rejects its snapshot insert.
The old archive phase ignores the database error and proceeds toward the model with no saved capture.
Archive lookup errors, rejected inserts and missing persisted IDs must stop that attempt. Dedup and
unique-key races qualify only the exact successful platform/URL/content-hash tuple; an unsuccessful
capture is not promoted or overwritten. This preserves the existing pre-write capture guard and
does not repair source pagination. Script availability, collector activation and full source-to-reader
acceptance remain separate stages in the private receipt.

**Next loop, staged 2026-10-18: explicit listing-capture custody.** The prospective
`cab_listing_capture_v1` mode in the existing `ingest-observation` accepts only an original
observation, retained snapshot and canonical auction-lot selector, with explicit dry-run. Its
database qualifier independently checks inline UTF8 SHA, case-sensitive source auction ID,
same attributed parent/source, exact reconstructed listing narrative and microsecond clocks.
Both existing source guards must admit the exact derived tuple under locks. A separate sparse
`provenance` receipt keys the original observation, capture and presentation; the original remains
unchanged. It asserts narrative provenance only: no copied specification, sale, independent
corroboration or physical identity verification. Receipt ingestion establishes when that
binding was recorded; it does not reconstruct historical native identity availability.

The existing inspector's `--lineage <original> <snapshot> <presentation>` previews without writes;
`--result <receipt>` requalifies stored custody through the same service-only qualifier. Withdrawal,
privacy or changed source evidence withholds verification. No public grants, collection, queue,
source activation or historical replay are added. Local tests combine the actual canonical handler,
PostgreSQL admission, current receipt reader and two-session mutation controls. Three explicitly
selected retained tuples are rehearsed offline; this is
not production admission, actual anonymous privacy acceptance or a fleet readiness numerator.
Full retained/eligible populations and net public supported-answer gain remain unassessed.
The production schema/admission change remains a held draft until separately authorized; do not
treat implementation, local tests or source-selector previews as a deployed repair. The existing
observation visibility predicate withholds `provenance`; this internal receipt must not become a
second public listing. The source's existing listing capability qualifies its retained parent;
this guarded derivation does not declare a new publisher-provided provenance capability.

The first authorized live attempt qualified all three selectors but admitted none: the existing
market/media guard also requires sale context for an auction FK. The local fixture had omitted that
guard. The follow-up fixture now reproduces the refusal with its actual function and both triggers;
the narrow repair independently requalifies the exact protected narrative receipt, excludes media
citations, and preserves legacy sale/chassis checks and both source-custody guards. A passing
qualifier remains distinct from a successful canonical write and current stored-receipt readback.

The typed relationship uses the existing `auction_event_id` FK, shared with the lot interaction
log. It leaves `source_vehicle_event_id` NULL: that pointer would make native-state replacement
refuse under existing sanctioned episode supersession. The local counterexample replaces the
native state while the auction-lot/capture receipt remains verifiable; no correction owner or
public policy is weakened.

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
  after the market event and the chain are folds. The owner's 2026-10-04 refinement below adds the ownership
  period's attributed investment and cash outcome to that design; it does not authorize productive admissions.
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

## 10. Case C26: the buy-and-recondition decision (opened 2026-10-01)

**The question.** The owner sent a Facebook Marketplace listing: a 1996 LX450, VIN JT6HJ88J8T0149733, 224k miles,
clean Nevada title, no catalytic converters, $9,300 and then $9,000 OBO, Las Vegas. "Is it a buy?" turned into
"to what condition must I bring it to lock in a profit?" That second question is §7's
"value = cohort baseline + provenance residual": a plan of action priced as the residual it creates.

**What answering it cost, and why.** An agent spent well over 100k tokens. Every step stood in for a missing organ:
- **Reading the post (C16).** There was no browser with the owner's login in the loop. A crawler preview gave the
  title, the VIN, the first part of the description and one photo. The price drop never became a blip.
- **Missed rows.** `marketplace_listings` holds 7 LX450 rows that the agent never read, and it claimed there were
  no private-party prices. Open world: absent from the answer is not absent from the database.
- **The cohort was a string match.** `model ILIKE 'LX%450%'` pulled in "LX450 Project", "LX450 for Charity" and
  duplicate rows. There is no make → model → generation key, and place is a bare `state` string (C8).
  `get_comps` and the agent's SQL disagreed (C10).
- **Condition was unmeasured.**
  - `vehicles.quality_grade` was 5.5 on 14 of 33 recent lots: a default, not a measurement.
  - `condition_rating` was set on 2 of 33.
  - Photo condition scores existed on 2 vehicles, against 80 to 980 photos per lot (C17).
  - The description-extraction fold (`ai-description-extraction`, 111,567 condition rows) stopped on 2026-04-13
    and covers 1 of 61 LX450 lots.
- **The listing text was gone.** `vehicles.description` is cut at about 481 characters, and BaT `listing`
  observations carry 16 characters of `content_text`. The agent re-downloaded 32 BaT pages Nuke had already ingested.
- **The condition fold was built by hand.** A subagent scored 32 listings in about 106k tokens, and the scores
  lived in a scratchpad.

**What it found (the discovery sample: 32 lots sold 2024-01 to 2026-09).** Mileage alone explains R² 0.36 of log
price, and adding condition raises that to 0.62. Effects on the mileage residual, with Welch t:

| Feature | Effect | t |
|---|---|---|
| Service records | ×1.39 | 2.14 |
| Title or history flag | ×0.75 | −2.43 |
| Poor paint | ×0.74 | −1.84 |
| Damaged interior | ×0.78 | −1.74 |
| Lockers | ×1.25 | 1.57 |
| Engine major work | ×1.26 | 1.13 |

For the subject truck, plan B (converters, hood and roof refinish, documented service, reupholstered interior)
priced a median $22,068, 80% range $14.0k to $34.7k, against roughly $17.5k all-in. The costs are the agent's
estimate, not data.

**What was landed (Turing order: register, then run, then improve).**
1. **Registered.** Migration `20261001120000_vein_ledger_lx450_condition.sql` opens the vein ledger (C25). It
   registers V001–V006, one per feature above, each with its pass rule written before any counting run. It also
   registers V007, the six-blank prediction for the subject truck.
2. **The rubric.** `docs/ledger/theory/veins/lx450_condition_v0.md` is the one shared definition. Every score lands as a
   `condition` observation through `ingest-observation`.
3. **The runs.** `run_vein_lx450_condition(sample)` appends verdicts:
   - `discovery` never counts, because the hypotheses were read from it;
   - `confirmation` is 2019 to 2023, 39 held-out lots;
   - `live` is every lot that closes after registration.
   A better rubric is `_v1` and a better hypothesis is a new version; neither is an edit.

**Still open.**
- The condition rows must land through `ingest-observation`. The session's Nuke connector lost its sign-in before
  writing.
- The Facebook truck needs its vehicle and its two price blips.
- The rubric needs to become a scheduled fold, reading stored full listing text rather than re-downloading it.
- Model needs to be a key, and place needs to be an entity (C8).

**Found while building (2026-10-01, measured):**
- **The full listing text was in Postgres the whole time.**
  - `extraction_metadata` rows with `field_name = 'raw_listing_description'` cover 97 LX450 vehicles, median 2,789 characters.
  - `vehicles.description` is a deliberate 480-character summary (`normalizeDescriptionSummary`, `_shared/batParser.ts:747`), and nothing points from it to the full copy.
  - 80 of 96 snapshot bodies live in a private storage bucket (`listing-snapshots`) that SQL cannot read.
  - Result: an agent re-downloaded 72 pages that were already stored.
- **The condition dimension exists.** `condition_taxonomy` has 202 descriptors, about 90 of them real (paint delamination, fading, respray, upholstery tear, dash cracking, service records, collision, flood, frame corrosion). The rest are fragments parsed from service manuals (`interior.gauge.terminal_no`). Only image tables key to it; text claims have no key.
- **No model key.** `canonical_models` has no J80 row. `vehicles.series = 'FZJ80L'` is set on 96 of about 190 LX450 rows, and the rest are spelled "lx 450", "LX LX 450", "lx450Fremont, CA154K".
- **The citation slot exists.** `ingest-observation` already accepts `citation.excerpt` and `raw_source_ref`. It gave agent-inferred rows `confidence_score` 1.0, because it scores match quality and ignores `agent_tier`.
- **The rubric skipped discovery.** It was written before discovery, against `.claude/rules/extraction.md` ("sample 20–50 documents, enumerate all fields, aggregate, then design"). The catalog in `veins/lx450_claim_catalog.md` is that discovery.
- **Held-out run, read-only on prod** (39 lots, 2019–2023):
  - lockers ×1.41, t 2.38;
  - poor paint ×0.68, t −2.06;
  - records ×1.16, t 0.98 (did not hold);
  - engine work ×0.73 (sign flipped);
  - interior ×0.95;
  - title flag n = 1.
- **The reference was Iverson's 1979 Turing lecture, "Notation as a Tool of Thought"** (session of 2026-09-30, 19:40Z): schema = theory, data = models, query = theorem, backtest = experiment. The cost of this case is what happens when the notation is missing.

**Owner refinement, 2026-10-04: investment during an ownership period.** "Restoration" is a spectrum of
interventions, including preserving condition, maintenance, repair and improvement. The accounting of investment
made while a holder owns or funds an asset is a separate measurement from the vehicle's acquisition-to-sale price
change. Spending is evidence of cost; it does not establish an equal increase in value. An observed sale remains
one dated event in the persistent vehicle's history.

The owner's words **"repair" and "sale" name cohorts of connected data**. The shape of a repair includes parts,
labor, actions, participants, documents, payments and condition evidence; a sale has parties, offers/bids, price,
fees, transfer and supporting testimony. Fan-out is recursive: a parts cohort contains individual part cohorts;
labor reaches the performing person's identity, skills, ratings, tools, rates and availability cohorts. Shared
nodes need explicit roles: the person who entered a labor row is not automatically its performer. These are
evidenced relationships with separately recorded dates and states. One payment may settle several repairs,
one repair may span ownership periods, and one evidence node can
participate in multiple cohorts. Make each membership and edge's meaning explicit before folding or aggregating.
Keep the evidence cohort describing an episode and the analytical cohort comparing episodes explicit, with their
own membership rules. Naming an episode "repair" or "sale" does not prove the completeness of its underlying data.

The grain to reconcile is **vehicle × evidenced holder/interest × ownership period**, with separately attributed
acquisition, disposal, work, documents and money movements. Legal title, possession, operational custody and an
unverified claim are different relationships. Current profile ownership or an external handle is insufficient to
assign an earlier cost to a holder. Folded vehicle aliases retain their original testimony and canonical lineage.

Keep these measures distinct:

- **Observed price change:** source-qualified acquisition and disposal prices, with their dates, original currency
  and fee basis. It is neither the holder's complete cash outcome nor a market index.
- **Documented holder cash outcome:** reconciled, attributed ownership-related money in and money out, with costs,
  fees, refunds and reimbursements separately visible. Estimates, unpaid work, owner labor and financing principal
  are not silently treated as paid vehicle costs. Net proceeds and already-deducted fees must not be counted twice.
  Missing or unallocated evidence remains unknown; a partial total must not be labelled complete profit.
- **Declared return measure:** a named investment basis, holder share, cashflow timing and completeness policy are
  prerequisites for ROI. Preserve maintenance, preservation and improvement allocations and their evidence; an
  accounting interpretation of profit or expense recovery must name its policy rather than follow a blanket
  "restored" label.
- **Market and intervention context:** condition/equipment evidence at both sale dates and comparable-market
  baselines over that period. Spending or a price residual alone does not prove an intervention caused an uplift.

An invoice, receipt, work order and payment may be several witnesses to the same economic item. Reconcile their
references before aggregation; do not sum every representation. A payment can settle multiple items, and an item
can span vehicles, holders or periods. Attributed allocations must conserve the supported amount in its original
currency and expose unresolved remainders. Event time, payment/work time and database recording time stay separate.
Later evidence produces a new measurement revision without replacing the earlier receipt or leaking into an
earlier as-of comparison. Private amounts and documents require their own source-publication decision.

**Implementation boundary.** Reuse existing ownership, transfer, payment, receipt, timeline and work structures;
inspect live ownership and constraints before selecting a writer or adding a relation. The live schema inspection
on 2026-10-04 found `vehicle_ownerships` with dated holder links, `ownership_transfers` with distinct user/external
identity references, and existing receipt/work/payment structures. Several locator columns are not foreign keys:
`receipts.vehicle_id`, `receipts.timeline_event_id`, `work_orders.vehicle_id`,
`vehicle_ownerships.proof_event_id`, and `payment_events.source_observation_id`. Existing financial-document
allocations have typed payment/document links in their own subsystem; this does not establish vehicle-period cost
attribution. These are measured relation gaps, not permission to validate held keys, duplicate a financial ledger,
scan private accounts, backfill testimony directly or activate a planned writer.

**Closure evidence required.** A documented ownership period must trace acquisition, disposal and each admitted
cost to source evidence; demonstrate one charge counted once across multiple documents; expose refunds, uncertain
dates, holder/vehicle allocations, unit conflicts and uncovered categories; and retain prior as-of results when a
new receipt changes the outcome. Carefully documented cases can validate these mechanisms before any population
claim about improvement returns. This refinement is a design contract; it installs no relation, ROI reader or fold.

## 11. Whole market evidence and immediate vehicle questions

**Owner direction, 2026-10-04.** A red 1963 split-window Corvette lead exposed failures in retrieval,
source mapping, event reconciliation, media binding, cohort construction and the public reader. The
owner asks for repairs that make the existing evidence better and immediately queryable for **all
vehicles**. More individual appraisals do not close this case. Extend C9, C10, C14, C15, C17 and C26
through their existing owners; this case connects their consequences to one useful answer.

### Continuation brief for future agents

The [retained evidence repair guide](../../market/RETAINED_EVIDENCE_REPAIR_GUIDE.md) records the
remaining relationships, existing owners, disagreement cases and receipt locations. Start there
after the theory card. The preparation entries below preserve their dated stages; the following
delivery receipt establishes what this implementation batch subsequently completed.

**Delivery receipt, 2026-10-05 UTC.** PR [#600](https://github.com/sss97133/nuke/pull/600), checked
`c2ea13304d90`, merged as `02c34847e322`; full commit references are in the linked PR and private
completion receipt. Supabase run
[37251537436](https://github.com/sss97133/nuke/actions/runs/37251537436) succeeded.
Its additive `valuation_by_ymm.source_context` was anonymous-runtime-verified for Corvette,
Mustang and BMW after 189 local PostgreSQL assertions and all 21 applicable PR checks passed.
Corvette returned 942 recorded auction URL groups, including 372 Mecum and 85 Barrett-Jackson,
alongside 21 separately qualified prices. These are different grains and eligibility populations;
the URL groups are not verified unique sales or newly qualified price comparisons.

PR [#624](https://github.com/sss97133/nuke/pull/624), checked
`163888b2c62e`, merged as `2eb495d61956`; full commit references are in the linked PR and private
completion receipt. Supabase run
[37275853026](https://github.com/sss97133/nuke/actions/runs/37275853026) succeeded.
All 21 applicable PR checks passed; local verification included 127 synthetic tests and one
private retained-capture replay. The same service-only preview changed HTTP400 → HTTP200 in
1.427 seconds and recovered lot173892's civil scheduled run day, 2014-01-24, with a verified raw
hash. Anonymous access returned HTTP401. Currency, fee basis, actual sale clock and parent/event
binding remain unestablished; the result is unqualified. Neither repair changed the public UI.

**No persisted evidence-model repair was applied:** no tables, columns, constraints, typed
relationships or canonical historical testimony changed. PR600 replaced an existing SQL reader
through its specifically approved migration; PR624 changed read-only edge code. Historical intake
and production source corrections remain held. Initial concurrent valuation timeouts remain an
open reliability concern despite subsequent successful warm probes. C27 is still partial.

The owner's latest correction is central: other Corvettes support market volume and movement even
when they are not close price comparables. A 1963/427 configuration is a thin slice inside the
Corvette cohort. Its proposed high position within that market is a hypothesis to measure, with
supporting and contrary evidence. The reader must preserve that hierarchy. A restrictive price
admission policy must not erase evidence usable for another measure.

### What the conversation requires

The initial listing is a blip and raw material. Preserve the source listing identity, capture,
description, images, observed clues and clocks without forcing an identified vehicle profile.
Unbound evidence remains available for a later supported match. A photo can establish a visible
split window, hood shape, side-exhaust layout or emblem with its method and uncertainty; an emblem
does not establish the installed engine. Keep seller claims separately attributed. The initial
answer can provide broad market context and a supported benchmark with a wide uncertainty range.
Unknown build details should narrow that answer's claims and identify the next useful evidence.

Start with the existing DB and captures, then reconcile the missing pieces to their sources. The
agent should not require the owner to search every venue manually, nor repeat source extraction
already performed. Acquisition, capital, operator skill, seller cooperation and an eventual buyer
are separate relationships. Someone who found and can market a vehicle may lack purchase capital;
that missing role can create a matching opportunity. Price spread alone does not establish profit.
Keep the seller's willingness, costs, time, consignment terms and role attribution explicit when
evidenced. This conversation authorizes recording the repairs, not contacting sellers, looking up
private identities, financing an acquisition or activating an automated opportunity exchange.

### Dated evidence and its limits

Read-only DB snapshot at **2026-10-04 22:10 UTC**: `vehicles.year = 1963`,
`model ILIKE 'corvette%'`, nondeleted, at most 2,000 parent rows; 1,537 returned. Prices were read
through the existing `vehicle_price_facts(uuid[])` / `vehicle_sale_basis()` contract. Source labels
used the returned platform, with recognized URL host or discovery source as fallback. These are
recorded parent rows in a broad diagnostic slice, not unique chassis, unique sales, total market
coverage or a production cohort membership rule.

| Source label | Recorded parent rows | Positive sold amount admitted by that reader | Positive stored sale_price without admitted sold amount |
|---|---:|---:|---:|
| Mecum | 572 | 42 | 479 |
| Bring a Trailer | 433 | 324 | 1 |
| Barrett-Jackson | 290 | 244 | 10 |
| Gooding | 29 | 24 | 1 |

The columns have different meanings. A stored number is not automatically a sale. An unresolved
price still leaves source, presentation and specification evidence worth reconciling and querying.
The raw slice mixes coupes, convertibles, original cars, modified cars and incomplete descriptions.
Its aggregate median cannot appraise this lead.

The ordinary public `/valuation?year=1963&make=Chevrolet&model=Corvette` reader at
**22:21:24 UTC** displayed 21 qualified cached BaT source lots out of 1,249 current public cohort
parents. Its window was 2023-10-04 through 2026-10-04. Condition, build, body, trim, engine, mileage
and equipment remained unmatched. The private prefix query and public exact-model/windowed reader
are different populations; their difference is not a measured exclusion count. The deployed graph
and source drill exist, but this read did not deliver Mecum/Barrett-Jackson market context or prove
the target's rank. An entered asking-price percentile describes that amount against the displayed
prices, not the vehicle's expected sale amount.

Specific reproducible source repair: vehicle `b2414fd1-33eb-4911-bf14-2832ccc432f7`,
Mecum [lot 173892](https://www.mecum.com/lots/173892/1963-chevrolet-corvette-resto-mod/).
The source page identifies **Kissimmee 2014, F208, Friday January 24, 2014**, with a published
$100,000 result and an aluminum 454/510 HP engine. The stored row had no sale date, a legacy
`available` status and `engine_size = '327 V-8'` alongside its 454 description. This source check
recovered evidence; it did not write a correction. An auction run day must retain its source and
day precision; it does not establish settlement time or an unstated fee basis. A 2014 result belongs
in the history and needs an explicit time treatment before supporting a current-price comparison.
Do not silently apply inflation, fees or today's build state to it.

A diagnostic URL grouping found 163 repeated locator groups / 164 excess parent rows. It normalized
scheme, `www`, trailing slash and discarded query/fragment solely to find candidates. This is not a
verified duplicate-sale count or an acceptable universal merge rule. Some exact source lots occur
on multiple parent rows; different source episodes on the same VIN are valid separate history.
Other sampled rows pointed to non-Corvette listings or carried inconsistent platform/build fields.
Reconcile source identity and membership before counting them.

The recently cited Mecum video example was **1967** Corvette S114, vehicle
`12cde831-8981-471b-9631-588bc1251259`, not evidence that the 1963 slice was processed. Its bounded
probe found 11 YouTube media observations among 22 vehicle observations. All 11 lacked typed
`source_vehicle_event_id` and `property_id`; bid displays and room context lived in payloads. A
displayed current bid cannot become a final sale result. Discovered videos, extracted grains,
landed testimony, bound events and reader-qualified measurements are different coverage stages.

### The shared market answer

Use one declared as-of/cutoff and expose each measure's own supported population. Every view can
drill through the same retained source evidence, including unresolved candidates where permitted.

1. **Recorded market activity.** Show observed presentations, active supply, changes, outcomes and
   time coverage across relevant venues. Count market events once across duplicate captures. An
   unknown outcome contributes to presentation coverage, not confirmed sale volume. Sell-through
   needs a defensible denominator; liquidity needs covered time/exposure. Report source gaps and
   ingestion changes so an expanding scraper is not narrated as an expanding market.
2. **Market movement and price history.** Return dated distributions within compatible currency,
   fee basis, source/method and supported comparison strata. Preserve old events. Compare periods
   with the same eligibility and coverage treatment; disclose changed vehicle mix. A raw median
   change is not a constant-quality index, and a highest bid is not a sold price. Partially qualified
   source amounts remain inspectable with their limits instead of disappearing from the evidence.
3. **Nested configuration context.** Resolve the vehicle's evidenced memberships through the
   existing cohort/dimension owners: broader market, Corvette, generation, year, body and supported
   build/condition/equipment slices. Retain match, mismatch, unknown and conflict per dimension.
   Wider cohorts inform volume, movement and market position even when unsuitable as direct price
   peers. Sparse slices retain their sample size and uncertainty; any pooling or shrinkage must
   name and validate its method. Cross-platform cohorts must disclose venue composition.
4. **Vehicle position and opportunity.** Name what is ranked: a known historical sale, asking
   amount, expected realized value, demand or another supported measure. Provide cohort, dates,
   units, eligible/observed denominator, method/version, contributors, counterexamples and
   uncertainty. Test the 1963/427 high-position hypothesis using configuration evidence and matched
   historical results; a badge or entered ask cannot prove it. If projecting a sale amount, fill the
   theory card's six prediction blanks and backtest. Keep ranking evidence separate from the
   acquisition/capital/operator/seller path and its actual costs.

This extends the existing [market measurement contract](../../market/MARKET_MEASUREMENT_UI_CONTRACT.md).
There is no separate Corvette-only valuation algorithm or new dashboard required by this case.

### Repair assignments and acceptance

**Order:** restore access to retained evidence and repair source/event mappings first; build the
shared market/cohort answer next; measure and deliver its speed and public usefulness. Each lane
starts by verifying current atlas ownership and relevant handoffs. The existing canonical writer
for testimony is `ingest-observation`; correction and supersession use sanctioned paths. Names
below identify capabilities to extend, not permission to bypass a held writer or start a new service.

| Priority | Repair | Existing capability or lane | Evidence that closes the repair |
|---|---|---|---|
| P0 | DB-first retrieval and lead-stage contract | Existing ingest/extractors, source captures, `api-v1-comps`, `valuation_by_ymm`; agent guidance above | A listing-only case returns retained evidence, unresolved identity, broad context and decision-critical next gaps without inventing a profile or repeating a stored capture fetch. Agent and public results declare their differing access scopes. |
| P0 | Source field reconciliation | `extract-mecum`, other venue extractors, `archiveFetch`, sanctioned provenance correction/supersession | Replay pinned source fixtures, including 173892: supported event/run day, amount/outcome, platform, installed-vs-factory claims, currency/fee knowledge and unknowns survive intake and reach the reader. Test conflicting/no-sale and missing-unit cases. Historical repair is separately authorized and measured. |
| P0 | Vehicle, source episode and capture identity | Existing vehicle/event/observation and source identity owners; sale-event selection lane | Same episode/two captures counts once; same chassis/two auction appearances counts twice; uncertain alias remains unresolved. Contradictions and original testimony survive. Non-Corvette pointers cannot pollute a resolved Corvette cohort. Counts conserve candidates, aliases, unresolved and admitted episodes. |
| P0 | Media evidence reaches market events | Existing Mecum broadcast-evidence lane and `ingest-observation`; existing source-event/property owners | One known clip drills media timestamp → retained observation → source lot/event → permitted vehicle/cohort reader. Intermediate bid, hammer indication, no-sale and uncertain lot attribution remain distinct. Per-event manifest accounts for discovered, captured, extracted, landed, bound and usable grains. No 1967 example claims 1963 coverage. |
| P1 | Whole-market and nested cohort reader | `valuation_by_ymm`, existing market readers/cohort owners, `vehicle_price_facts`; C9/C10 and sale-event selection contract | One response retains broad presentation/outcome context and separately qualified price/build slices across captured venues. The 1963 case exposes Mecum/BJ/BaT contributions or exact unresolved reasons. A second non-Corvette case proves the mechanism is general. No narrow-price gate removes valid volume evidence. |
| P1 | Configuration and position measures | Existing specification, image witness, component/build and cohort folds; C17/C26 | Episode-scoped body/engine/build/condition claims retain evidence and knowledge time. Broad and narrow counts, ranking basis, sample/coverage and uncertainty are reproducible. Badge-only engine stays uncertain; contradictory build claims are visible. Held-out/replay evidence supports any estimated rank or price claim. |
| P1 | Immediate, bounded query path | Existing shared SQL/API readers and fold/queue owners | Profile the same declared requests cold and warm, fix the measured bottleneck, then record p50/p95, payload and row scope after deploy. Use indexed/replayable maintained state; source qualification and historical replay do not repeat on every page load. Establish and assay an explicit arrival budget; increasing the timeout does not establish an instant answer. |
| P1 | Useful answer and evidence drill | Existing `/valuation` graph, market views, agent/API and iOS consumers | A user sees wider context, dated movement, supported position and missing evidence before manually assembling comps. Drill to exact source episode/capture/media and field support; historical and recent prices remain distinguishable. Shared measures agree for the same scope/cutoff. Low-confidence or excluded evidence is explainable, not a silent empty chart. |
| P2 | Opportunity roles and next evidence | Existing relationship/identity, ownership/transfer and market capabilities; verify live owners before design | A declared opportunity distinguishes discoverer/operator, available capital, seller cooperation and buyer fit, with attributed work/terms and missing roles. Negotiation and inspection advance only the current decision. Product design and any automated contacts/transactions require their own scope and authorization. |

**Reuse current work.** The existing public sale graph/source drill was delivered through PRs
[#574](https://github.com/sss97133/nuke/pull/574) and
[#578](https://github.com/sss97133/nuke/pull/578); analytical coverage and broad-reader performance
remain open. An existing October 4 Mecum source helper (`parseMecumSourceResultCandidate`, local
commit `20209e9d11cf`) had focused local tests and a cached-source
fixture, but was not pushed, merged or deployed at inspection. Its conservative unit/outcome gates
are useful inputs to reconcile; its local success is not production admission or a solved reader.
Consult its current handoff before duplicating it. A prior bounded Mustang UI receipt reported a
9,711 ms initial request and a 10,088 ms all-years failure; those are dated observations of that
request, not Corvette latency or a measured fleet percentile. Current performance needs its own probe.

### Release and closure receipt

Each repair records **entity/grain, canonical keys and unresolved links, event clock, ingest/knowledge
clock, source/custody, owner, writer, reader, executable assay, replay policy and authorization**.
For a fold, declare refresh cadence and the health check that detects stale or disconnected output.
Check live `v_schema_atlas`; check `v_job_health` when scheduled work matters. Coverage reports
distinguish not observed, capture inaccessible, extraction missing, binding missing, fold stale and
reader exclusion. Each state must lead to an owned repair or an explicit source limitation.

Closure uses the same retained acceptance cases before and after, including unbound identity,
old run date, conflicting outcome/unit/build, duplicate capture, repeat sale, thin slice, unsupported
media result and changed source coverage. Retain as-of behavior when later evidence arrives. Record
**implemented, tested, merged, deployed and runtime-verified** separately, with a checked commit and
bounded query receipt. This entry documents the requirements and probes; it changes no production
data/schema, installs no writer or measure, and proves no arbitrage or high-ranking target vehicle.

**First implementation, 2026-10-04 UTC — source context in the existing candidate query.**
`scripts/discovery/sale-event-candidates.sql` now computes a `sourceContext` receipt independently
of price qualification. It counts recorded source episodes across native captures and parent
aliases, retains earlier resales, reports unresolved identities/outcomes, distinguishes outcome
contradictions and multiple parent pointers, and exposes parents without native event/listing rows.
Native overflow withholds totals. The context is a private current-row diagnostic, with no event
window applied and no historical knowledge or public-source qualification. It establishes neither
confirmed sales nor market movement. Existing candidate testimony and qualification remain intact.

Focused regression: the prior query fails the new mixed-venue context case; the prepared change
passes 58 actual PG17 assertions, including a Mustang and sparse Corvette evidence. An EXPLAIN-
checked live read used 511 public, nondeleted real parents with exact recorded year/make/model
`1963 / Chevrolet / Corvette`, independent of registered cohort membership. It returned 323 native
presentations, 316 recorded episode keys and 195 parents without native presentations. Mecum
contributed 307 presentations / 304 episode keys, including 60 episodes without a recorded day.
Both 5,000-row selectors were untruncated; 273 capture headers remained candidates. Management
request time was 1.716 s on the first read and 0.538 s for the warm plan; warm database execution
was 82.82 ms. These two diagnostic requests do not establish public RPC latency, p95, total Corvette
coverage or parity with the earlier 1,249-member registered public-reader population. Public reader
integration, source correction, cohort ranking and market movement remain open. Publication stages
for this preparation must be taken from its PR receipt rather than inferred from these tests.

### Hypothesis and cross-vehicle assay, owner request 2026-10-04

**Hypothesis:** useful market evidence is retained but lost between source records and the public
answer. Separating presentation context from price qualification, and reconciling missing source
fields, should expose more usable evidence across vehicle cohorts. This does not predict a price
or authorize historical testimony writes. A high position for the specific Corvette remains untested.

**Test:** before the live reads, select three existing registered year/model subjects: 1963 Corvette,
1966 Mustang and 1972 BMW 2002. For each, use the existing `cohort_members` owner and current
public/undeleted/real-vehicle gates. Run the unchanged candidate SELECT with at most 10,000 parents,
5,000 rows per native table and 5,000 capture headers. Check that non-BaT episode identities and
date gaps recur beyond Corvette. Separately call the deployed `valuation_by_ymm` with the same
subject, a 2023-10-05 through 2026-10-05 event window and evidence cutoff 2026-10-05 00:00 UTC.
Native context has no event window or price qualification; subtracting these populations would
not measure missing eligible sales.

Live reads at **2026-10-05 00:03 UTC**, complete within each supplied parent page:

| Registered subject | Current public parents | Native presentations | Recorded episode keys | Non-BaT keys | Keys without a recorded day | Undated keys with a stored body pointer | Public qualified USD source sales in the separate three-year window |
|---|---:|---:|---:|---:|---:|---:|---:|
| 1963 Chevrolet Corvette | 1,250 | 1,428 | 956 | 511 | 240 | 83 | 21 |
| 1966 Ford Mustang | 1,732 | 1,827 | 1,144 | 496 | 249 | 85 | 20 |
| 1972 BMW 2002 | 234 | 382 | 210 | 12 | 46 | 43 | 0 |

The 2,310 recorded platform/episode keys have no overlap across these three receipts. Native
identity remains unresolved for 62 presentations; 900 current parents have no selected native
event/listing rows. Other observation/capture evidence for those parents is unassayed. Three Mustang
episode keys have conflicting recorded days. Multiple parent pointers occur on 29 keys and need
reconciliation rather than automatic merging. Neither count establishes an error or a unique chassis.

The live valuation definition still selects `vehicle_events.source_platform = 'bat'`. The hypothesis
about lost broader context is supported in all three measured cohorts. This venue boundary also
has a source/parser/public-permission contract; removing it alone cannot qualify another venue's
amounts. Public qualified counts remain 21/20/0; no reader change or extra admitted sale is claimed.

Only 211 of 535 undated keys (39.4%) have a successful stored body pointer under the exact indexed
header selection. Most missing dates therefore cannot be assumed recoverable from those pointers.
A nine-capture sample, selected from these queues before fetching bodies, projected at most 512 KiB
per body and reused `parseQualifiedBaTSale`. Four captures for four recorded episode keys produced
sale tuples and matched the stored SHA; one body had an ambiguous/missing supported result and four
exceeded the assay body cap. This is a parser preview. Parent/episode attribution, knowledge clocks,
units/fee treatment and sanctioned admission still need verification. No native date was overwritten.

**Implemented and locally tested:** extend the existing `scripts/assay-sale-population.mjs` with
`{ schemaVersion: 'sale_event_candidate_assay_v1', receipt, options }`, where `receipt` is the unchanged
candidate query output and `options` keeps the existing explicit population/subject/policy/cutoffs.
The normal `--input PRIVATE_JSON --out PRIVATE_JSON` command now returns a repair plan keyed by
source episode: missing/conflicting days, unknown/conflicting outcomes, sold claims missing amounts,
multiple parent pointers, unresolved native refs and exact candidate capture refs. Cached pointer
counts are unknown on header overflow; native overflow refuses totals. The native format rejects
qualified claims, duplicate/missing presentations and foreign source tables. It admits no testimony,
does not fetch bodies and retains the original saved-population format. Output stays private, mode
0600 and no-overwrite. Fifteen focused contracts pass; the five new boundary/queue cases failed on
the prior implementation. Existing PR CI runs this same test file.

The same tool can retrieve an existing registered subject in one command:
`node scripts/assay-sale-population.mjs --subject COHORT_UUID --out PRIVATE_JSON`. It executes the
existing SELECT through sanctioned `scripts/data/q.sh` once, retains the exact private native receipt,
and returns the repair plan. UUID validation, read-only SELECT checks and a 10,001-parent sentinel
protect the bounded request; the two native selectors and header selector retain their independent
5,000-row limits. Unknown/oversized subjects refuse rather than presenting a sampled market. This
mode supplies no comparison subject or feature policy and never promotes candidate prices. Existing
outputs refuse before the query, failed reads create no empty receipt, and source/tool errors are
redacted. The offline saved-input mode remains available for replay. Both are developer diagnostics;
the anonymous valuation route remains unchanged.

**Performance boundary:** first management reads were 7.241/5.703/1.312 s for Corvette/Mustang/BMW;
one warm EXPLAIN per request measured 3,428/3,096/565 ms database execution, with no sequential
scan of the four target source/parent tables. Full candidate/header receipts differ from the earlier
metadata-only query. These are individual probes, not p50/p95 or a delivered instant public answer.

**Next owned repairs:** use the exact queues to check retained source bodies first; route absent,
ambiguous or inconsistent evidence back to the existing venue/capture/identity owners. Add permitted
broad context to the shared public reader separately from price admission. Keep the existing
historical-intake and production holds. Publication/merge stages belong in the checked PR receipt;
the live assay proves current diagnostics, with zero production schema/data/access changes and
zero inference calls. C27 remains partial.

### Shared reader repair prepared, 2026-10-05 UTC

The repair is **evidence reconciliation** and **reader repair**: preserve source claims and their
unresolved relationships, then make the existing reader expose permitted market evidence separately
from qualified sale prices. `20261005011200_valuation_public_native_source_context.sql` adds
`source_context` to the existing `valuation_by_ymm` response. It retains recognized public auction
URL groups from existing anonymously readable native tables, including recorded outcomes/days and
platform, locator, date and multiple-parent disagreements. Exact contributing native IDs and source
links permit reconciliation. Current public/undeleted/vehicle gates apply to totals and drill. No
native amount, private source kind, raw capture or historical-availability claim is projected.

The original price-reader body is unchanged outside the additive context CTE/JSON field. Context
survives a price-capture refusal, but its own 10,000-row-per-table overflow withholds totals and
examples. Explicit evidence cutoffs/known-at requests withhold current native context. Complete
source totals have a separately declared limit of 20 evidence examples per venue, prioritized by
mapping gaps and then recorded day; those examples are not a price sample. The migration guards
the reviewed original/new body fingerprint and preserves the existing signature, owner and ACL.

Local replay executes the actual migrations: **189 PG17 assertions pass**, including old price,
custody, replay, anonymous privacy, overflow, cross-vehicle and context-with-price-refusal cases.
Read-only production component probes over the same three registered current public cohorts return
Corvette **1,389 presentations / 942 public auction URL groups**, Mustang **1,745 / 1,096**, and
BMW **382 / 210**. These URL groups are not confirmed unique sales. They differ from the private
candidate assay through public venue URL scope and explicit attribution of conflicting platform
labels to their recorded URL host. Corvette includes 372 Mecum groups, 109 without a native day,
and 85 Barrett-Jackson groups, 14 undated and eight with contradictory native platform labels.

Bounded evidence reduces the three component response payloads from 806/940/192 kB to 76/67/27 kB
while preserving complete source totals. Management request probes remain 4.805/5.906/1.565 s;
payload reduction alone does not establish an instant answer. These execute the proposed context
SELECT, not an installed RPC or public UI. The production function change is prepared for review;
it is not merged/deployed. Source fact corrections, historical admission, qualified cross-venue
prices, sale-time configuration matching, ranking, public display and latency closure remain open.

### Retained Mecum source preview prepared, 2026-10-05 UTC

PR [#600](https://github.com/sss97133/nuke/pull/600) delivered the preceding additive reader after
specific owner approval. Supabase deployment and anonymous Corvette/Mustang/BMW reads were
verified. Initial concurrent Corvette/Mustang requests timed out; subsequent serial and one warm
concurrent repeat passed. Cold/p95 reliability and source-fact admission remain open.

The next bounded repair extends **`extract-mecum`**, reusing its unpublished source-result helper
from `20209e9d11cf`, rather than creating another venue parser. Parser revision
`source_result_candidate_v2` accepts the retained `runDates` midnight name and slug forms as a
**civil scheduled run day**. Original taxonomy claims, missing siblings and disagreements survive.
Nonmidnight values, zones, arbitrary timestamp prefixes and invalid civil dates remain unsupported.
A run day is not an actual closing or settlement instant, and does not establish currency or fees.

Service-only `action: source_result_preview` requires one explicit snapshot UUID. It uses the
existing archive owner with an additional capture-ID pin, verifies the retained raw hash and returns
an allowlisted private result with distinct source capture/recording clocks. It has no URL/latest
fallback, source fetch, inference, queue claim, testimony admission or metadata/profile write.
Anonymous and user callers cannot read the preview. Raw HTML, unrelated markdown, protected
metadata and storage locators stay out of the response. Vehicle/event custody is explicitly
**not evaluated**; source identifiers retain their separate namespaces.

The predeployment live request returned HTTP400 (unsupported action). Local replay of the exact
retained lot173892 capture through the actual handler/archive/auth code now recovers **2014-01-24**
and its unqualified reported sold amount. The source hash matches; no source was fetched or
production record changed. **128 focused tests pass**, including that private replay and existing
BaT archive/intake custody regressions; public CI runs127 synthetic tests. The enforced checkout
gate and write guard pass. Publication/deployment stages belong to this repair's PR receipt; this
is prepared code, not a live source correction. Historical admission, capture-to-vehicle/event
binding, episode configuration semantics and qualified cross-venue prices remain held/open.

## 12. The repair loop as a standing process (opened 2026-10-06)

**Owner direction, 2026-10-06.** The owner asked where the 24/7 process is defined, what to call its parts, and for
a more efficient form: "ensuring the model grows as data is discovered and needing organization ... millions of points
but very little keys, foreign keys, joins, edges, residuals, queries ... our job is to put name and meaning to it."
This section is the index he asked for, the process in the card's own words, and the proposal. It installs nothing.

### Public-readiness criteria corrected, owner direction 2026-10-12

The owner rejected any-binding coverage as a useful headline and required criteria derived from
production-grade public exploration. Field-slot and canonical-claim counts point toward missing
structure but do not establish even basic public-use acceptance. The owner also rejected unknown
Facebook-wide size as an excuse for having no acquisition goal: Facebook is a larger platform
entity whose channels, markets, publishers, presentations, media and interactions need scoped work.

The [theory card's public-use criteria](data-machine.md#public-use-readiness-owner-correction-2026-10-12)
now define per-capability evidence/identity/public-reader/freshness/quality gates, ready/blocked/
not-assessed populations, full-population denominators and net supported-answer gain. The Facebook
contract requires an intended target inventory, enumeration witnesses, capture depth, revisit
obligations and retained-population reconciliation. Source-level history can be useful before an
asset match; unknown global platform size does not erase target-plan or retained-backlog obligations.

This entry records criteria preparation, not a measured readiness numerator or completed launch.
Implementation belongs to existing source/stack/assay and `db-stats`/SystemStatus owners. Closure
requires versioned public capability specifications, automated population reconciliation, independent
quality evidence, anonymous end-to-end assays and dated before/after ready counts. Existing source,
privacy and operational holds remain. Preserve older field/capture metrics as dated diagnostics.

### Executable public inventory acceptance matrix, prepared 2026-10-13

The owner clarified that Facebook is one source in the broader goal: Nuke should replace daily
listing rounds. Extend the existing public-reader assay through
`bash scripts/check-ingestion-health.sh --public-readers --acceptance-matrix /private/manifest.json --out /private/new-matrix.json`.
The versioned `public_inventory_acceptance_v1` input contains `population`, `assessments`, `targets`
and `targetPlanComplete`. It compiles public find/open, attributed inspection and one-inventory
contracts, including original source evidence, new/change/repeat membership, clocks, asking-price
units, collection gaps and history. Existing owners include HomePage/MarketPulse, Search/useSearchPage,
`universal-search`, VehicleProfile and provenance readers; routes are candidate owners, not runtime passes.

Gate declarations need matching subject/capability/gate receipts and qualified method/clock/digest
metadata. Public delivery requires anonymous runtime evidence; source fidelity and semantic quality
require independent review. Missing objectives, missing measured service/freshness metrics, private or
fixture delivery, future/wrong-scope receipts and unresolved gates cannot pass. Held or underspecified
source/channel/region/query/cadence/depth targets remain blocked or not assessed. Configured targets do
not establish enumeration, capture or revisit coverage. Failed reader/source gates retain reason codes.

This compiler has no network, writer, source activation or inference. Private output is exclusive-create,
with input and assay hashes. It classifies supplied declarations; it does not independently validate
those receipts, produce a fleet readiness percentage, certify a release or grant public access. A
complete explicit manifest must reconcile its declared pair count; mixed capabilities are reported
separately, with no averaged readiness score. The first executed private matrix contains declared
capabilities and known source-scope blockers, not a population census or newly modeled records.

Focused offline failure/scope contracts passed before publication. Delivery and actual public-reader
acceptance remain separate stages. Next: bind the required gates to existing actual reader/quality
assays and reconcile retained populations; resolve the public inventory gap without counting private
Facebook history or isolated ingestion success as one-place public usability.

### Full-population reconciliation, prepared 2026-10-13

The same assay now accepts `--reconcile-population /private/config.json --out /private/report.jsonl`.
The `population_reconciliation_v1` mode joins a sorted, exhausted subject manifest to separately
sorted assessment receipts with bounded memory. It retains every eligible member: absent assessments
remain `not_assessed`. Each capability has its own eligible denominator, ready/blocked/not-assessed
totals, gate reasons and intersections. Other capability grains remain explicitly unmeasured.

The configuration binds the population filter, full retained/public denominators and their grains,
UTC measurement window, source receipt, and the row counts and SHA-256 hashes of both streams.
Each stream must end with a matching dated exhaustion receipt and content digest. Duplicates,
unmatched or ineligible assessments, grain/window/count mismatches, incomplete tails and changed
files fail reconciliation. Only a terminal `reconciled` summary establishes completion; a partial
output is not a completed census. Private output includes the configuration and assay hashes plus
the digest of all preceding output rows. The existing explicit-manifest mode remains available.

This remains an offline compiler of supplied gate evidence. Matching file hashes cannot establish
source fidelity, independent review or anonymous runtime delivery. A windowed cached export is
dated evidence, not an atomic or current production snapshot. Reconciliation alone neither adds
usable records nor produces a launch certificate. The actual population gate assays remain required.

The same owner also accepts `--compare-populations /private/comparison.json --out /private/delta.jsonl`.
Its `population_comparison_v1` configuration carries `before` and `after`, each with an explicit
`evaluatedAt` UTC clock and a complete reconciliation `configuration` as defined above. Stream paths
are relative to the comparison file. It reruns both reconciliations with bounded pull streams,
including all original counts, hashes, tails and gate qualification; it does not trust summary totals.
Population filters, grains and capability eligibility rules must match. Retained/public denominators
and measurement windows remain beside each side's eligible population.

The result separates shared-member state transitions from arrivals and departures and reconciles the
ready-count delta to those components. `blocked → ready`, `not_assessed → ready`, `ready → blocked`
and `ready → not_assessed` remain separate. Changed freshness/service objectives have a separate
transition matrix; loosening an objective cannot masquerade as a pass under unchanged objectives.
The primary gain/loss counters require unchanged objectives; the separate decision-count delta
includes all objective changes and reconciles to arrivals/departures. Population measurement clocks
and window boundaries cannot run backward. Each side is evaluated at its declared time, so expired evidence can regress. A newly assessed pass
is a measurement change, and no state transition by itself establishes that a repair caused the gain.
Only the terminal `reconciled` summary establishes a complete comparison. A broken input tail leaves
an incomplete private output, never a success report. This mode performs no network, model calls or
database writes and does not independently certify the supplied gate evidence.
Configuration and stream inputs must be regular files; nonblocking admission rejects named pipes
without waiting indefinitely for another process.

### Where the process is defined (checked against origin/main and the live database, 2026-10-06 20:40Z)

| Question | Where | What it establishes |
|---|---|---|
| The model, its invariants, the six lanes, the five-step repair loop | `data-machine.md` | log → state → baselines → features → predictions; every reference a key; the database describes itself; "not abandoning a fold" (owner, writer, assay, described keyed output, reader) |
| The words | `data-machine.md` vocabulary; §1 and §8 here | entity, event, grain, key, bridge, edge, fold, replay, dimension, residual, blip, chain, assay, vein |
| What is open and what closes it | §3 (C1–C28) and the dated delivery receipts | a case closes with the commit and the number |
| How the schema may grow | `lofficiel-concierge/supabase/SCHEMA_LAW.md`; `schema_proposals` (15 approved, 7 open, 4 withdrawn) | search before mint; facts are observations first; one DNA grammar; supersede, never overwrite |
| Who owns a capability or a computed field | `docs/ledger/CAPABILITY_MAP.md` (2026-07-12, verify live); `pipeline_registry` (175 rows over 51 tables) | extend the owner, never mint a parallel one |
| What runs, and whether it proves its yield | `v_job_health` (26 active of 126 jobs, 2 with an assay); `v_write_pulse` (declared and undeclared writers, 30 d); `docs/ledger/CRON_LEDGER.md` (2026-09-27 snapshot); the Mac's `~/Library/LaunchAgents/ag.nuke.*` (23 plists, not in the repo); four read-only claude.ai routines at 06:00–09:00Z | the cloud lands and folds; the Mac runs finite batches; nothing agentic stands between shifts |
| What the model lacks, per table | `v_schema_atlas`; `v_residual` (one row per live table with its `gaps` and `rank_mrows` = rows × gaps, from migration `20261006210524_v_residual_ranked_backlog.sql`, 2026-10-06; it listed the 175 islands before); `scripts/discovery/repair-backlog.sql` reads its top | described %, islands, owners, assays, ranked by rows × gaps |
| Which text columns name an entity, and how many rows would key | the Keys lane's entity-text-field memo (`~/nuke-logs/data-hygiene-20261005/C-ENTITY-TEXT-FIELDS.md`, 2026-10-06; numbers only) | BaT handles resolve 96–99.9% exact on every column; the gaps are unwritten keys, not unmatched text |
| The hypotheses | `vein_ledger` (11 veins), `vein_runs` (15 runs) | a vein is a query with its pass rule written before any counting |
| The last standing worker | `~/.claude/audit/night_shift.sh --data-machine` with `data_machine_build.prompt.txt` (Codex; hourly checkpoints 10:00–18:00 PT on 2026-10-05, 45 min cap; last run 22:00Z: 740 identity links, PR #613) | its plist has been unloaded since 2026-10-02; the headless Claude form is blocked by the local permission classifier |
| How to work here | `AGENTS.md` (the reading table, invariants, writes and deploys) | the only index to the above until this section |

### The process, as verbs

The card names the layers (what the data becomes) and the lanes (who works). The process is what happens to one row,
and its words are already in §1. Each stage has a clock, a tier that runs it, and one scoreboard query.

| Stage | Does | Clock | Runs on | Scoreboard |
|---|---|---|---|---|
| **land** | source → log: one append-only row with its source key, event time and ingest time | the species' physics (§6) | pg_cron; the Mac fleet for auth-walled sources | rows landed per day per log table against expected yield; a flat line is a defect until explained |
| **key** | every text reference → a foreign key, at insert; existing rows by bounded batch | at insert; batches under launchd | writer code and BEFORE INSERT triggers; `ag.nuke.*` batches | key fill % per reference column over the whole table |
| **describe** | COMMENT ON: meaning · unit · source · grain · which clock; a purpose per table | per repair | agents (Cartographer) | described %; live tables with no purpose |
| **shape** | a signal the source emits with no home gets one: a column, an observation kind, a child table, a dimension, through `schema_proposals` and SCHEMA_LAW. The model grows here and only here | per discovered signal | agents; the proposals curator | open proposals and their age; signals seen on a source with no home |
| **fold** | state, baselines and features from the log: incremental per event, batch per cohort; each with an owner, a writer, an assay and a reader | per event; a declared cadence per fold | pg_cron drains; triggers | queue depth and oldest queued per fold; freshness against cadence |
| **replay** | after a key or shape change, recompute the past from the log | after each such change | launchd batches | rows re-derived / rows eligible |
| **assay** | every writer proves its yield against the source; receipts; before and after with a denominator | every run | `v_job_health`, `write_receipts`, the pulse | jobs with an assay / active jobs |
| **prospect** | a hypothesis as a query on a sample; promote to a feature on signal | weekly | the Prospector lane | veins assayed; veins promoted |

The repair loop in the card is one pass of key → describe → shape → fold → replay → assay on one gap. "Standing" means
the pass runs between shifts, taking its gap from a queue the database computes.

**Coverage-reporting correction, owner 2026-10-11.** Reports emphasized a selected 500-vehicle
validation cohort without the full-lot reference. Against the owner's stated 690,000-vehicle reference,
500 is about **0.072%**; that reference is not a newly verified live census. The cohort's field gains
prove a bounded change, not whole-fleet semantic coverage or general-audience readiness. Completed
source-property work and distinct vehicles touched are separate processing measures. Apply the
fleet-relative reporting contract in `data-machine.md` to subsequent repair-loop reports. Fleet-wide
net usable coverage, eligible backlog and completion time remain unestablished by these cohort receipts;
this correction does not close C28 or authorize a new worker, source admission or capacity change.

### Correction reaches a comparison: bounded contract, 2026-10-12 UTC

The owner's objection is whether an evolving representation compounds understanding or mistakes.
Correction belongs in the development loop: retain captured observations, attributed claims,
versioned interpretations and computed conclusions; then prove the consequences of a changed
interpretation rather than treating schema growth as the result.

`nuke_frontend/src/lib/dealRead/batComps.test.ts` now connects the existing
`selectSourceSalePopulation` and `comparePriceToSourceSales` contracts across three synthetic
later contradictions: episode model identity, sold amount and sale outcome. The fixed input contains
20 sale episodes in two disjoint ten-episode model cohorts; appending a later capture produces
21 captures of the same 20 episodes. The affected matched denominator changes from ten to nine;
the synthetic candidate's percentile changes from 45 to approximately 38.89 and the median from
5,500 to 6,000 in the declared synthetic units. These are fixture results, not market measurements.

- Both captures remain inspectable with their source and qualification references. A model conflict
  withholds narrow matching but retains the independently supported sale in the broad population.
  Amount/outcome conflicts withhold the disputed sale from the qualified price population.
- The earlier knowledge cutoff excludes the later capture and reproduces the entire earlier price
  calculation. The previous input and result are unchanged; the unrelated cohort's calculation is
  identical. Reordered input and repeated evaluation produce the same revised calculation.
- This proves conflict propagation and deterministic evaluation, not admitted supersession,
  automatic conflict resolution, persistent evaluation dependencies or independently measured accuracy.
  The population selector remains a local contract, not a newly wired production valuation reader.
  Its replay proves this selector/calculator path, not historical canonical-reader reconstruction.

The focused file passes 74 tests, including the three new cases. This entry records implemented and
locally tested stages only; PR CI, merge and delivery require their own receipts. No production schema,
testimony, source, worker, evaluation policy or capacity changes are part of this increment. Net newly
usable fleet claims from this test work: zero. Fleet-wide semantic coverage remains unestablished by it.

The next acceptance case must use an existing sanctioned supersession owner, revise a supported
interpretation, prove its actual downstream consumer and reproduce the earlier evaluation receipt.
Then test a separately selected held-out case and report correction cost and regressions. The bounded
conflict assay does not close C28 or establish repeated autonomous representation development.

### What is inefficient today (measured 2026-10-06)

- **The definition was spread** over six documents, five views, one prompt file and a shift folder outside the repo;
  `AGENTS.md`'s table was the only index. The table above is now the index.
- **The queue is prose.** The next repair is chosen by a lead reading `PLAN.md` and lane memos each shift. The atlas
  computes the scoreboard, not the next item. `repair-backlog.sql` at 20:40Z: 385 live non-scratch tables; 369 with a
  describe gap, 90 with no key in or out, 66 written with no declared owner or by an undeclared writer, 3 fed by a cron
  with no assay, 8 complete. Top by rows × gaps: `vehicle_images` (52.1M rows, 103 undescribed columns, 26,332 rows
  today from an undeclared writer), `vehicle_observations` (11.2M, 33 undescribed), `auction_comments` (20.0M,
  undeclared inserts on 10-05), `field_extraction_log` (3.9M, no owner, no assay), `write_receipts` (1.4M, island, no owner).
- **One runner per lane.** 23 `ag.nuke.*` plists on the Mac, 10 created on 10-05 and 10-06, each with its own state file,
  STOP file and log; the shape is reused by copying.
- **Only the measurement half stands.** `ag.nuke.data-model-pulse` writes the scoreboard and the growth lines hourly;
  no worker runs a repair pass between shifts.
- **Intake, 20:23Z (tablesample-scaled, rows per day):** vehicles 1,350; auction_comments 13,000; vehicle_images 43,000;
  auction_events 320; bat_listings 300; listing_page_snapshots 5,580 (receipts only since 09-27). Flat: `bat_bids`
  newest row 2026-10-05 06:30Z while bid-type comments kept landing 5,000–6,700 a day. Mechanism: `extract-bat-core`
  copies a bid into `bat_bids` only when the lot already has a `bat_listings` row, and only `bat-closed-lots-sync-daily`
  writes that table; the function edge logs show no failed upsert in 24 h, so the copy is not attempted, not failing.
  `bat_bids` has no `pipeline_registry` owner. The fact is safe in the log; the copy is one of the five bid stores
  (§2.2) awaiting the owner's consolidation ruling. `receipts`, `work_sessions`: no rows in 14 days.

### The efficient form (proposal; nothing minted here)

1. **The queue lives in the database.** `v_residual` now carries the ranking (migration
   `20261006210524_v_residual_ranked_backlog.sql`, 2026-10-06): every live table by rows × gaps from the atlas, its
   `residual_kind` replaced by the `gaps` array, no second view; `repair-backlog.sql` reads its top. The Keys lane's
   match-rate probe becomes a scheduled job writing its numbers, so the key stage ranks by resolvable rows, not by an
   island flag.
2. **One runner.** The K, L and S batch runners share a shape: batch size, state file, STOP file, REST-p50 governor,
   launchd KeepAlive, idempotent resume. One parameterized script and one plist with a job list replaces the per-lane
   copies; commit the script before the first run.
3. **Key at insert, everywhere.** The writers that still store a handle without its key, from the entity-text-field
   memo: `bat_listings` buyer and seller (96–99% resolvable, 0–4 rows keyed), `auction_events` winning_bidder and
   seller_name (no key column, 99.9% and 97.9% resolvable), `vehicle_events` buyer (0 rows keyed). Junk words lifted by
   the buyer parser (be, my, interject) need a stop-word check before any key.
4. **The standing worker** takes the top unowned backlog row, runs one pass, records the delivery here and in
   `DONE.md`, and its before and after in the pulse. The Codex night-shift runner is the existing implementation; with
   the queue in the database its prompt shrinks to the row.
5. **Owner decision: how the worker runs.** (a) the existing Codex night-shift runner (ran 2026-10-05; 740 links per
   run; about 93K uncached and 4.0M cached input tokens per run); (b) a permission rule for a bounded headless Claude
   runner; (c) no agent between shifts: pg_cron lands, keys at insert and folds, and shaping waits for a shift.

**Closure.** C28 closes when the ranked backlog is a view read by the pulse and by the worker, one runner replaces the
per-lane plists, and a dated delivery row lands here from an unattended pass.

**Bounded intake visibility increment, 2026-10-10 UTC.** The owner requested implementation of
the intake-to-consumer visibility milestone. The existing `/admin/status` / `db-stats` owners now
carry three independent read-only sections; active admin membership is checked server-side using
the existing verified-caller guard, and service callers retain operator access. The legacy stats
response and database permissions are unchanged. No source activation, admission, migration or
standing worker is part of this increment.

- Coverage is `source_target_coverage`'s **known target URL → exact import_queue URL match**.
  Complete means the queue status, not verified extraction, unique vehicles or consumer delivery.
  At most 30 sources are returned; overflow withholds aggregate totals. A source's zero queue matches
  must not be interpreted as absent retained source data.
- Model scope is fourteen named atlas tables. The first live query exceeded its 5 s limit because
  selecting the atlas's 30-day writer totals required sorting about 906,793 receipt rows. The reader
  retains atlas structure/owners while selecting at most 32 recent receipts per table through the
  existing `(tbl, at DESC)` index; sample counts/writers are labeled as samples, not 30-day totals.
  A subsequent same-scope read returned 14 tables and 422 public-to-public FK edges in 1.391 s including
  transport. At most 500 edges are exposed; historical validation status remains distinct.
- Twelve named job configurations remain available independently of five named health readings.
  A scoped health read returned 5 rows in 3.045 s including transport. Successful execution, output
  assay and reported health stay separate; missing assays stay unmeasured. The initial wider
  health selection was unavailable within 5 s; the unmeasured taxonomy job retains its configuration.
- System totals cannot suppress the intake sections. A failed refresh preserves a prior section's
  original clock, and one unavailable section does not hide the others. No command, SQL error body,
  source body, contact, credential or raw assay payload is exposed by the new sections.

Acceptance lives in `scripts/test-db-stats-intake.mjs`,
`nuke_frontend/src/components/admin/IntakeReadiness.test.tsx` and the existing SystemStatus tests;
the PR validation workflow runs the reader and consumer contracts. Private timing and delivery
receipts are under `~/nuke-logs/intake-consumer-status-20261010/`. These measurements are preparation
evidence; implementation, tests, merge, deployment and browser runtime require separate receipts.
This increment does **not** close C28: worker consolidation, unattended repair delivery, semantic
source-to-consumer coverage, per-source cost/rate qualification and reader dependency discovery
remain separate work.

**Production follow-up, 2026-10-10 07:38Z.** PR #917 merged and both existing CI deployments
succeeded. The new reader refused an anonymous request with 401 and `private, no-store`. Parallel
coverage/model/jobs requests coincided with five-second coverage and health timeouts; model and
configuration still returned. Sequential probes returned 10 coverage rows in 1.197 s and all five
health rows (including configuration, 2.598 s). The signed-in page reproduced the partial reading.
The follow-up consumer change dispatches metadata, coverage and jobs one at a time, with a separate
20 s request deadline for each and cancellation of queued reads on unmount. Missing health/owner
readings remain unmeasured rather than claiming an undeclared writer or absent owner match.
Twenty-nine focused UI contracts and the existing ENFORCE/build gate pass. This is a bounded
contention mitigation; the follow-up merge, deployment and signed-in successful reading remain
separate delivery stages until recorded in the private receipt.

**Source-intake acknowledgement and observation visibility, 2026-10-12 UTC
(implementation/testing; delivery stages recorded separately).** The existing feed poller assigned
`ledger=complete` before its queue write returned. An actual-handler/installed-SDK denied-write
fixture reproduced that result; completion now requires one returned queue receipt with the exact
URL and expected status. Failed, missing or unrelated acknowledgements remain unavailable.
The existing extraction metrics helper records bounded feed-run progress in `extraction_runs`;
source work stops if progress cannot be acknowledged. Completed target processing, dispatch intent,
actual ingestion requests, unattempted targets and ledger acknowledgements remain different measures.
Interrupted runs retain their last acknowledged progress. Existing invocation ceilings, source
rotation, sanctioned intake, crons and native BaT admission controls are unchanged.

The existing `db-stats?intake=jobs` / `/admin/status` consumer reads at most50 matching runs per
worker over24hours, with overflow and unavailable readings explicit. It also consumes the existing
Facebook capture writer's `fb_sweep_jobs.metadata.results` and verifies exact listing/sighting and
linked-observation pointers; original cards, contacts, target URLs and error bodies are excluded.
Browser observation time and intake clocks remain separate. The read-only live SQL assay at
07:01:43Z found41 retained presentations in three declared captures and41 matching sightings;
all were unlinked. That is source-listing custody in the declared capture scope, not new vehicle
models, continuous availability, a source-wide denominator or public consumer usability. The full
eligible stored-record reference remains the completed632,014-record census; no repeat census or
whole-fleet canonical gain is claimed. Source-intake holds and unresolved vehicle links remain.

**Deterministic bulk model construction, 2026-10-12 UTC (implementation/testing).**
The owner explicitly rejected per-node LLM processing. The existing specification reader gains a
bounded200-ID metadata model overload (optional typed custody reads capped20) that includes every eligible requested record, including those with
no canonical claim.13 recorded primitive attributes retain their `vehicles` origin, maintenance
clocks, unassayed attribution and unknown units/configuration. A set-based record binding function maps
existing literal labels and powertrain values to11 ratified property keys, retaining source column/value,
numeric unit conversion and column disagreement without canonical promotion; unitless mileage stays unbound.11 current canonical selectors retain
property/observation keys and qualifiers. Unrequested typed claims are labeled separately from zero qualified claims. This expands a consistent data-exploration contract;
it creates no testimony and does not establish full vehicle models or full-fleet runtime verification.

The existing retained-listing owner batches up to500 source PKs in SQL and repairs already visited
native year parents for exact make/model opening-label tokens. A finite prior-work source-key walk
runs inside the original seeder; the raw cursor,120attempts/minute,2admissions, guards, source custody
and held sources remain. Model remainders may contain trim/body words and are not catalog identities.
No provider or per-record model calls occur. The existing deployment pauses and reactivates this same
job only with its matching canonical edge owner deployed.

The complete32,164-key enrolled-year-work probe found18,941 qualified native captures on2,172
stored eligible vehicles;18,671 recognized captures cover2,143 vehicles. Relative to the dated
full-model baseline, only40 make and40 model slots were absent. A complete current reread of those40 vehicles found68
of the80 slots already present, leaving12 potential additions in this declared set. These are potential missing fields,
not realized gains, complete cars or a fleet breakthrough. The full reference remains the
2026-10-11 windowed census:687,987 public rows;631,862 public, undeleted, non-nonvehicle rows;
31,311 with any type-valid canonical claim and720 with all eleven core slots. The bulk reader's
record availability must not be substituted for these evidence-coverage measures. Private source
pages, type/qualification tests and delivery stages are retained under `~/nuke-logs/retained-bulk-*`.
Merge, deployment, realized net gains and anonymous runtime remain separate until recorded.

### Model-name separation and shared alias contamination, 2026-10-18

The original Relativity example retained a source-labeled Bultaco Frontera 370 but assigned its
listing to the Pursang key. Fixing a UUID display fallback exposed rather than corrected that
interpretation. The same live alias owner assigned Cappuccino to Jimny and Hayabusa/RE-5 to GSX-R.
The historical specialist-family test explicitly expected Hayabusa to bind to GSX-R: positive
binding tests and healthy refresh jobs were not semantic identity acceptance.

The full stored-vehicle reference was an atlas estimate of 1,248,544 rows on October 18; an exact
public denominator and fleet-wide affected count were not measured. The reference-catalog assay
read 4,470 rows/22,250 aliases. Its 515 cross-name candidates include legitimate hierarchy and are
not an error count. The first repair cohort is all 1,310 retained Bultaco/Suzuki names representing
5,216 dictionary record rows, not 5,216 verified physical vehicles or newly ready public answers.

The prepared repair narrows eight existing rows and adds fourteen source-supported model names in
the existing `canonical_models` owner. Its disposable replay rebinds 542 represented rows and names
18 formerly unresolved rows; 1,899 formerly forced bindings become unresolved. All names and
make-level sale counts/dollars survive. Those figures measure dictionary classification changes,
not whole-fleet model completeness. Sources are the Barcelona Motorcycle Museum Bultaco catalogue
and Suzuki's own digital archive/history. Unknown production ranges remain unknown.

`test_model_identity_separation.sql` runs the actual matcher, market/sales folds, anonymous sales
reader and fit writer. It covers twenty-three names, unrelated Porsche controls, source retention,
generic/unassessed-name refusal, idempotence and withholding a price fit made from old membership.
The existing `refresh-market-views.py` gains a bounded dependency-ordered selection with a dry run
and stops before dependent folds after a failure. Refreshes remain concurrent; year prices use their
existing owner/planner settings. No new queue, schedule or raw testimony writer is introduced.

Delivery stages and before/after anonymous reader evidence belong in the operator receipt at
`~/nuke-logs/model-identity-repair-20261018/`; this entry records local implementation and testing,
not production completion. Remaining work includes other catalog candidate families, the differing
normalizer year/null rules and the independent 1D sale/capture admission defect. Existing GM truck
hierarchy decisions are outside this repair and remain intact.

### Year-price correction rebuild follow-up prepared, 2026-10-18

PR2074's catalog correction deployed; names, market, sales and movers rebuilt, with anonymous
Frontera/Pursang separation and unchanged source rows and two-brand count/dollar totals. The
existing year-price refresh was canceled twice when Realtime slot creation waited on its long
transaction. A later wait belonged to a separate pg_net worker; unrelated sessions were preserved.
This is an operational failure of the rebuild, not a completed year-price correction.

A read-only, one-snapshot Bultaco/Suzuki replay of the year-price query returned 716 rows on both
sides, with zero differences under EXCEPT ALL in both directions. Materializing the existing named
and conflict stages reduced cohort execution from 4,893.630ms to 1,569.982ms. The original conflict
subplan ran 825 times for each of ten aggregates; the candidate evaluates it once per eligible row.
This fixed cohort is a performance/equality assay, not full-build timing or fleet readiness.

The prepared migration creates only a private, unpopulated beside copy from the live definition,
adding those two evaluation fences and the same indexes. The populated view, public grants and
cron remain unchanged. The PG17 contract reuses the existing sold/ask, privacy, conflict, year-window,
platform-pooling, odometer and percentile fixtures and checks exact output multiplicity (excluding
only the rebuild clock). Build and reviewed rename cutover remain separate delivery stages.
The private-copy preparation subsequently deployed through PR2082. Its first full build completed
in 79.5s under the operator's 120s ceiling, producing 101,347 rows. The 716-row corrected cohort
matched the independently evaluated reference digest exactly. Frontera contributes 22 sold-year
rows with at most eight pooled prices; every row remains thin and withholds percentiles. These are
model-year aggregate rows, not physical vehicles. A separate guarded activation migration is prepared;
it preserves role privileges, retains the old populated fold privately, refuses new tracked consumers
or semantic drift, and leaves the existing refresh owner and schedule intact. Activation is not yet
claimed here; exact checked/deployed/runtime stages remain in the private receipt.
Receipts: `~/nuke-logs/model-year-refresh-20261018/`. No third unchanged refresh, Realtime access
change, capacity increase, raw testimony mutation or new recurring job is part of this repair.

### Fiat model identity and intake matching prepared, 2026-10-19 UTC

The earlier full stored-vehicle reference remains the October18 atlas estimate of1,248,544 rows;
current exact public/eligible and affected-fleet denominators are not measured. This next validation
cohort is all973 retained Fiat name rows representing4,133 dictionary record rows, not verified
physical vehicles or newly ready answers.94 name rows/367 represented records explicitly naming
nine other models were in500;850 source examples were inX1/9. Retained Panda/850 native headlines
agree with those model claims. Original source rows and physical identity uncertainty remain intact.

Two catalog rows are narrowed and ten source-supported names use the existing canonical_models
owner. References are Fiat's official history, Stellantis Heritage's1100/128/130/131/barchetta
accounts and Giugiaro's850 Spider portfolio. Fiat's history explicitly identifies Topolino as500,
so that alias is retained. Unassessed coachbuilder/generic tokens remain unresolved. In the complete
retained-name replay,594 represented records rebind, none become newly bound, and370 formerly forced
bindings become unresolved; all973 names/4,133 represented records survive. These are classification
changes, not a fleet-readiness gain. New production ranges remain unknown.

The native normalize_vehicle_model owner also ranked generic Spider above the specific850 alias
because it sorted display-name length. It treated NULL year starts as exclusion and could match130
inside1300. The prepared fix ranks the actual literal alias, preserves numeric boundaries, admits
unknown bounds while respecting explicit limits, and leaves exact-match confidence semantics intact.
GM truck, unqualified and wildcard-make lookup paths retain their prior rules. An initial generic
candidate changed K1500 Silverado toSilverado; the final scoped candidate preserves all19 controls
from the current273-row GM catalog. No GM catalog or market-family rule changes are included.
The same-corrected-catalog Fiat name-only diagnostic changes45 names/116 represented records under
the new normalizer; that diagnostic has no independent correctness or fleet-readiness interpretation.

The actual PostgreSQL contract has33 assertions, including source/count/dollar preservation,
Topolino/X1/9 controls, public Panda sales, old-fit withholding, explicit-year refusal, earlier
Bultaco/Suzuki cases, literal wildcard/numeric negatives and unchanged functionOID/owner/grants.
A real concurrent owner edit is refused before catalog writes and remains preserved. No Fiat
make_model_profiles rows were present. The prior500 fit/series is retained privately and withheld
through record_family_price_index; qualified new fitting remains separate. The legacy normalize_model
location/casing path and physical scalar backfills remain outside this patch. Delivery is prepared
and locally tested here; checked merge, CI deployment, dependent folds and anonymous runtime evidence
belong in ~/nuke-logs/model-identity-fiat-20261018/.

### Daily sold movement excludes asking captures, prepared 2026-10-19 UTC

The broader identity investigation found a second measurement error in the current
family_share_movers_build(integer,integer,text) owner: its live 1D branch unions Facebook
capture/asking rows into confirmed sold vehicle_events. The capture clock is not a sale clock,
and a classified status or asking amount supplies neither a confirmed outcome nor sale price.
A bounded current read found982 captures in48 hours, none with parsed_make, so this admission
path is presently latent; it does not establish contamination of today's displayed counts.
No fleet-wide public/eligible denominator or readiness gain is claimed.

The prepared repair removes only that union and its temporary capture load. Synthetic acceptance
first reproduces10 confirmed Ford sales plus2 asks becoming12, then proves10 sales and the exact
sold-dollar totals,11 Ford sale bins across both windows, unchanged other7 horizons, original
function identity/owner/ACL, preserved source rows and supporting Facebook supply, and unchanged
low-volume fallback. Capture recency, amount and even a classified sold label cannot change the
confirmed-sale measure. A strict whole-definition guard refuses concurrent owner edits.
Existing upcoming capture-date semantics remain a separate gap; this repair does not certify
those dates or restart held Facebook intake. Exact checked/deployed/runtime stages belong in
~/nuke-logs/model-movers-sold-20261019/.

### Lotus catch-all aliases corrected, prepared 2026-10-19 UTC

The next concrete source-to-reader failure is a retained Climax Eleven headline grouped as Seven.
The bounded population is727 retained Lotus names representing2,939 dictionary records; these are
classification inputs, not verified physical assets or a fleet-readiness denominator. Lotus's
own Seven/Eleven/2-Eleven/3-Eleven histories establish distinct model identities. Two catalog rows
are narrowed, the dedicated2-Eleven alias row's generic Elise label is corrected, and3-Eleven is
added through canonical_models. Existing340R/Elise membership remains: Lotus explicitly names the
car Elise340R. Generic engines, unrelated types and unassessed replicas are retained unresolved.
Superseded labels/aliases remain in notes; source testimony is unchanged. No saved fits or profiles
were present for the affected keys at preparation time; the existing fit writer remains the
invalidation path if any appear before deployment.

Twelve synthetic names exercise actual folds/intake with count/dollar/source preservation and
idempotent migration application. Production acceptance returns to the two exact retained source
vehicles and their public sales groups, alongside conserved Lotus totals. This is a shipped repair
only once checked merge, CI deployment, fold rebuilds and anonymous runtime checks are recorded in
~/nuke-logs/model-identity-lotus-20261019/. Other catalog candidates are not certified by this slice.

### Civic identity admission corrected, prepared 2026-10-19 UTC

The next bounded repair starts with retained City and Legend presentations incorrectly returned
as Civic. The current Civic name bucket contains195 names representing1,873 dictionary records;
these are classification inputs, not physical-asset or fleet-readiness counts. Honda's own Civic,
City and Legend histories establish their distinct model identities. The Civic reference contains
15 unrelated/generic aliases, including the single letter s. Remove those broad admissions, retain
the eight Civic aliases, add City/Legend through canonical_models, and keep unassessed names
unresolved. Source labels, bundle descriptions and superseded reference aliases remain intact.
No claim that a City/Motocompo bundle is a single physical vehicle is introduced.

Twelve actual-fold/intake cases cover City/Legend, valid Civic variants, existing Acty/S2000/Accord,
and generic or unassessed negatives. Source rows and aggregate sale counts/dollars are conserved.
One saved Civic fit is retained privately and withheld through record_family_price_index until
qualified refitting; no affected registered profile was found. Acceptance must return to the
exact retained City/Legend vehicles through the public reader after deployment and view rebuilds.
Exact stages and private receipts belong in ~/nuke-logs/model-identity-honda-civic-20261019/.

The preceding Lotus repair is now deployed and runtime-verified (PR2097). Its runtime dependency
check also found one saved composite Elise fit beyond the three directly revised catalog keys;
that fit was preserved privately and withheld through its sanctioned writer. Original specimens
from2006/2015 were checked through the public historical fold, and the chart's intentional five-year
window was checked separately. Saved-fit checks must include composite families losing members,
not only edited catalog IDs. The public535-row Lotus year-price result matched its bounded
independent reference. This closes that repair, not a full-catalog certification.

## 13. Aspiration: twenty stacks the model must be able to carry (owner, 2026-10-06)

**Owner direction, 2026-10-06 23:35Z.** "This scale is where we should be starting at every session: we are combing
through ALL the data we have and making more with it. Analysing data. Those analyses become data shapes that grow ...
sold Mustang coupes within 500 miles of x, in the last 6 months, that are red, that were spoken positively about on BaT
... geographic boundaries: which counties perform the best for a model, for flipping, to move to and work at ... all the
data has to be there in order to make the queries true on evidence." The twenty below are the lead's answer, kept here so
every session starts from them. Each is a stack of derived tables, and each names the layer that is missing today; the
missing layers are the backlog, ranked ahead of rows x gaps when they unblock several stacks at once.

**The five substrates every stack sits on.** Keys to identities, lots and places; an event clock on every episode;
cohort dimensions built from evidence (generation, body, engine, color, options); the text fold (comments and
descriptions into attributed claims); the image fold (EXIF truth, angle and zone, per-zone condition claims). The
2026-10-06 shifts repaired the key layer (comment authors, comment lots, lot winners and sellers) and part of the clock
layer (3,483 episodes corrected by supersession). The place entity, the text fold and the dimensions are next.

| # | Stack | Chain of derived tables | Missing layer today |
|---|---|---|---|
| 1 | County performance surface per model | lot rows -> seller location -> geocode -> county FIPS -> sale residual vs cohort baseline as of sale date -> per county: median residual, sell-through, days-to-sale, confidence by count | a place entity (seller_location is text; 69% matches a city-state lookup) |
| 2 | Flip ledger and arbitrage corridors | one physical vehicle across platforms and time (VIN or chassis chain, lot entity) -> buy event, sell event, hold days, spread, fees -> corridors by model and season (bought in county A on platform P, sold in county B on platform Q) | cross-platform identity for short chassis numbers; ownership_transfers keyed to lots |
| 3 | Bidder record as of a date (the card's feature) | per identity: lots bid, win rate, max bid vs hammer, lateness relative to close, cohorts chased, counties bought from -> live-lot feature: probability the reserve is met given who is bidding now | bid frames tied to identities at second precision (the bat_bids copy stopped 2026-10-05) |
| 4 | Seller trust and its price | seller identity -> prior lots: sell-through, reserve-not-met rate, relist rate, post-sale disputes in comments -> trust score as of date -> realized premium or discount | comment sentiment per lot (queue with no reader); relist detection through the lot entity |
| 5 | Crowd disclosure gap | comments -> topic and stance per comment -> per lot at close: what the crowd flagged that the seller did not state -> price residual explanation; per seller: how often caught | the text fold (analysis queue stuck) |
| 6 | Cohort-relative condition from photos | images -> EXIF truth -> angle and zone -> per-zone condition claims -> position on the cohort's distribution -> price effect per zone; effect of photo coverage itself | a zone dimension keyed from image appearances; vision gate producing claims |
| 7 | Hidden-defect prior | model failure modes by age and mileage (dimension from recalls, forums, receipts) x this vehicle's repair evidence -> latent-failure probability -> priced pre-purchase inspection list | receipts and work keyed to a parts and labor taxonomy (receipts intake landed 0 rows in 14 days) |
| 8 | Odometer honesty | every mileage observation with observed_at across sources -> monotonicity violations, rollovers, TMU statements -> trust downgrade per observation and seller | odometer as a uniform observation kind with a clock on every source |
| 9 | Shill and ring detection | bidder graph (who bids against whom, increments, timing, repeat under-bidders on one seller's lots, account age) -> anomaly score per lot -> integrity feature on every price | identity graph edges (bidder, lot, seller); account age from profile reads |
| 10 | Liquidity surface | per cohort and county: listings -> outcomes -> survival curve of days-to-sale by price-to-estimate ratio, platform, season -> list at X to sell in N days with p% | dense event clocks on every episode |
| 11 | Buyer migration maps | winners' locations vs sellers' locations per cohort -> where the money for a model lives and how far it travels -> which platform reaches which region | identity location (328 identities carry a city; infer from comments, shipping, purchases) |
| 12 | Dimensions as evidence, not lists | generation, body style, engine, paint code and color family from VIN decodes, text and images with sources -> the owner's example query becomes four keyed filters and a clock, with a denominator | color normalization (paint codes), body-style and option keys |
| 13 | Where to set up shop | supply density by cohort and county x demand (bids, watchers, app searches) x realized flip margin (2) x buyer proximity (11) x shop and storage cost -> relocation score per county | demand signals keyed to episodes; a cost-of-operating dimension; non-BaT intake re-enabled (102 of 126 jobs paused) |
| 14 | Option and color premiums | decoded options (RPO, build sheets) and normalized color -> hedonic regression per cohort as of date -> premium per option with confidence -> what to spec on a build | options as a keyed dimension |
| 15 | Build ROI | the owner's parts carts, receipts and labor sessions keyed to the vehicle and a parts taxonomy -> cost basis over time vs the cohort surface and (14) -> ROI per decision | receipts and work_sessions intake; a modifications dimension |
| 16 | Provenance depth and exposure history | transfers, title and registration observations, auction history -> chain length and gaps, collection provenance from text, state history -> rust-belt exposure prior, provenance premium | transfers keyed to lots and identities; a state-history dimension from dated locations |
| 17 | Shop and dealer performance | organizations -> vehicles they touched -> outcomes afterwards (residual, later defect reports) -> which restorations hold value, inventory turn, consignment realization | organization keys on events and receipts (two FK columns point at tables archived 2026-01-29) |
| 18 | Seasonality and macro per cohort | dated residuals -> seasonal decomposition, auction-calendar effects, rate and macro covariates -> monthly forecast index per cohort | dense dated sales; market_index_values beyond BaT live bids |
| 19 | Claims ledger from text | every description and comment sentence -> attributed claim with the author's trust -> per-vehicle fact table with two-layer confidence -> "seller claimed numbers-matching and a trusted commenter disputed it" | a claims table (shape decision); the text fold |
| 20 | The machine's own health as data | every writer's yield, fold freshness and key fill as time series -> which pipeline rots next; repair ranked by downstream readers and features | snapshots of v_job_health and v_residual over time; a reader-dependency graph |

**How this changes the queue.** `v_residual` ranks by rows x gaps (section 12). A missing layer that unblocks several
stacks outranks a large table with a describe gap: the place entity (1, 11, 13, 16), the text fold (4, 5, 19), the
dimensions (12, 14), the clocks (10, 18), the image zone dimension (6). Each shift picks its first item from this table,
then from the view.

### 13.1 The owner on what a stack is (2026-10-07 00:05Z, captured verbatim in substance)

"A stack is actually a great thing we could call a page. For me that already becomes a method of exploration that would
be represented in a tab on the header. We want to teach people how to explore data, and it's useful for ourselves anyway:
these are endless cams to drill and drill and drill into. We start becoming some kind of design language for SQL; it's
almost what's missing for SQL, for data model design. And we get to prove the statistics of what we would consider
positives and negatives, what makes a performance positive versus negative, because there are so many different weights,
so many ways to calculate positive. There are so many ways for change to add up to a dollar. If a vehicle has 10,000 points
where you measure positive and negative, with weights affected by the data and also by the lack of data: we know how much
we don't know, we can often calculate how much we don't know, and then wait for that data to show up. We don't have to
operate in total ignorance. We know roughly how many cars are sold in the United States, and this is how many we have.
There are places where we can collect data; we just don't know what they are and how much it costs to unlock them, but if
our system is set up properly it's just a matter of eventually plugging in other data sources. I like discussing these
stacks and seeing how close we are to actually showing them, because stacks could develop into an investment-grade
opportunity: a product where people can invest in the marketplace of actions rather than the core object itself, another
way to support something they believe in. They don't have to believe in the direct owners; they believe in the movement
and can financially participate in it."

**What this adds to the model (lead's reading, for the next shape decisions, none minted yet):**
1. **A stack is a page.** Each of the twenty is a named, versioned definition (its spine query, its dimensions, its
   denominators) that the app can render as a tab and a reader can drill through. The definition is data: a stack
   registry row, not a hand-written page. Readers of a stack cite the stack version they read.
2. **Positives and negatives are named metrics with weights, as data.** A vehicle's "10,000 points" is a metric
   catalog (each point: its source observation kind, its direction, its weight, who set the weight and when) and a
   weighting is a versioned row, so two weightings of the same evidence can be compared and the statistics of each
   can be proved against outcomes. This is the two-layer confidence rule (record vs design) made into tables.
3. **Ignorance is measured, not assumed.** Every stack carries its denominators: the universe it claims to describe
   (US sales of a cohort per year, from outside estimates), the share Nuke holds, the share that is keyed and dated,
   and the sources that would close the gap with their cost. A number without its coverage is not shown (the
   "no count without a denominator" rule); a stack whose coverage is thin says so and waits for the source.
4. **Sources are pluggable.** A new source lands into the same five substrates (keys, clocks, dimensions, text fold,
   image fold) and the stacks above it move without redesign. That is the test of "set up properly".
5. **Stacks as theses.** A stack with a stated expectation and a measured coverage is something a person can back
   without owning a car: the marketplace of actions. Product and legal shape are the owner's; the data shape is the
   same registry plus an outcome ledger per stack version.

### 13.2 The stack grammar, four stacks built through every layer, and forty more (lead, 2026-10-07 00:30Z)

**Owner, 2026-10-07:** "that's barely scratching it ... how do we get to these is the next issue, and how do we make
this more of our product ... not a classified, not pretty pictures of cars ... make it comprehensible in the design
system ... a local agent could be spinning these up for free and measuring them."

**The grammar.** A stack is a path through nine typed layers; each layer is a table with a declared grain, key and
clock, plus two columns every layer carries: `coverage` (how much of its universe it holds) and `provenance` (which
layer version it read).

| Layer | Holds | Grain and clock |
|---|---|---|
| Log | append-only source rows | one source event; event clock and ingest clock |
| Key | every text reference as a foreign key | one row; set at insert, backfilled by bounded batch |
| Dimension | taxonomies built from evidence (generation, body, engine, color, options, place, platform, part, failure mode) | one member; versioned |
| Fold | state and aggregates per entity, replayable from the log | one entity; declared cadence |
| Baseline | the expected value of a measure for a cohort as of a time | one cohort × time |
| Residual | observed minus baseline, with the baseline version | one entity × time |
| Feature | a residual or fold indexed by entity and as-of time | one entity × as-of |
| Prediction | a feature set + model version + horizon | one entity × as-of × horizon |
| Outcome | what happened, joined back by key and clock | one entity × event clock |

A page is a rendering of one path. A thesis is a prediction row waiting for its outcome row. A stack's coverage is the
product of its layers' coverages, shown first on every page: no number without its denominator.

**Four stacks built all the way down.**

*A. The auction as an order book.* Log: every bid comment is a timed quote; a stated "I'd pay X" is a reservation price;
"too rich" is a refusal. Key: bid → identity, bid → lot (done 2026-10-06). Dimension: comment stance (bid, reservation,
refusal, question) from the text fold. Fold: per lot per minute, the implied demand curve (identities revealing a price
≥ P). Baseline: the cohort's curve shape at the same minutes-to-close. Residual: this lot's curve against its cohort
(thin at the top is visible 12 h before close). Feature: slope, depth, top-two gap as of each minute. Prediction: hammer
distribution and P(reserve met), intervals calibrated on every past lot. Outcome: the hammer. Coverage: lots with full
frame history / all lots; comments keyed / all comments. Page: the live curve against its cohort. Thesis: "clears above
estimate", backable before close, scored at close. Needs: bid frames at second precision (the bat_bids copy).

*B. The car as a bond.* Value = present value of use (miles/year × cohort enjoyment proxy), maintenance (receipts
cadence × parts price index × hidden-defect prior) and residual (cohort price path). Log: odometer observations,
receipts, work sessions. Key: vehicle, part, shop. Dimension: parts taxonomy, failure modes. Fold: miles/year and
spend/mile per vehicle. Baseline: cohort medians. Residual: maintained above or below cohort. Prediction: total cost
of ownership and residual at 1, 3, 5 years per county (tax, emissions, climate). Outcome: later sales and receipts.
Coverage today: receipts intake landed 0 rows in 14 days; the stack reports its emptiness and the sources with cost.

*C. Liquidity as an option.* Log: listing open and close clocks. Key: lot, venue, place. Dimension: cohort. Fold: per
cohort × venue, the survival curve of time-to-sale by price-to-baseline ratio. Baseline: the cohort median curve.
Residual: per county and season. Feature: N-day sell probability at a discount. Prediction: the discount that sells in
14 days, with intervals. Outcome: realized sales. The option value is the gap between the 14-day price and the patient
price; a widening option value is a nervous cohort, weeks before prices move. Needs: dense clocks on every episode.

*D. Ownership as flow.* Log: dated locations from listings, titles, transfers. Key: place. Fold: county→county transfer
matrix per cohort per quarter. Baseline: a gravity model (population, income, distance, climate). Residual: corridors
above gravity. Feature: net inflow per county per cohort. Prediction: where supply thins next quarter. Outcome: the
quarter's sales. The first stack whose primary page is a map; it is also "where to set up shop" with a time axis.

**What the stacks make that the car cannot.** (1) Evidence futures: a prediction row has a known uncertainty and the
value-of-information table prices which single observation would collapse it most; someone can pay for that observation
and be paid back in resolution: a market for information about assets. (2) Outcome ledgers make every stack a track
record; a thesis with a scored history is an instrument, and its holders are the movement, not the owners. Data shape:
a stack registry, a prediction table, an outcome table, a coverage table; the hard part is the keyed, clocked layers
beneath, which is the repair loop's work.

**Forty more, each with the layer it needs.**
Market microstructure: 21 bid hazard model (bid frames at second precision); 22 snipe cascades and rivalry pairs
(extension chains from frames); 23 reserve inference (outcome clocks); 24 demand nowcast with calibrated intervals
(watcher counts as a time series); 25 attention saturation (platform entity, every venue's close clocks); 26 catalogue
position effects (lot order per auction event).
Physics of the asset: 27 corrosion exposure prior (state history, zone dimension, climate dimension); 28 use profile
from odometer curves (uniform odometer observations, receipts); 29 survival by production (production dimension,
cross-source VIN identity); 30 factory batch effects (VIN → build sequence, option keys); 31 modification recipes and
outcomes (parts/labor taxonomy, modifications dimension); 32 documentation premium (image fold → document kinds); 33
title brand arbitrage (title observations with clocks, image fold).
Information and attention: 34 information half-life (relist chains, text fold); 35 disclosure drift (description
observations per listing); 36 expertise graph (text fold, author keys); 37 photographer fingerprints and image reuse
(EXIF, dhash on every image); 38 event impact studies (dense dated sales); 39 inconsistency graphs (odometer OCR,
receipts).
Geography, logistics, tax: 40 delivered-price surface (place entity, buyer location); 41 tax and rule geography
(jurisdiction dimension); 42 regional taste maps (dimensions + place); 43 demographic overlays (Census dimension); 44
cohort migration (state history); 45 service capacity market (work_sessions intake, organization keys).
People and reputation: 46 unified dealer entity (cross-platform identity, platform entity); 47 dealer markdown curves
(price observations as time series); 48 tenure mix as stability (transfers with clocks); 49 venue integrity index (9, 5,
23); 50 restorer lineage (organization keys on work, long clocks).
Economics and finance: 51 rate and fuel betas (dense dated sales, macro series); 52 carry-adjusted returns (2 +
cost-of-carry dimension); 53 guide lag (licensed guide dimension); 54 portfolio construction (10, 18, 51); 55 parts price
indices (parts taxonomy, receipts intake).
Counterfactuals: 56 venue design replays (21); 57 feature attribution by matched siblings (12, 30); 58 what-if pricing for
one VIN (10, 21, 24, 31).
The machine's economics: 59 value of information (20 + the price model); 60 trust calibration (outcomes vs claims).

**How we get there (the owner's "next issue").** (1) The registry as data: extend `vein_ledger` (a hypothesis as a
query with a pass rule) or a child of it, through SCHEMA_LAW, seeded with these 60, with a coverage function from the
atlas and pipeline_registry so "how close are we" is a number per stack refreshed by the pulse. (2) A local generator:
Odysseus (Qwen 3.5 9B, free) proposes stacks nightly in a strict JSON shape; each is measured against the atlas and
lands as `proposed`; Claude reviews the top by coverage. (3) The first stack as a page: Stack A on one live BaT lot,
rendered from its registry row in the design system, coverage block first, every layer drillable.

### 13.3 The owner on the glue: relation-weighted claims, the generated questionnaire, pursuit, user stacks (2026-10-07 00:40Z)

**Owner direction (substance kept, lightly trimmed):** "A very valuable thing would be an in-depth and very simple
questionnaire to help people provide data on vehicles. If somebody asks me about a vehicle and shows me pictures I can
give and confirm so much information; if the conversation is fast and simple and changes the vehicle's profile, people
feel that giving information to a vehicle is value. That data has to be processed in relation to the weights of the user
making the statements: an actual owner's statements are far more valuable, especially citing information from during
the ownership. That is how we always tried to structure it; we had a hard time facilitating the transfer from the source
to the database and having the database handle it correctly; people commenting is the stupid version. I guarantee BaT
comments already hold people claiming they owned a car at a certain date: find those examples, block that time out, and
pursue it. That becomes an AI's pursuit: an agent collects the information, a thread of text, then photos or access
('when were these photos taken; can I look at your photos to find them'). The transfer becomes palpable and trustworthy
as a string of thought rather than slamming people with permissions at login. It builds their identity on the system:
user data stacks, helping a user become more valuable. My own profile, with thousands of images, is incoherent because
it is not held together with the right glue. The data model is the glue."

**Model reading (lead; shape decisions through SCHEMA_LAW, none minted here):**
1. **A claim is an observation with a relation.** The testimony table already exists (`vehicle_observations`: source,
   method, observed_at, trust). A claim is an observation kind whose structured data carries the statement, the asserted
   window, and the speaker's relation to the vehicle as of that window: owner, prior owner, shop, bidder, observer.
2. **Relation is a fold, not a free text.** identity × vehicle × window, derived from `ownership_transfers`, lots won,
   shop work, and the claims themselves (a claim of ownership is provisional until corroborated).
3. **Weight = relation × calibration.** The speaker's record: how their earlier claims resolved. Owner-during-window
   with a dated receipt outranks a bystander's recollection. This is the record layer of two-layer confidence.
4. **The questionnaire is generated.** For one vehicle, the questions are its missing layers ordered by value of
   information (stack 59); each answer lands as an observation with its source; the page changes while the person
   watches. The CLI is the first door.
5. **Pursuit is an agent task with the owner's send-gate.** Detection (claims in 20M comments) → provisional window on
   the ownership timeline → outreach draft → thread → dated photos (EXIF) → observations. Agents draft and never send
   (owner rule); the person opts in through a flow they start, or the owner sends.
6. **User stacks.** A profile is the fold of a person's claims, evidence, vehicles over time and calibration. The first
   user stack to build is the owner's own.

**Test cases the owner predicted:** ownership claims already present in BaT comments. Measure first (count, parseable
windows, examples by id), then shape, then the pursuit flow.

**Owner refinement, 2026-10-07: the garage starts in the app's image library.** Existing user albums, when
available, are the first human organization pass. Preserve their exact names, folder context and image memberships;
the autonomous pass analyzes the source images, confirms supported matches within those groups and organizes
unalbumed images. Include already-assigned images in that pass. Preserve the grouping and the agent's findings as
separate sourced, dated records; a disagreement does not erase the user's pass. An album's existence does not establish
who created it, one physical vehicle per album, ownership or performed work. Same-model vehicles stay distinct until
identity is supported; one resolved vehicle can carry several dated ownership, work and documentation relationships.

The existing owners are `LibraryStore`, `LibraryIngest` and `LocalStore` on device, and `album_sync_map`, `image_sets`,
`image_set_members`, the image spine and observation/relationship writers in the database. Local metadata and analysis
must survive reopening offline. Declare accessible-library coverage (limited Photos access cannot expose user albums),
unread images, source/method versions and unresolved vehicle/role matches. Cached analysis may be reused when its source
and method still qualify. An image's existing `vehicle_id` is context, not an independent confirmation of itself.
This direction authorizes the app-first workflow; it does not lift separate canonical-write, privacy or paid-intake holds.

**Owner correction, 2026-10-18: resolving the subject is the machine's job.** Asking the photographer
which existing profile a car belongs to, or whether it is new, hands back the operation's central task.
The machine must investigate retained evidence before asking for facts it can derive. Manual selection
is a correction tool, not the default identity engine. Apply this contract to the existing image,
album, observation and profile owners:

1. Separate photo bytes, a depicted physical subject, its possible record matches, its attributed
   specifications and the photographer's relationship. An unknown year or VIN does not make a
   well-supported subject disappear. Photographing a car does not establish ownership.
2. Read each photo independently, including already-filed photos. Use albums, time, place, labels
   and visual similarity for retrieval. Establish membership with visible correspondences across
   views; keep generic parts unresolved when there is no supported chain to an identifying view.
   A day at a shop can contain several cars. An existing attachment cannot confirm itself.
3. Compare to retained historical evidence, following merge terminals and source lineage. Search
   beyond the make on a possibly wrong current profile. Keep candidate population, truncation,
   exclusions and absent references with the decision. A profile cover can itself be misfiled.
   An unrecognized model response must never silently choose the first candidate.
4. Carry a supported but unmatched subject forward through the existing unresolved cluster owner
   (`emergent_vehicle_clusters`, linked observations), then the existing private profile writer when
   admission is supported. Keep unknown specifications unknown. "No match among these references"
   does not prove global novelty; do not mint duplicate chassis records to conceal incomplete search.
   Current `device_create_vehicle_profile` admits VIN/serial/album evidence only: visual-subject
   admission, qualified byte custody and its consumer are still missing, not delivered by this contract.
5. Select the next discriminating evidence from accessible retained images before asking the user:
   identifier views, body/part correspondences, historical states and contradictory candidates.
   Retain source IDs/hashes, source and reading clocks, method/model, agreements and contradictions.
   Numeric model confidence alone is not calibrated physical identity. Revise earlier interpretations
   through the sanctioned supersession/attribution path and recheck the actual gallery/profile reader.

Acceptance must include a mixed-car day, a new subject without a VIN, competing same-model cars,
a contaminated reference cover, a generic part close-up and a later discriminating observation.
Measure subject grouping, existing-record retrieval, admitted attribution and actual consumer delivery
separately; an honest unresolved result passes refusal but does not count as resolved. Versioned
comparison receipts and parser tests are a bounded repair, not proof of autonomous filing accuracy.
Live atlas inspection on 2026-10-18 found the existing cluster store idle (1,597 estimated rows,
last inspected samples dated May); its existence is not an operating subject-resolution pipeline.

### 13.4 The owner on the API, the name and the calculations (2026-10-07)

**Owner direction (substance kept):** an API is "a definitive opportunity" and "the standard we need".
API and MCP connectors are things Nuke will offer. On the name: "I feel like we're using data model as a
technology; we're actually using it as a machine more than just data." The lead is the entity, not the
vehicle: "in order to track a vehicle, look at all the other shit we actually have to do." On AI: the
stacks "answer questions that are real", and the calculations "have to be done somehow, otherwise they
never exist"; an LLM cannot do them from language alone.

**Lead's reading (no shape minted):**
1. **The name is already in this file: a data machine.** The model is the shape, and the machine is the
   shape plus the folds, baselines, residuals and predictions that keep running over it. The README leads
   this way from 2026-10-07.
2. **The API is the machine's natural door, and a stack version is its unit.** One reader per stack version
   (entity, as-of) returns its layers with the coverage block first. The MCP connector and the CLI call the
   same reader. A new endpoint per question is the anti-pattern.
3. **What exists, probed 2026-10-07:** 18 `api-v1-*` edge functions are deployed. Without a key, 16 answer
   at once (12 with 401, 2 with 400, 1 with 405, and `api-v1-agent-register` with 200), and `api-v1-search`
   and `api-v1-vehicles` gave no answer within 15 s. `mcp-connector` answers at `nuke.ag/mcp` (200).
   `middleware.ts` serves `/api/v1/vehicle/{id}` with no key and CORS `*`, reading with the service-role
   key (same fields as the anon key on the probed vehicle, but past any masking the database adds later).
   The work is to put stack readers behind the existing key system (`api-keys-manage`), not to build a
   second API.
4. **Why a model can't skip the machine:** a stack number is arithmetic over keyed, clocked rows
   (157K BaT lots and 19.9M comments by the 2026-10-06 planner estimates), point-in-time. A language model trained on today's web has leakage by
   construction: it can't say what was known two hours before a close. Its place in the machine is the text
   fold (comments into attributed claims) and stack generation (13.2), measured by the atlas. The
   calculations and the retained, replayable log are the part it can't produce.

### 13.5 The text fold as it stands, and the first stance dimension (lead, 2026-10-07 02:30Z)

Six stacks wait on the text fold (`stack_needs`, latest versions, 2026-10-07): S04, S05, S19, S34 and S36 need the
`text fold` substrate, SA needs `comment stance dimension`, S04 also `comment sentiment per lot`. The claims layer of
§13.3 weighs speakers by their record, which is a text fold too. None of these substrates has a declared table.

**What exists (read live, `v_schema_atlas`, `pg_stats`, column comments, 02:28Z).**

| Object | Rows / fill | State |
|---|---|---|
| `auction_comments` | 19,978,200 rows, 56 of 56 columns described | the log; written daily |
| `auction_comments.comment_type` | fill 1.00, 5 values in use (CHECK: bid, sold, question, answer, observation, seller_update, seller_response, expert_opinion) | the builder's kind, the only full-coverage dimension |
| `auction_comments.has_question` | fill 1.00 | a question mark, derived |
| `auction_comments.sentiment`, `sentiment_score`, `key_claims`, `analyzed_at` | fill 0.111 | `analyze-auction-comments`, deleted 2026-03-09 (5741560ae); scored 2026-01-20 to 2026-03-06 |
| `auction_comments.question_primary_l1/l2`, `question_classified_at`, `question_classify_method` | fill 0.074 / 0.092 | `scripts/question-classify-bulk.mjs` regex_v1, 2026-03-27 to 2026-04-13 |
| `auction_comments.community_stance_score`, `stance_scored_at`, `stance_model`, `extracted_claims` | fill 0.0001 | BYOK rubric v2, on demand |
| `comment_persona_signals` → `author_personas` | 224,369 rows → 363 | tone, expertise, style per comment; read-only, no writer in 30 days |
| `comment_discoveries` | 133,445 | raw LLM analysis (sentiment and trends); read-only |
| `vehicle_sentiment` | 127,348 | per-vehicle fold, last 2026-02-07; read-only |
| `sentiment_update_queue` | 18,839 | trigger-fed (`trg_queue_sentiment_update`), written, **no reader** |
| `comment_claims_progress` | 22,285 | which comments the claim refinery has seen (0.11% of the log) |
| `_shared/commentRefinery.ts` | code | comment → claim_triage (regex) → extract_claims (LLM) → field_evidence / vehicle_observations / comment_discoveries / comment_library_extractions; categories A specs, B condition, C provenance, D market signals, E library, Q questions; `statement_kind` assertion/question; `epistemic_status` asserted/uncertain/unknown/refused |

Case 8 above already names the organs frozen (sentiment 2026-03-06 at 11.5%, question classification 2026-04-14 at
8.7%, stance 0%, 15 of 16 analysis crons inactive). The shape is there; the writers stopped, and each one wrote its
result as more columns on the 20M-row log.

**The first stance dimension, v1 (the plan, not yet built).** The order book (stack A) and the claims layer need, per
comment: *bid* (typed already), *question* (typed or `has_question`), *reservation* (a stated price or a willingness,
"I'd go to X", "worth X all day"), *refusal* ("not at this price", "no sale here"), else *observation*. Rules first:
the refinery's regex triage covers all 20M rows for free and is measured against denominators (share per class, per
platform and year); the free local model (`scripts/stacks` shows it runs at 16 to 17 tokens per second) grades a
stratified sample to calibrate the rules, never the whole log. The dimension is a **declared table for the
`comment stance dimension` substrate** (one row per comment: stance, method, version, scored_at), not a seventh set of
columns on `auction_comments`: it keys the comment, carries its method and clock, is re-runnable by version, and
declaring it moves every stack that names the substrate with no new stack version (13.1 point 4). The frozen columns
stay as the record of the earlier organs. Coverage is the number the registry reports once the table is declared.

**Measured 2026-10-07 (stance lane; `docs/features/stance-fold/SPEC.md`).** On a 200,836-row ctid sample of the log, the
fields already on the row settle 48.0% (bid 34.8%, question mark 13.0%). Twelve candidate regexes for reservation and
refusal fire on 0.62% of non-bid comments. Nine are worth shipping: they label 0.17% reservation and 0.23% refusal of
non-bid comments (about 22,000 and 30,000 comments of the 20M), at 67% and 73% precision read by the author agent and 58%
to 72% agreement with the local model on the rule classes. 79.5% of non-bid comments stay `observation`, and the rules
miss most stance statements (recall near 19%, interval 8% to 54%, from three clear misses in 200 residual rows). One rule
pass costs 9.8 s of server time per 100K rows (33 minutes of one backend for the whole log, about a second a night), and
the table would be 2.65 GB at 20M rows. Declaring it moves SA from 8 to 9 of 16 needs and no `text fold` stack, and the
registry reports presence, not the share covered. The three decisions before the build (dense or sparse, where soft
valuations live, the precision floor) are in §9 of the spec.

### 13.6 The owner on the outside read, observation, the two-minute window and the physical shape (2026-10-07, in substance)

**Owner direction (substance kept).** He asked a model whether the project could get seed funding (NSF SBIR) and it
dismissed the project the way a smart stranger without time to inspect would. He agrees the outside read is fair: from
outside "it looks stupid and annoying", from inside "I'm touching something incredible, very streamlined and very
usable" that "just needs financial support". The question: how does the project take shape so it fits what funders look
for, and what is the outside reader looking at that makes it uninteresting. The physical expansion he sees: live-streamed
garage sessions; the software becomes "the software for financial interaction and documentation, so it has this whole
accounting system, because that's how you do it"; image analysis and the user data structure are "completely passive".
On what it is: "it's really just a database. It's a data model. I like that wording." On models: "how do LLMs compete
with just factual documentation? They literally cannot exist in the same reality"; "do LLMs tell the future or not is
maybe a key point"; observation is the important thing; "being able to process data as fast as possible helps you
predict what to do in the next second". On auctions: "a very interesting point in time to act within, like bumper cars,
you have two minutes to make a decision"; "crazy calculations and actually win, because you are arbitrating the moment
where you could own something or not."

**Lead's reading (nothing minted; one positioning doc revised, `docs/POSITIONING.md`):**

1. **What the outside reader saw.** Not the machine. The model that dismissed the project read two words of a
   description ("vehicle data ledger", still the first sentence of `AGENTS.md`) and never opened the README. A
   reviewer screening pitches does the same. The repo also carried three one-liners from three eras: `VISION.md`
   (2026-02-05: "makes every collector vehicle in the world liquid", ETFs, derivatives, vaults), the positioning note
   (2026-02-08: "vertical data + applied AI", "bots that hire humans") and the README (2026-10-06: a data machine,
   nine layers, stacks). A reader without time takes the loudest, and the loudest was the least evidenced. A smart
   reader prices the ratio of claim to checkable evidence, not the idea. The repair is one voice, and a description
   that carries a measured number wherever it travels.
2. **Measured results exist, and they are modest, which is the asset.** Read on prod 2026-10-07:
   - `prediction_accuracy` (corrected 03:50Z, see 13.8: its unit is hourly rows, not lots): hammer model v13, 208
     rows on 2 lots, median abs error 48.2%; v24, 399 rows on 7 lots, 33.2% by row and 23.5% per lot (last
     prediction before close), 1 lot within 10%. `hammer_predictions` holds 50,534 rows: v24 predicted 4,612 lots
     from 2026-02-19 and v31 2,314 more from 2026-09-27; ten lots were ever graded. The cause named in ask-nuke
     THEORY.md (condition and configuration in images and comments, not fields) is a hypothesis from those cases,
     not a measured decomposition.
   - The band tag backtest (coverage audit of 2026-09-30, §5): 69,295 sold BaT lots, 2024-09-01 to 2026-09-27, each
     priced only from earlier sales, bid as of 24 h before close: cold 11.3%, in line 40.9%, hot 86.8% finished
     above their band middle (48 h: 13.2 / 40.3 / 82.9%).
   - The stack registry (`v_stacks`, measured 03:11Z): 64 stacks, 5 at or above 0.9 coverage (S03 bidder record as
     of a date, S21 bid hazard model, S47 dealer markdown curves, S48 tenure mix, S56 venue design replays), mean
     coverage 0.12. SA v2, the auction as an order book, at 0.50: 8 of 16 needs present, 2 partial, 6 missing and
     named.
   - V012 discovery: 68,957 distinct BaT buyers; the top 1% took 14% of lots; 39 buyers won 50 or more.

   Ten graded lots are not a calibration record (corrected 03:50Z). They prove the grading machinery exists and
   that the outcome join never ran; the large-n graded result is the band backtest. What a stranger can check in an
   afternoon is the unit and the denominator, so both now travel with every number (13.8).
3. **The research claim, as R&D rather than engineering.** Can point-in-time state, estimated from heterogeneous
   untrusted observations (images, comments, receipts, bids) that each keep their source, clock and relation to the
   asset, predict a clearing price with a graded per-lot error at n ≥ 1,000, lower it, and keep correcting it inside
   the two-minute closing window (corrected and extended 03:50Z, 13.8)? The unproven parts: (a) condition and configuration extraction from images and text at the accuracy the
   error demands; (b) relation-weighted claim credibility (who said it, their relation to the lot at the time, how
   their earlier claims resolved; 13.3), which has no measured instance yet; (c) leakage-free replay over 19.9M
   comments and 4.27M bids (README planner estimates, 2026-10-06), the invariant most market-data products violate.
   Grading: median abs % error against the cohort baseline on a held-out last month, in the same
   `prediction_accuracy` table, by price tier. Generality: any asset class whose record is fragmented public
   observation (equipment, aircraft, property, art). Vehicles are the testbed because they are the largest public
   corpus with timed bids.
4. **Observation versus generation, in the form that survives a smart reader.** "They cannot exist in the same
   reality" is the strong form, and it loses the room because the reply is "the model reads your ledger." The
   defensible form is already here (13.4 point 4) and in `docs/content/thesis-aperture-of-llm-control.md`: a model
   trained on today's web has leakage by construction and cannot say what was known two hours before a close; its
   place is as an observer whose outputs land as claims with provenance (the text fold, the vision gate), never as the
   source of a number. A model is a sensor; the ledger is the instrument; the calculations and the retained,
   replayable log are what the model cannot produce. "Do LLMs tell the future" then has a precise answer: not about a
   specific asset at a specific moment, because that future is a fold over observations the model has not seen. Said
   this way the point reads as method, not as a flag.
5. **The two-minute window is the forcing function, not a feature.** BaT's soft close moves the close to bid time + 2
   minutes; 322 of 400 settled lots extended (§4). The decision moment is the chain, so everything the system knows
   about a lot must be folded before the chain starts. That is why the architecture is a fold over a log and not a
   query at decision time, and why "predict what to do in the next second" is a property of the layers, not of a
   model. SA's missing substrates (comment stance dimension, order-book fold per lot per minute, cohort demand curve by
   minutes to close, residual snapshots, outcome ledger) are the work plan, already written as a backlog.
6. **The physical shape is a set of sources, and it comes after the instrument.** Live-streamed garage sessions are
   observations with the richest provenance available: a camera on the work, the receipt, the person doing it, all
   clocked. The accounting system is money as one more observation layer on the same entities (§9 already frames
   investment, maintenance and repair as evidenced interventions). Passive capture is the vision gate and the photo
   sync. All three land in the same substrates (13.1 point 4). To a funder they are the market and the company, not
   the innovation. Lead with the instrument; the garage is where the instrument gets its best data.
7. **One voice.** The README is the description. `docs/POSITIONING.md` says it to a reviewer, an investor and a
   mechanic, with the evidence table, the research question and what loses the room. `VISION.md` keeps the long-range
   direction under a dated header that points at the operating description. The one-line descriptions that agents read
   first (`AGENTS.md`, the owner's private instructions) are the owner's to change; the recommendation is the README's
   first sentence.

### 13.7 The owner on the CLI auction coach (2026-10-07)

**Owner direction (substance kept).** The simplest product demo is in the `nuke` CLI: "you just drop the URL to the
auction and it spins and tells you what to do", "the modern sniper bidding, and it can coach you". "We want our own
model to help with that decision-making." Then connectors and MCP, then the website: "the core machinery of that is the
same; if we get it working in CLI it works everywhere else." On how to talk about it: storing data goes without saying
("everybody knows we're already storing all the data"); talk about what the model does: "we have the best data model for
predictions, we are the prediction model." Later the same night he rejected "Built to predict" as the README
heading ("cringe": everyone claims prediction). The README states the measured live-auction result plainly instead.

**Lead's reading (nothing minted):**
1. **The verb:** `nuke lot <bat-url> [--watch] [--max N]`. Run once, it prints the read. With `--watch` it re-reads on a
   cadence that tightens toward the close (every 60 s, then every 5 s in the last 3 minutes). At the hammer it prints
   the outcome against the forecast, so every coached lot is a prediction row with its outcome row.
2. **What exists to reuse, read 2026-10-07:**
   - `live_lot_temperature(vehicle_id)` places the lot's bid and bidders against comparable sold lots at the same hours
     to close. Example: a 2019 Ferrari 488 Spider, closing 15:01Z, bid $255,000, was above 18 of 39 comparables 16.4 h
     out.
   - The hammer band (`hammer_predictions` model 31) and the curve (share of the final price reached at h hours left,
     36,700 sales, `market_pulse_live()`).
   - The temperature backtest (BaT coverage audit §5): 69,295 lots, hot 86.8% and cold 11.3% above the band middle
     24 h out.
   - The stack A page, `/stacks/order-book/:vehicleId`.
3. **Gaps, in order:**
   - **(a) Freshness.** The database's read of a live lot can be hours old. The 488's last read was 22:34Z for a 15:01Z
     close, still the latest at 03:51Z. In the last minutes the CLI reads the lot page itself (one public page,
     throttled) and passes the live bid, bidders and clock to the machine.
   - **(b) A reader that takes the live state.** The function reads a stored vehicle's stored state. It needs a form
     taking (lot, bid, bidders, at) and grading against the same point-in-time comparables.
   - **(c) The last two minutes.** The curve is measured in hours. The `bat_bids` copy stopped 2026-10-05, but the
     stack A page already counts `bat_public_live_v1` frames in `vehicle_observations` for lots subscribed from 15
     minutes before close (607 frames on one closed lot). The minute-level evidence exists for subscribed lots; the
     question is coverage. This is stack A's missing prediction layer, and the lead's prediction lane builds it.
   - **(d) Cohort misses.** A lot whose model text matches no cohort says so with its denominator. Example: a 2003 GMC
     Sierra 2500HD whose model field carries the cab and engine, with 0 comparables.
   - **(e) Auth.** The CLI reaches the reader through the `api-v1` key system, not anon RPC.
4. **The coaching starts deterministic:**
   - where the lot stands against its cohort, and the expected hammer band with its n;
   - the user's `--max` against that band;
   - BaT's soft close: a bid in the last two minutes resets the clock, so the play is one bid at your max, late, not a
     snipe.

   The house model comes after the outcome ledger, which is what calibrates it.
5. **Order and acceptance:**
   1. The live-state reader, plus a replay at T-2 min on past lots. Acceptance: the 80% band holds the hammer on 80%
      ± 5% of replayed lots.
   2. The `api-v1` route.
   3. The CLI verb.
   4. The MCP tool and the web page, on the same reader.

### 13.8 The owner follows the evidence: units, denominators, the nowcast, the cost of text, and what positioning is against (2026-10-07 03:30Z, in substance)

**Owner direction (substance kept).** Reading 13.6 he asked whether v13 had been better than v24, whether v24 simply
had more lots, and "those 399 lots are out of how many lots we have access to." The exercise is "for me to be better
situated in knowing how to communicate on what the product is, but maybe more importantly that the product is shaped
so that it can communicate on itself"; the agent is "an external auditor." On the lead's 13.6 point 4 he called a
fallacy: "the model reads your ledger" is not the reply to his claim, because "the model isn't making the ledger, and
if the ledger doesn't exist the model has nothing to read." His claim restated: LLMs "are not capable of creating
factual documentation; they generate opinions that could influence actions, and those actions get documented and turn
into history, so it's a different path"; "they can't predict gambling and they can't predict sales", so those markets
are "forever insulated" and "nobody is talking about it; we are, building the substrate." On the research question: it
should also be "self-correcting within the two-minute window as bid velocity and the other indicators, commentary,
eventually social media, weigh in in real time; how do our models readjust?" And: "how much is it going to cost us to
analyze all of our data, and why can't we run our text-based data faster?" On positioning: "does it auto-update? Do
new agents go in and read it and say that's ass, let's fix it?"; "positioning is based on your foe, the one you're
positioning against"; "just putting up our stats in our substrate is our ultimate positioning; it becomes take it or
leave it; it becomes a resource." On team: "I am the founder, I am the research partner. I could absolutely have a
research partner; I could get the museums on board, a school." On hearing the unit correction (03:55Z): "why are we
only running on seven lots ... I've been in total agent psychosis thinking we're moving forward ... this is what
bothers me, we are just not understanding data at scale." And the scope ruling for this session: "you're not supposed
to be working on fixing those sorts of things, you're supposed to be helping me figure out how to structure NSF seed
funding ... we have to really stay on target."

**Lead's reading (nothing minted; the repair items below are handed to the data-model lane, per the scope ruling):**

1. **The unit was wrong, and the generator is the cure.** `prediction_accuracy` counts hourly rows. v24's "399 scored"
   is 7 lots re-scored through their final 48 hours; v13's 208 is 2 lots. Per lot (last prediction before close) v24
   is 23.5% median abs error on 7 lots, 1 within 10%; by horizon the row-level median runs from 19.5% at 2 h (3 lots)
   to 45.8% at 24 h (3 lots). None of it supports a claim about model quality, and v13 against v24 is 2 lots against
   7. The owner's instinct (ask for the denominator) was right before the numbers were. The hand-typed table in
   `docs/POSITIONING.md` was wrong in unit within an hour. The cure is a block that `readme-stats.mjs` writes daily,
   whose queries define the unit (distinct lots) and print the denominators, so a stranger reads the same query the
   owner does: "the product communicates on itself." Not built tonight (scope ruling above); handed to the data-model Built 2026-10-07 10:35Z: PR #781 (`scripts/data/readme-stats.mjs` writes the evidence block between markers in `docs/POSITIONING.md`; `update-stats.yml` stages it daily; 1,482 distinct sold lots graded as of 10:23Z).
   lane with the queries in this section.
2. **The outcome join is the trunk, and it is a key repair.** Nobody chose seven lots. `hammer_predictions` holds
   4,612 v24 lots and 2,314 v31 lots (6,926 distinct across versions); `bat_listings` holds 106,551 sale prices,
   93,135 keyed to a vehicle, 1,216 of them settled in the ten days to 2026-10-07; yet the predicted lots' vehicle keys
   land on six settled listings (03:30Z). The outcomes exist in `bat_listings.sale_price` and in `auction_events`
   (`outcome`, `winning_bid`, `high_bid`); the keys between the prediction rows and the lot rows do not meet. Which key
   is broken (duplicate vehicles, husks, a slug mismatch) was not diagnosed tonight. Repairing it grades thousands of
   lots with no new data and sets the bar every later objective is measured against. Objective 0 in
   `docs/POSITIONING.md`; the data-model lane owns keys.
3. **The nowcast is stacks SA and S24, and its gate is cadence.** A prediction row per lot per minute through the
   closing chain, graded against the outcome, the update rule being the fold over bids, comment stance and later other
   signals. Historically the per-second data exists (bids are timed comments, §4). Live, `bat-live-pull` runs every
   minute over six lots with one slot held for closing lots (`v_job_health`, 03:30Z), so a lot in its final chain is
   observed about once a minute; `sync-live-auctions` runs every 15 minutes. Whether the fold recomputes inside that
   cadence is a feasibility question and belongs in the research question, where it now sits.
4. **The cost of text, and why SQL is the fast path.** 13.5 measured the free local model at 16 to 17 tokens per
   second. At 30 output tokens per comment, 20M comments is about 600M tokens, about 13 months of one local GPU. A
   regex or full-text pass over the same 20M rows in Postgres is minutes. So the plan in 13.5 stands: rules over every
   row (free, measured against denominators), the model grading a stratified sample to calibrate the rules, never the
   whole log. API models change the price, not the shape; their cost is a lookup, not a memory, and is not quoted here.
   Images are the expensive side (52.1M, 0.5% analyzed): the vision gate selects, it does not sweep.
5. **The fallacy conceded, the claim restated.** "The model reads your ledger" answers a claim the owner did not make.
   His claim is about creation: a model emits priors, it cannot emit an observation, and an auction close is an
   observation that does not exist until it happens. That form holds under a referee and it is the form 13.6 point 4
   should have led with. `docs/POSITIONING.md` now carries it in his words.
6. **Positioning is against the unverifiable number.** The alternatives (price guides, aggregators, venue comps, a model
   asked for a value) give a number with no error table. Nuke's position is the opposite, and the stats in the
   substrate are the positioning, which is why they are generated and why they carry unit, date and denominator.
7. **Team.** The owner is the research partner today. STTR requires a research institution (a university is the clean
   case; a museum is a partner and a letter); who to ask is the owner's call and a message to other people.
8. **Scale, read correctly.** The failure the owner names is real, and its shape matters: the predictor ran at scale
   (6,926 lots) and the grader ran at seven, because the join between them never landed and nothing noticed. That is
   the "silent failure" law of `production-engineering.md` applied to the grading layer. The repair belongs to the
   data-model lane; this session returns to the funding structure, as ruled.

**Correction trail.** 13.6 point 2 and point 3 edited in place at 03:50Z with the marker "corrected"; the originals
are in the git history (PR #744).

### 13.9 The owner on opportunity as a function of the model, and what the winners look like (2026-10-07 04:30Z, in substance)

**Owner direction (substance kept).** Reading the NSF path: "this becomes an interesting function, an interesting
result: opportunity as a logical conclusion with confidence scores based on nodes of data, where this opportunity
surfaces naturally based on the actions of the entities that are making decisions. Twofold: one, to see how far we
are from the opportunity; two, the painfully obvious: this should be a natural occurrence in our system, and then we
start always monitoring for these opportunities, because this is a potential match for an organization." On a
subaward: "we measure the importance of a potential award and then we look at Nuke's relationships and say maybe
that's a good one to pursue; who's in our group of potential." On the school conversation: "we just automate that;
agents will be doing these conversations anyway." On eligibility: "super easy, that's just a key. Data model the
shit out of this, measure all those keys, give those keys values, and then we calculate which key combinations win.
This is the exact type of stuff people want to automate in order to stay focused on what they're interested in.
They're giving such specific layouts of what they expect, and we can research all of the previous winners to
identify the patterns; that's organization profile research; they start getting profiles built out. That's why
we're a data model system more than anything else." On the track: "I don't pick the track; the track makes itself
known based on what we do." On SAM.gov: "I feel like I have SAM.gov; worth checking my email."

**Lead's reading (nothing minted; a first baseline pulled):**

1. **An opportunity is a stack.** Entities: a funding program (NSF SBIR/STTR) as an organization with published
   criteria; its awards as outcome rows (public, dated, keyed to awardee organizations, states and programs); the
   criteria as keyed claims about the applicant (employee count, ownership share, PI hours, place of work, partner
   edge); Nuke itself as an entity in its own ledger with those claims attributed and dated, the database describing
   its owner the way it describes itself. The score is coverage of criteria met, times fit to the winners' cohort
   (topic, geography, track), times the presence of the edges a track needs. "How far we are from the opportunity"
   is that score's complement with the missing keys named, exactly as a stack shows its missing layers before its
   number (13.1 point 3).
2. **The track is a function of one edge.** STTR means a research-institution partner with a co-PI; SBIR means
   none. Nothing else in the FY2025 data separates the tracks (STTR 39 of 146 Phase I; same median award; same
   windows). So the track is decided by whether the partner edge exists by pitch time, and the pursuit of that edge
   is an agent task with a send gate (13.3): candidates found and messages drafted by agents, sent by the owner.
3. **The first baseline, pulled 2026-10-07 from the public NSF awards API** (FY2025 start dates): 146 Phase I (107
   SBIR, 39 STTR; median $305K), 108 Phase II (median $1.25M), 10 Fast-Track. Topic, over the 144 with exact
   program names: AI or machine learning 37, software 15, database or data platform 4, marketplace or auction 1,
   valuation, pricing or appraisal 0, provenance or ledger 0. Nevada 1 of 144 (Las Vegas, battery materials); no
   award names the University of Nevada. Historically about 16% of Phase I proposals were funded (338 of about 2,112
   a year, 2008 to 2017; National Academies, SSTI). What NSF funded is the inference method inside a tool, never the
   market itself. The pitch's innovation section is therefore the estimator and its grading rule; the ledger is the
   testbed and the moat, told second. Details and the query in `docs/POSITIONING.md`, "What winners look like".
4. **Keys the data does not yet carry.** Team size (SBIR.gov's API has `number_employees` and answered HTTP 403 on
   2026-10-07); the partner institution of STTR awards (only in abstracts); the pitch-to-invitation rate
   (unpublished). These are the stack's named gaps.
5. **The owner's registrations, from his own records.** No SAM.gov, SBA registry or SBIR mail under his primary
   address as of 2026-10-07; a login.gov password reset in October 2024 returned "email not found". Treat the company
   as unregistered. The registrations are free and are the owner's to create.
6. **Shape, for the lanes that own it.** A `funding_awards` source (public rows, reproducible pull); funding programs
   and research institutions as organizations with relation edges to Nuke (the identity-origin lane owns the
   organization entity); claims about the company itself as attributed rows. SCHEMA_LAW before any table. The
   FY2025 pull sits in this session's scratchpad; the query is in `docs/POSITIONING.md`.

#### 13.9.1 The owner: this is the seed round for the entity model; how does expansion automate? (2026-10-07 05:00Z, in substance)

**Owner direction (substance kept).** "You took one tiny sample. The way you turn this into work is what I said
earlier: this is where we make use of this effort. This is the seed round to develop this into a model for
entities: organization entity, user entity. This is very important. I'm glad you did some research. How do we
automate expansion of the data model to fit this in?"

**Lead's reading (nothing minted; the mechanisms below were read live at 04:50Z):**

1. **The whole resource, not the sample.** SBIR.gov publishes every award ever made as one CSV
   (`data.www.sbir.gov/awarddatapublic/award_data.csv`, refreshed monthly): 207,731 awards across 12 agencies,
   14,796 of them NSF (9,959 SBIR Phase I, 1,279 STTR Phase I, 3,558 Phase II), 41 columns including employee
   count at award, flags, PI and STTR research-institution names, and the abstract. Its award years end at 2023;
   the NSF awards API covers 2024 and 2025 (the FY2025 pull in 13.9) and is being pulled for 2008 to 2025 to join
   on title and awardee. Pulled 2026-10-07 to the lead's scratchpad; the file is public and reproducible.
2. **What the whole resource says that the sample could not.** NSF Phase I awardees are tiny companies: median 3
   employees at award (2015 to 2019 n=1,534; 2020 to 2023 n=779), 65% with three or fewer, 21% with one or none.
   Solo is the norm, not the gap. Since 2015: 2,927 Phase I awards to 2,802 firms (96% hold exactly one); 32% of
   those firms later hold an NSF Phase II; STTR is 19% of Phase I, with 252 distinct research institutions named
   (Purdue 15, Arizona State 10); Nevada 3 of 2,927, one of them since 2020 (Las Vegas, 2023), and the Nevada
   System of Higher Education appears once as an STTR partner. Phase I median award was $274,883 in 2023, before
   the raise to $305,000. The 2020-plus cohort: 17.5% women-owned, 12.1% HUBZone, 15.6% socially and economically
   disadvantaged. Winners-only data gives the shape of winners, not the odds; the odds need the proposal
   denominator NSF publishes only in aggregate (about 16%).
3. **How the model already expands, mechanism by mechanism (read live).**
   - *Entities.* `vehicle_observations.subject_type` is CHECKed to `vehicle | organization | user | asset |
     external_identity` (NOT VALID), and `organization` and `user` subjects already carry rows (a 0.5% sample held
     10 and 2). A fact about a funder, an awardee or a university lands today as an observation on an
     `organizations` row, the cross-domain commons SCHEMA_LAW §10 names. Nuke itself is organization
     `f32ea08c`, with `employee_count` and `registration_state` null: the eligibility keys are columns waiting for
     observations, and the owner's other entities are already modeled (`organization_hierarchy`, 3 rows).
   - *Sources.* `observation_sources` (176 rows: slug, category, tier, base_url, trust) is the registry the fact
     log keys to by FK. A new source is one row. Five sibling registries exist (`source_registry` 97,
     `scrape_sources` 548, `live_auction_sources` 18, `forum_sources` 179, `catalog_sources` 17): a toolbox to
     adjudicate toward the one the log keys to, never a sixth.
   - *Vocabulary.* `schema_proposals` (proposal_type `add_property`, `add_source`, `add_observation_kind`,
     `modify_property`; `fn_schema_proposal_review_handler`, `fn_schema_proposal_apply`) is the curator path
     data-machine.md names for missing vocabulary: 13 approved properties, 2 proposed today, and 4 `add_source`
     proposals open since 2026-07-20 with no drain. `financial_field_registry` (37 rows: field_key, storage,
     promoted_at) is the plasticity pattern: a field lives in staging until use earns it a column.
   - *Measurement.* The atlas scores description, keys and writers; `v_residual` ranks the backlog;
     `stack_coverage` scores a stack's needs against the live schema; the local generator proposes stacks.
   - *Law.* SCHEMA_LAW §2: a new fact class lands as observation rows first and earns a table only when a query
     pattern demands one; §10: share only the commons, copy the grammar for a new domain's high-volume organ, and
     generalize bottom-up at the third tenant.
4. **So "automate expansion" is wiring, not invention.** The path for a funding award, in the machine's own
   terms: one `observation_sources` row (or an `add_source` proposal that the review handler applies) → rows
   landed through `ingest-observation` as observations on organization subjects (funder → awardee, with program,
   amount, dates and state as the payload and `funds` / `awarded_to` / `partners_with` as relation claims, 13.3) →
   awardee names and institutions keyed to `organizations` by the existing resolver, states to places, PIs to
   identities → fields the grammar lacks staged, and promoted through `add_property` when they recur → the atlas
   measures, the stack declares its needs, `stack_coverage` reports the distance. When cohort baselines by year,
   topic and state demand window scans, the fact class earns a domain table that copies the grammar
   (`funding_awards`, FK into the commons), per §2 and §10.2.
5. **What is not yet automated, and is the real work.** (a) A generic ingester for declared API and file sources:
   every source today is a bespoke `extract-*` function (the CI ratchet counts their raw fetches), so an NSF
   awards API or an SBIR.gov CSV has no reader until someone writes one; a declared-source reader keyed by the
   registry row is the subtractive fix. (b) The proposal queue has no drain: four `add_source` rows have waited
   since July. (c) A first-class person subject, named as the structural blocker in the organization-entity
   spec; PIs and co-PIs are people. (d) The track and the fit are stacks, not pages: the registry row for the
   opportunity stack is the lead's to mint.
6. **Hand-offs.** To the data-model lane: the `add_source` proposal for the two award sources and the generic
   declared-source reader, with the queue drain. To the identity-origin lane: funders and research institutions as
   organizations with relation edges, and the person-subject proposal. This session stays on the owner's funding
   question and drafts the pitch from the measured shape of winners.

#### 13.9.2 The owner: NSF is a case study for expanding the model; the product is matching every organization to its opportunities (2026-10-07 18:10Z, in substance)

**Owner direction (substance kept).** "The NSF is more of a case study on how to expand the data model; that's really
the idea. Typically it's manual and requires human labor to submit a business to opportunities like the NSF, but if
there was a way to automate it, more companies would be exposed to the opportunity, if the data surfaces and they're
actually a good match. That's what I would have preferred to see: the data model expanded and prepared to accept the
appropriate data to make this possible, more than sending out our application. You almost missed the mark. I get that
we have to collect and analyze the data to understand the odds."

**Lead's reading (nothing minted).**

1. **The miss, stated.** This session steered toward Nuke's own application: the pitch, the company's blanks, and S61
   v1, whose feature need names organization f32ea08c as the applicant. The owner's case is the case study; the
   product is the general function: for every organization in the ledger, which opportunities it fits, how well, and
   which keys are missing, surfaced when the data says so and recomputed as observations land.
2. **What was built that serves the general function.** The `add_source` branch (any opportunity source registers
   through one approval, #766); the declared-source reader (award rows to observations with funder, awardee, program,
   amount and dates, #767); the award history as the outcome set (14,796 NSF awards; 207,731 across 12 agencies in the
   SBIR.gov file); the batch organization creator keyed by canonical domain and DUNS (#810), which makes the awardees
   and institutions organizations.
3. **What the model still lacks for matching.** (a) An opportunity entity: a program or solicitation with its funder,
   its windows as clocks (deadlines, award dates) and its criteria as keyed claims (size, ownership, place of work,
   topic, track partner), each criterion a vocabulary entry through `add_property` proposals, not prose. (b) Every
   organization's facts as observations against those keys (employee count, location, topic, prior awards), which the
   award rows already carry for 2,802 awardee firms. (c) The match as a fold per (organization, opportunity): criteria
   coverage, fit to the winners' cohort baseline, missing keys named, with the odds marked as winners-only until a
   denominator exists. (d) A surface that shows a match when it appears; the "natural occurrence" is a new match row.
4. **S61 generalizes.** Version 2's entity is (organization, program), not the company; Nuke is one row among the
   organizations it scores. The registry change is the data-model lane's; the needs above are its list.
5. **The pitch is secondary.** It stays in `docs/POSITIONING.md` as one application of the function, not the goal.

### 13.9.3 Attributed demand and contextual opportunities (owner, 2026-10-14 local)

The owner broadened the classified-feed question beyond personal interest: model local, state, national and cultural
value contexts and the ability to act; precompute useful supply/demand connections before a user joins. A public
wanted post can express attributed demand without becoming a Nuke account or proof of current buying intent. Interest,
request, available supply, contextual fit and financial opportunity have different evidence and outcomes. The owner
asked agents to proceed independently, test the model through skeptical review, and repair useful missing relationships.

The existing [opportunity matching specification](../../features/opportunity-matching/SPEC.md) now carries this general
contract and preserves the funding case as dated history. Inspection found three differently grained owners:
`demand_signal` measures aggregate search/interest; `taste_intent_signals` records user saves; `demand_briefs` carries
concierge partner asks. None becomes a new external-request store. Attributed testimony and property vocabulary retain
their existing observation/identity/curator owners; request episode, criteria, lifecycle, visibility and evaluation
relationships remain named work.

Independent review corrected two model errors: no known unmet criterion does not establish eligibility when required
facts are unknown; and a registry of eligible businesses cannot supply the application denominator for funding odds.
The first implementation extends `scripts/discovery/buying-evidence.mjs` with an explicit structured-request mode,
using existing anonymous typed-specification and provenance readers. Required/preferred predicates return met, unmet,
unknown or conflict with source IDs and clocks. Primitive record labels cannot satisfy a requirement. This is a bounded
private operator consumer over 1–10 declared candidates, not a maintained public market feed or automatic request
extraction. Availability, geographic/cultural ranking, economic outcomes and whole-market coverage remain unassessed.

The correction assay preserves captured inputs and reevaluates the same request after discriminating evidence, with an
unaffected candidate and earlier captured receipt retained. Such replay proves the evaluator, not historical canonical
state reconstruction or fleet improvement. No production schema, request admission, source activation, contact or paid
model calls are part of this implementation. Implementation/test/publication/runtime stages are recorded in the lane's
private receipt; neither this contract nor a passing fixture establishes net newly ready public answers.

### 13.10 Used-vehicle buying evidence: resale reassurance and personal use (owner, 2026-10-08)

**Owner direction, in substance.** A buyer comparing a truck at 94k miles and a higher price with one at
104k miles and a lower price needing maintenance must weigh more than the odometer. Maintenance, owner
history, storage, usage, region, weather and wear evidence are buried in descriptions, images and comments.
For the owner, the reassuring number for the next buyer is a major weight; buying for oneself at 100–150k
raises a different question. A vehicle at 50–100k cannot be assumed to need no work. The owner authorized
planning and building the data tools needed to find this evidence in retained raw material.

**First bounded tool, PR #900.** `scripts/discovery/buying-evidence.mjs` extends the existing operator
discovery lane, preserving existing description, comment, observation and image owners. It reads 1–10
explicit public vehicles through `q.sh` in finite READ ONLY transactions, searches exact source regions
with deterministic vocabulary or a literal query, and writes private JSON receipts and an HTML comparison.
Inline BaT captures use the existing parser after same-vehicle binding and recomputed SHA256 verification.
Source IDs, episode references, author/seller metadata, original clocks, quote offsets and duplicate-text
clusters survive. Questions, hypothetical work, negation and model-level statements remain review candidates.
No database/schema writes, intake, new model calls, financial weights or failure predictions.

**Dated local/runtime assay, 2026-10-08 20:24Z.** Three selected public trucks yielded 169 comment rows,
5 observations, 378 eligible image rows and 4 capture rows; every selected collection reached an empty
continuation page. The default vocabulary returned 108 excerpts. A cache-only heater-core query returned
6 excerpts including earlier questions and a later recorded seller statement of replacement. This is
testimony with dates, not verified repair or automatic contradiction resolution. The selected images had
no searchable text in the inspected `ai_extractions` field; other image-analysis fields remain unmeasured.
One capture was offloaded and two lacked the required vehicle binding.
These are reported gaps, not proof that the underlying history or condition evidence does not exist.
Fourteen offline contracts and the existing ENFORCE gate passed; the private HTML rendered and was inspected.
This entry establishes implemented, tested and bounded runtime-read stages; PR/CI establish merge status.
Private receipts: `~/nuke-private-data/buying-evidence/20261008-verified-read/` and
`20261008-heater-core-review/`. Usage and retrieval boundaries: `scripts/discovery/buying-evidence.md`.

**Remaining stack work.** Reviewed source regions need existing canonical component/procedure, performed
versus planned action, event date/mileage and ownership-window relationships, with corroborating evidence
and sanctioned admission. Qualify outcome histories before learning cost/reliability weights; missing records
do not establish neglect or successful work. Measure resale reassurance against later price/liquidity
separately from personal-use repair expense, downtime and useful service over an explicit buyer horizon.

### 13.11 The owner on seeing actors: every endpoint a measure, relative, the map as the zoomed-out view (2026-10-14 00:00Z)

**Owner direction, in substance.** Click-through runs on the phone end on incomplete data and on endpoints that
mean nothing for the goal. The stacks exist to *see* users and organizations: a name and a list of cars is not
that. What has meaning is performance and relativity, the measure. Opening Viva! Las Vegas Autos should show its
stats: personality, era specialization, market performance and ROI, whether the actor reports its profits. The app
is full click-through, every number a door; the map is the same view zoomed out: a ZIP where the actors are
"stackmaxxing", fully open to audit, and showing how well they perform.

**What that means for an endpoint.** An actor (organization or person) renders as a document of measures, each
with its method, its population and a rank among a stated peer cohort above the rank floor (kit `Measure`,
`RANK_FLOOR` 5). Four families, mapped to the stacks above: performance (sell-through on known outcomes, bids,
comments and views per listing, volume; stacks 4 and 17), specialization (share of the actor's vehicles by
decade and make against the market's share, a concentration ratio; stack 17), open books (of sold vehicles, how
many carry a recorded sale amount; of held vehicles, how many carry a recorded acquisition cost; how many carry
both, the vehicles whose ROI is computable; stack 15, amounts never shown to strangers, only the fact of
disclosure), and documentation depth (photos, observations and work per vehicle against peers; the "stackmaxxing"
measure). An unknown is stated as unknown with its denominator, never as zero. The map aggregates the same
measures per ZIP or county over the actors located there (stack 1).

**The worked case, read-only, 2026-10-14 00:08Z.** Viva! Las Vegas Autos (`organizations` c433d27e, dealer,
Boulder City NV). From `organization_seller_stats` (contract `listing_activity_v1`, computed 2026-10-13 23:50Z):
72 attributed listings, 31 sold, 5 unsold, 35 without a recorded outcome; sell-through 86.1% of known outcomes,
the 59th percentile of 211 organizations with at least five known outcomes (median 83.6%); bids per listing the
highest of the 211; views per listing the 5th percentile; volume the 42nd. From `organization_vehicles` joined
to `vehicles` (owner, sold_by and consigner links, 137 vehicles with a year): 1970s 26% against 13% of the market
(2.0×), 1980s 23% against 11% (2.1×), 2020s 10% against 3.7% (2.8×), 2000s 0.6×; Chevrolet 42, Ford 22, GMC 15.
Open books: 54 of 74 sold vehicles carry a recorded sale amount; 15 of 63 held vehicles carry an acquisition cost.
The listing-activity contract counts 0 priced sales where the vehicle rows carry 54 sale amounts: two populations,
reconcile before either becomes a performance number. The organization row's own counters (`total_sold` 0,
`gmv` 0, `total_auction_wins` 17) contradict both and are not measures. `organization_seller_stats` has row
security and no read policy, so a stranger reads none of it today.

**Build order.** (1) A typed read per actor kind returning the kit document (masthead, measures sections with
coverage and peer rank, a table of the actor's vehicles by role), a public projection with no amounts; a contract
test on a disposable PG17. (2) The phone renders measures and tables through the kit twin and reaches an actor from
search, from a vehicle's seller or owner link and from the map. (3) The same read for a person (garage, work,
disclosure), then the per-ZIP aggregate for the map.

### 13.12 The wiring harness as a stack (owner, 2026-10-14)

**Owner direction, in substance.** Each vehicle has its own extensive data model with its unique data, queried with
SQL in Postgres: "a series of tables and descriptions, that's how we're supposed to be storing an entire wiring
harness, not raw data, heavily structured data ... options are different from hard coding ... using the data model as
our method of delivering the facts of a wiring harness." After seeing the K5 harness rendered from its rows: it
"preceded our whole data model movement"; "completely ingest this into the proper data model with all the data
machine concepts and rules, making sure everything's deeply connected ... ruminate, hypothesize, develop criteria of
what is a stack for wiring harnesses, what is the structured data of this system."

**What the rows are today (read-only, 2026-10-14, vehicle e08bf694).** 37 wiring tables exist. The K5 holds 528 live
wires (`vehicle_custom_circuits`), 227 plugs (`harness_endpoints`) and 891 wire ends (`wire_termination_specs`),
loaded one way from `k5_registry.json`, which is the source of truth. 136 of the 528 wire rows store a Python
dictionary as text in `from_component`/`to_component`, and 27 store prose in a cavity column. 0 of 891 wire ends and 0
of 227 plugs key into `catalog_parts` (10,853 rows), although the wire-end table carries nine foreign keys for it.
1,100 of the 1,156 rows in the shared pin library (`device_pin_maps`) also carry one vehicle's connections.
`factory_harness_circuits` holds 71 squarebody 1973-87 circuits beside 60 `nuke_build` rows (a build mixed into the
factory baseline). `connector_cavity_layouts` holds 467 cavities across 46 connector models, with the D38999 25-61
listed twice under two names. 9 of 132 columns in the three core tables are described. 42 of 528 wires carry stored
check results; the checks run in Python with the truck's layout typed in. The owner's verdict stands: tables holding an
export, not a model.

**The nouns already exist outside.** VDA 4968, the Vehicle Electric Container (VEC), is the automotive industry's
information model for harnesses: components such as connectors and wires, connectivity and wiring, topology and
geometry, and variants and modules, with the older harness list KBL (VDA 4964) beside it (prostep ivip fact sheet).
Take its concept set as the dimension vocabulary rather than inventing one. What Nuke adds is what VEC does not
carry: testimony behind every value, clocks and replay, cohort baselines, and outcomes.

**The harness through the nine layers (lead's hypothesis).**

| Layer | What it means for a harness | Exists today as |
|---|---|---|
| Log | Every statement about the harness, attributed: a maker's datasheet line, a service-manual page, a vendor drawing, an owner call, a builder's practice, a receipt, a photo, a tape measurement, an agent interpretation with its method and version, a check result with its inputs and rule version. Event clock (said or measured) and ingest clock. | Receipts in git; some `vehicle_observations`; most harness facts are registry fields with a source string |
| Key | Part numbers to `catalog_parts`; pins to the device pin library; cavities to the connector model's cavity layout; plugs to device instances; speakers to identities and organizations | The foreign-key columns exist and are empty |
| Dimension (shared, versioned, no vehicle in it) | Parts (housing, terminal, seal, wedge, backshell, wire spec, fuse, crimp tool and die); connector models with cavity layouts and compatibility (terminal × seal × wire outside diameter); device models with pins (function, electrical type, limits); wire specs (gauge, diameter, ampacity by temperature, resistance per foot); signal types; body-generation routing landmarks; the factory circuit catalog per generation | `catalog_parts`, `connector_cavity_layouts`, `wire_catalog`, `component_library`; `device_pin_maps` and `factory_harness_circuits` mixed with one build |
| Instance graph (per vehicle: the harness itself) | Device instance (placed, with its position source) → connector instance (one mated half) → cavity occupancy (a terminal instance) ← segment (one physical wire between two terminations: spec, colour, planned and measured length) ; segments compose a net (the logical circuit: source pin to load pins, function, protection); splices, studs and ground banks are nodes; bundles and branches carry coverings and routes; every row carries its variant membership (the "150 % harness") | `harness_endpoints`; `vehicle_custom_circuits` conflates net and segment (a wire through the firewall is one row with four end rows); `wiring_decision_links` |
| Fold | State per instance as of any date: design (concept → decided), procurement (carted → bought with proof → in hand), build (cut → terminated → installed → tested) | Status columns rewritten by each load |
| Baseline | (a) The factory harness of the body generation, what the truck was born with; (b) the cohort of comparable builds (standalone ECU and PDM restomods, other M130 looms: Dave's Bronco sheet belongs here as a comparable, never as K5 fact); (c) maker rule limits (ampacity, drop ≤ 3 %, seal range) | 71 factory circuits with typical lengths and 26 known failure modes; no build cohort |
| Residual | This harness against its baselines: each factory circuit kept, replaced, deleted or new; wire per function against the cohort; margins against the rules (drop, ampacity, PDM output current); spare cavities, outputs and inputs against the cohort | The manifest's KEEP / REPLACE / NEW / SPLICE flag; margins only in `CABLE_SIZING.md` |
| Feature | Per harness as of t: readiness by layer (plugs, ends, crossing, terminals, material), cited-field share, minimum margins, spare capacity, open unknowns with the cost to close each, key-off draw | `options_v5.py` readiness levels, outside the database |
| Prediction (six blanks) | At design freeze t, for standalone-ECU harness builds P, predict cut length per segment, material cost, build hours and first-start defects as a median and 80 % range; grade by absolute error against the as-built outcome; baseline the factory typical length plus pad, or the cohort median. Per segment: the chance of rework | None |
| Outcome | The as-built truth joined back by key and clock: measured cut lengths, receipts, work sessions, continuity and insulation tests, voltage drop under load, first start, later faults | None (nothing cut) |

**Criteria: the harness is a stack when each of these holds, and each is a test.**
1. Every physical thing has a grain and a key: part, connector model, cavity, device model, pin, device instance,
   connector instance, terminal instance, segment, net, node (splice, stud, ground bank), bundle, route node. A wire
   through a bulkhead is one net and two segments.
2. The library and the instance are separate: no library row names a vehicle, and no instance row restates a library
   fact as text.
3. Every reference is a key. An unresolved reference is held as a candidate with its original text and a status, never
   as prose or a serialized object in a typed column.
4. Every value carries testimony: its source observation, the speaker's relation (maker, service manual, owner intent,
   builder practice, another vehicle, agent with method and version), both clocks and trust. Another vehicle's
   document can inform a baseline; it cannot become this vehicle's fact.
5. Replay: the harness as it stood on any date is a query, and state changes are events.
6. Variants are data: an option is a decision row, instance rows carry variant membership, a configuration is a query,
   and deciding an option changes rows, not code. An option with no rows reports itself as unexpanded.
7. Checks are computed conclusions in SQL, with a rule version and stored inputs. A decided owner call is a constraint
   the instance cannot violate. Generators never decide.
8. Every output reads the rows: build book, diagrams, cut list, formboard, carts and the stack page. Nothing generated
   is a source.
9. Coverage comes first, across every harness instance in the database (the K5, a factory generation, any other
   build), each layer with its denominator.
10. Every column is described in the database (meaning, unit, source, grain, clock).
11. A second vehicle's harness, or a factory generation, lands in the same tables without a new table.

**Hypotheses, each falsifiable.**
- *H1, net and segment.* Wire #110 (coolant temp) as one net and two segments through 61-pin cavity w reproduces
  today's kit output and gives each segment its own length and cut state. It fails if a segment needs a field the net
  owns.
- *H2, checks as joins.* Terminal wire range, cavity validity and seal fit recomputed in SQL over library and instance
  rows agree with `check_plug_ends.py` on all 939 ends; every disagreement names a model gap.
- *H3, contamination is a key error.* The 65 fields resting on the Bronco sheet and the 28 purchase flags citing
  another customer's invoice become other-vehicle or baseline testimony once every observation is keyed to the
  vehicle it observes; none can then be a decided K5 fact.
- *H4, variants.* Rev A as a query (492 of 528 wires on 2026-10-14) equals `options_v5.py`'s configuration for the
  same option set. 50 of the 55 candidate options have no rows today.
- *H5, factory baseline.* The 71 factory circuits give the K5 a residual (kept, replaced, new per factory function)
  that accounts for its 528 wires; the 60 `nuke_build` rows leave the factory table.

**Build order (a proposal; tables only through SCHEMA_LAW and `schema_proposals`, nothing minted here).**
(1) Map each VEC concept to an existing table or a proposal, and name each conflation (net and segment; library and
instance in `device_pin_maps` and `factory_harness_circuits`). (2) Re-ingest the K5 from its sources rather than
from the registry: each fact an observation with its datasheet page, manual page, owner call, receipt, photo or
measurement, then keyed and folded into the instance graph. The registry becomes a generated view, and its row-by-row
diff against today's file is the audit. (3) Port the checks to SQL (H2) and the configuration to a query (H4).
(4) Load the factory generation as the first baseline (H5) and one more build as the first cohort member. (5) The
harness stack page, rendered from rows, coverage first, every number a door.

#### 13.12.1 RSI pass on 13.12, and step 1: the VEC map (lead, 2026-10-14)

The owner left the judgment to the machine ("it's up to you, that's why we're supposed to be doing RSI"). The lead
re-read 13.12 against the theory card, VEC's class model and the live rows, and found nine faults in its own draft.

**What was wrong or missing.**
1. *The design was put in the log.* A harness design is intent, not observation. The log holds observations of the
   world (makers' part specifications, the truck's measurements, receipts, photos, tests) and statement events (an
   owner call, a builder's practice, an agent interpretation with its method). The design is a fold over decision
   events, and every planned value is a **prediction** graded by the as-built **outcome**: planned length against
   measured cut length, predicted drop against measured drop under load. The harness stack has a prediction layer from
   the first decided wire.
2. *One connectivity level was too few.* VEC keeps `Signal` (what it means), `Net` / `Connection` (what is electrically
   joined), `WireElementReference` (the physical wire) and `Topology` (where it runs) apart. Criterion 1 becomes four
   levels: signal → net → segment → route.
3. *"Checks in SQL" contradicted an existing decision.* `wiring_policy_rules` was created as "Physics stays in code;
   policy (limits, ...) in rows" and holds 0 rows. Corrected: limits and policies are versioned rows; physics is code
   that reads only rows; every result is a row with its inputs and rule version; a failing result blocks the state
   change it guards.
4. *Coverage had no denominator.* Completeness needs a contract per grain stored as data (what a closed wire end, a
   placed device, a protected net requires). The wire-closure protocol's fields are that contract, kept today as a
   markdown rule.
5. *Lengths were treated as values.* A segment's planned length is computed from the route graph plus the pad rule;
   the digital twin's measured paths become topology rows.
6. *Electrical behaviour was missing.* Every net carries its load model and its protection element (fuse, or PDM output
   with its current setting) as data, and margins are computed from them. 19 of 40 assigned PDM outputs have no
   current setting today.
7. *Privacy was missing.* Money and people's contact details are owner-only at the source (the manifest leak found the
   same night, PRs #1147 and #1148).
8. *H5 over-claimed.* A standalone-ECU restomod is mostly new circuits, so the factory harness cannot "account for"
   528 wires. The test is the classification itself: each of the 71 factory circuits kept, replaced or deleted, and
   each K5 net factory-derived or new. That measures how far the build departs.
9. *Provenance exists and is laundered.* The instance tables have `source`, `method`, `observed_at` and `trust`, but
   every live K5 row cites the export: 390 wires "k5_registry v5", 138 "April 2026 whole-truck plan", 795 wire ends
   "k5_registry v5" and 96 "k5-wiring", all at trust T3. The registry carries per-field citations (the ~470 cited
   fields `audit_citations.py` reads), and the loader flattens them away. Re-ingest carries each field's own
   citation into its observation.

**Criteria, revised (supersedes the list above).**
1. Four connectivity levels, each a grain with a key: signal → net → segment (one physical wire) → route (topology
   node and segment). A wire through a bulkhead is one net and two segments mated at a cavity.
2. Library and instance are separate (VEC's specification and occurrence): no library row names a vehicle.
3. Every reference is a key; an unresolved one is a candidate row with its text and a status.
4. Three evidence kinds, never mixed: observations (with source document, speaker relation, both clocks, trust),
   decisions (author, rationale, the observations they rest on) and computed results (inputs and rule version).
   Another vehicle's document informs a baseline, never this vehicle's fact.
5. The design is a fold over decision events; replaying any date is a query.
6. Planned values are predictions and are graded against as-built outcomes.
7. Variants are data: configuration and variant membership on every instance row (plug, segment, end), and a
   configuration is a query.
8. Limits and policies are versioned rows; physics is code reading only rows; results are rows; a failing result
   blocks its transition.
9. Completeness is computed against per-grain contracts stored as data, across every harness instance in the
   database.
10. Lengths come from the route graph; margins come from each net's load model and protection element.
11. Every output reads the rows (book, diagrams, cut list, formboard, carts, page).
12. Every column is described; money and contacts are masked at the source; a second vehicle or a factory generation
    lands in the same tables.

**Hypotheses, revised.** H1 becomes four-level: #110 as signal "coolant temp", one net, two segments mated at 61-pin
cavity w, routed over twin topology. H2 tests policy rows plus code: limits for terminal range, seal range and cavity
move into `wiring_policy_rules`, and the recomputed verdicts must match `check_plug_ends.py` on all 939 ends. H3 and H4
stand. H5 becomes the classification in fault 8. New, *H6, the design as prediction*: once segments are cut, planned
length against measured length per segment gives the twin's calibration (median error and 80 % range) by route type.
Until then it is untestable and says so.

**Step 1 result: VEC concepts against the live tables.**

| VEC concept | Meaning | Nuke today | Verdict |
|---|---|---|---|
| `PartVersion` + specifications (`ConnectorHousingSpecification`, terminal, cavity seal, `WireElement`, `CoreSpecification`) | the part master | `catalog_parts` (10,853), `wire_catalog` (107), `connector_specifications`, `component_library` (84) | Exists; no instance keys into it |
| `Slot` / `Cavity` | positions in a housing | `connector_cavity_layouts` (467 cavities, 46 models) | Exists; D38999 25-61 twice; not keyed to the housing part |
| Component specification with its pins | a device model and its pins | `device_pin_maps` (1,156) | Conflated: 1,100 rows also carry one vehicle's wiring |
| Component occurrence (`Role`, `Placement`) | this device on this truck, placed | `vehicle_build_manifest` (141) and device rows in `harness_endpoints` | Two tables for one concept; placement is three columns plus a text source |
| Connector occurrence, `Mating` | a plug half on the truck and the half it mates with | plug rows in `harness_endpoints` (e.g. FIREWALL-CABIN / -ENGINE) | No mating relation |
| `CavityReference` + `ContactPoint` | one wire end: cavity, terminal, seal | `wire_termination_specs` (891) | Right grain; part numbers are text, nine keys empty |
| `WireElementReference` | one physical wire | inside `vehicle_custom_circuits` | Conflated with the connection |
| `Connection` / `ConnectionEnd` / `Net` | what is electrically joined | inside `vehicle_custom_circuits`; splices as plug rows | No net table |
| `Signal` | what it means | `circuit_name` and `signal_type` text | No table |
| `TopologyNode` / `TopologySegment` / `Routing` | the route graph and what rides each branch | `vehicle_harness_landmarks`, `harness_bundle_definitions` (both idle); the twin lives outside the database | Absent in practice |
| `Configuration` / `Variant` / `UsageNode` / `Module` | options and their members | `wiring_decisions` (`opt-*`) + `wiring_decision_links` (`coupled_with`, plugs only) | Partial: membership on plugs, not on segments or ends |
| `DocumentVersion` | the source document | `wiring_reference_documents` (idle), library extracts in git, `source` strings | Not keyed; flattened to the export |
| (Nuke) testimony per value | source, relation, clocks, trust | columns on the instance tables | Present, all pointing at the export |
| (Nuke) policy rows | limits as versioned data | `wiring_policy_rules` | 0 rows |
| (Nuke) baseline | the factory harness | `factory_harness_circuits` | 71 factory rows mixed with 60 build rows |

**Next (step 2 begins).** Filed as `schema_proposals` 006d44ec (add_table, open, 2026-10-14 05:21Z): signal, net,
segment (wire element occurrence), topology node and routing, with landmarks extended into topology branches,
`Mating` as a key between plug rows, and variant links reaching segments and wire ends. A curator approves it. Then
#110 is re-ingested end to end from its own citations as the first case (H1), with its diff against today's rows.

#### 13.12.2 Step 2, dry run on wire #110 (lead, 2026-10-14)

The harness tables went live with migration 20261014060000 (PR #1156; 5 tables, 75 of 75 columns described). Before
writing #110 into them, a read-only dry run asked what each of its facts would key to. The answer locates step 2's
real work.

**What #110 is, across its records.** The cited closure of 2026-05-13 says M22759/32 tan/white, a Metri-Pack 150 sensor
plug and a WPCTS30 pigtail. The registry today says M22759/16-22 yellow/red (colour basis: Dave's Bronco sheet, a
practice from another vehicle) and a GT150 plug; its own wire row still names a Metri-Pack terminal while its end rows
say GT150 12191818. Four versions of the same wire, none of them superseded in the database: the history the new
tables can carry and the old ones overwrote.

**What its facts can key to today.**
- Cavities: 1 of 4 wire ends resolves, and only by translation ("B04" in the harness, "B4" in
  `connector_cavity_layouts`). The library stores the D38999 25-61 insert twice (`D38999_J61`,
  `mil_spec_D38999_24WJ61SN`), both with invented names (R1P1 to R4P20) instead of the MIL-STD-1560 letters the
  harness uses ("w"). The standard letters and positions are already transcribed in the repo from MILNEC
  p. B-22 (`scripts/generate_connector_build_sheets.py`, `CAV_XY`). No GT150 2-way layout exists.
- Parts: the wire-end table carries nine catalog keys and fills none. `catalog_parts` holds M22759/16-22 in solid
  colours only (no -42 yellow/red), the M800-KIT-N Superseal kit and a GT150 2-way female housing (15497399), but not
  the D38999/24WJ61SN receptacle, the /26WJ61PN plug, the M39029/56-351 and /58-363 contacts, the GT150 terminal
  12191818 or seal 15366021.
- Catalogs: eight parallel tables hold parts (`catalog_parts`, `parts_catalog`, `part_catalog`,
  `intelligent_parts_catalog`, `ebay_parts_catalog`, `wire_catalog`, `electrical_system_catalog`, `tool_catalog`).
  `catalog_parts` is the one the harness foreign keys point at.
- Lengths: one 4.6 ft zone estimate for the whole wire; never split at the firewall. Each segment's planned length
  is unknown, with that reason, until routing exists.

**Step 2, in order.** (a) Name `catalog_parts` the part master for harness keys and record the other seven as feeders
or retired, through `schema_proposals` (no data moves in this step). (b) Library repairs from cited sources: the 25-61
insert once, with standard letters and positions from MILNEC p. B-22; a GT150 2-way layout; one cavity-naming rule
for housings (molded numbers) with the ECU's A/B labels mapped at the instance. (c) Catalog rows for #110's missing
parts, each with its supplier page as source and no price. (d) #110 itself: signal, net, two segments mated at cavity
w, every resolvable key filled, every unresolved one held with its text and reason. (e) Parity: the legacy query and
the new rows return the same four wire ends; the diff is published with the change.

#### 13.12.3 RSI passes 1 to 45: the model measures itself and fills its gaps (lead, 2026-10-14 to 16)

Owner, on the reshape: "a bit light ... data model goes rsi". The loop each pass ran:
1. Read the stack SH scoreboard (`v_harness_coverage`, per public vehicle and layer).
2. Take the largest gap that existing evidence can close.
3. Close it with a migration and a PG17 contract test.
4. Re-measure live as a logged-out reader.

Every pass has a receipt in `docs/wiring/receipts/` dated 2026-10-14.

| Pass | Migration | Gap (before) | Evidence used | After (live) |
|---|---|---|---|---|
| 1 | 20261014113000 | no field-level evidence, no design state, options at plug grain only, no protection, no self-measurement | 783 k5-wiring observations; device_pin_maps; endpoint couplings | 450 decided / 138 candidate / 50 contradicted segments; 1,066 option links; 57 protected nets; 798 evidence links; stack SH + scoreboard |
| 2 | 20261014123000 | cavity keys 0 / 884 | MILNEC 25-61 transcription (rings checked 1/6/12/19/23); MoTeC 65044 / 65045 | 295 / 884; 121 cited cavity rows |
| 3 | 20261014133000 | baseline and residual missing | 65 factory-circuit facts landed through ingest-observation | factory rows keyed 27 / 62; carried 5, unassessed 13, baseline gap 23 |
| 4 | 20261014143000 | 4 of 28 build-cited GM numbers unnamed; cavity and PDM keys unreadable to the public | ST 352 78 Circuit Tabulation pp. 8-11 (generated rows) | 129 circuits added (348 in all); 139 agree, 6 conflict; build-cited GM circuits named 28 / 28; cavity library and PDM tables readable to a logged-out reader |
| 5 | 20261014153000 | one net joined battery + and a PDM output to ground | the fold's own node rule, stated as data | net GND-BANK-CAB superseded, 16 nets added (400 live); supply joined to ground 0 / 400; design loads on 12 nets (battery + 180 A, peak 200 A); protection unchanged at 57. The cab ground bank's return to the engine star now waits with the DC primary (its engine end is a PS-STUDS row) |
| 6 | 20261014163000 | terminal keys 27, tool keys 211 / 884 | the build catalog (parts.yaml, tools.yaml) | 102 catalog rows added (27 already present); terminal keys 494 / 884, tool keys 403 / 884; key_harness_wire_ends() |
| 7 | 20261014173000 | planned lengths never checked against geometry | twin positions on 98 plugs | 132 / 638 segments with both plugs positioned; 4 of the 15 with a plan are planned shorter than the straight line (PDM30 to Dakota VHX); harness views revoked of public write grants |
| 8 | 20261014233000 | no record of any build step; the public key could write build_state (closed first, 20261014193000) | the build_state column's own transitions, logged by trigger | append-only harness_build_events; 0 / 390 decided wires with a recorded step (nothing cut yet) |
| 9 | 20261014234500 | Deutsch DT/DTP plugs had no cavity layout | stored customconnectorkits pages for DT 2/6/8/12-way and DTP 2/4-way | 49 / 49 Deutsch ends keyed; cavity keys 344 / 884 |
| 10 | 20261014235500 | measures carried no unit; the owner could not see the scoreboard | the measures themselves | a grain on every measure; owner MODEL tab on the wiring page |
| (re-plan) | 20261015001000 | four PDM30 to Dakota VHX wires planned shorter than the straight line | the twin's L18 route, 43.4 in unpadded | 0 / 15 planned shorter; the cut pad stays downstream in the BOM |
| 11 | 20261015003000 | a loader run that supersedes a wire would strand its segments silently | the loader's own supersession links | resync fold, called by the loader after every run; 0 / 638 live segments on superseded rows |
| 12 | 20261015013000 | the route graph lived only in repo files; 132 plug positions were copied anchor coordinates, ten of them overtaken by the record | k5LandmarkPaths.ts and the landmark YAML; state rows 0ag, 0ah and section 4 | 51 live points, 12 fallen to successors; 7 of 32 branches standing; 435 / 884 wire ends at a node, 199 of them at a node not yet placed; 46 / 638 segments at standing positions; geometry check 0 / 3 |
| 13 | 20261015023000 | the PDM15 pin map was not MoTeC's (21 of 37 rows wrong, 24 pins missing); 13 / 63 PDM-fed wires sat on an output their design does not name | MoTeC PDM manual, printed p.43 (PDF p.46) | pin map per the manual; protection fold (pin, else the output the design names); PDM-fed wires off their output 0 / 63; protected nets 57 to 62 |
| 14 | 20261015033000 | wires landed in one pin were separate nets: 89 nets were pieces of 27 electrical nodes | the plugs' own cavity labels (case-sensitive: the 61-pin has F and f) | refold_harness_nets(); 338 live nets; 29 / 602 pin cavities shared |
| 15 | 20261015043000 | no programmed limit or cited load on any PDM-fed net | the registry's pdm_settings (39 outputs) | 40 channels; PDM-fed nets with a limit 20 / 39 and with a load 20 / 39; 18 / 40 outputs waiting on a cited current; 1 / 40 in conflict; nets with a load 12 to 32 |
| 16 | 20261015090000, writer re-issued 20261015093000 | the design's splices were not in the model, so 29 shared pins could not be told from crowded contacts | the registry's splices | harness_splices and members, loaded by the loader; shared pins with no splice the design names 29 / 29 to 0 / 29 (0 / 30 after pass 19); 144 / 148 conductors keyed |
| 17 | (generator) | the registry could not be rebuilt from main (four inputs off main), so design changes were hand-patched | the generator's own inputs, copied in | a fresh main checkout rebuilds k5_registry.json byte-identical; #1238's hand-patched wires now agree with their BOM and readiness |
| 18 | (generator) | 11 device terminals held several wires with no splice in the registry, though each device is marked a splice point | the endpoints' splice_point marks and open notes | 12 device-terminal splices listed (37 to 49): 7 with a MiniSeal part, 5 past the largest cavity with none; a 10 AWG zero-area bug in the sizing fixed |
| 19 | 20261015100000 | 47 live wire ends of 21 decided wires sat on no segment (empty segments made before their ends existed), and no measure saw them | the wires' own live ends, by the reshape's rule | fill_harness_segment_ends(); wire ends on no segment 0 / 931; segments with both ends known 458 / 638 to 484 / 643; terminal keys 494 to 523, tool keys 403 to 418 |
| 20 | 20261015104500 (re-issue of 20261015103000) | the fill check used the AWG formula and the crimp tool's colour bands | TE/Raychem SCD D-609-03/-04/-05 (CMA ranges) and D-436-60/-61 (CMA per gauge) | TE's figures put 2 / 34 checkable sides over (M130-B B16 group 1 7,248 and PDM30-A A24 6,956 against D-609-05's 6,755 CMA), both closed by pass 21; 0 / 56 after |
| 21 | (generator) | 1 of 31 spliced pins named the lead into its contact, and splices were sized on the formula | TE's CMA figures; MoTeC PDM manual p.6 and p.48 (24-20 AWG on 8 A outputs); ProWire SSC-N (16-24 AWG) | every ECU/PDM pin splice names a 20 AWG pin lead; spliced pins with a named lead 1 / 31 to 19 / 31; B16, A24 and B8 split into groups; splices 49 to 53; sides the check cannot settle 31 / 64 to 12 / 68 |
| 22 | 20261015110000 | passes 2 and 9 keyed cavities inline, so ends added later were never keyed (344 to 340) | the rules of passes 2 and 9 | key_harness_wire_end_cavities(), called by the loader; 18 ends and 13 housings keyed on its first run; cavity keys 340 to 358 / 931 |
| 23 | (generator) | 18 of 40 PDM outputs had no cited running current | maker pages and manuals (Sanden SD7 p.14, E-Stopp kit page, RetroSound Motor 2B p.21, RVS mirror specs, MoTeC M130 page, Dakota VHX p.7 and GSS-3000 p.10) | outputs waiting on a cited current 18 / 40 to 12 / 40; PDM-fed nets with a load 20 / 39 to 26 / 39, with a limit 20 / 39 to 24 / 39; outputs in conflict 1 / 40 to 3 / 40 (the A/C clutch on 20 AWG; the radio on its 15 A maximum, which a bench figure closes) |
| 24 | (generator) | the A/C clutch's cited 4.2 A needs a 6 A limit that its 20 AWG feed cannot carry, and MoTeC wants 24-20 AWG on an 8 A output | MoTeC PDM manual p.6, p.43, p.48; the treatment #64 got in round 4 | #23 moves to PDM15 OUT8 with two 20 AWG pigtails into an M81824/1-2 and an 18 AWG run; outputs in conflict 3 / 40 to 2 / 40. The load also showed that wires the loader adds get no segment (wire ends on no segment 0 to 1; segments on superseded rows 0 to 1): pass 25 |
| 25 | 20261015150000 | a wire the loader adds gets no segment (the clutch's pigtails, pass 24), and no measure counted decided wires without one | the reshape's rule over each wire's live ends | conform_harness_segments(), called by the loader; decided wires with no live segment 0 / 392; segments on superseded rows 1 to 0 / 645; wire ends on no segment 1 to 0 / 935 |
| 26 | (generator and loader, #1623) | the leads into 19 spliced ECU/PDM pins were words in the splice rows: no wire row, cut length, BOM feet or member key (splice members keyed 147 / 178); the pin's wires were modelled as ending in one contact | TE: one conductor per Superseal cavity; the PDM pigtails' pattern (a splice node and implied wire rows) | each pin splice is a node SPL-<plug>-<cavity> where its wires end; 25 lead wires (19 pin, 6 group; M22759/32 20 AWG, 4 or 6 in staggered, the system's call); splice members keyed 178 / 178; decided wires 392 to 417, all on segments; pin cavities shared by several wires 30 to 11. The load dropped cited ends 88 to 51, factory nets 33 to 26 and topology ends 446 to 398: pass 28 |
| 27 | 20261015170000 | #86 read "protected by OUT17" though its design feeds it from OUT18: #85 and #86 parallel PDM30 OUT17 and OUT18 at the dimmer, the model held one output per net, and the net's limit read 4 A | MoTeC PDM manual p.6, pp.22-23; registry pdm_settings (4 A each; 20 AWG cap 8 A) | harness_nets.protection_pdm_channel_ids; a net's limits and distinct loads add over its outputs; PDM-fed wires not protected by their output 1 to 0 / 63; the dimmer net 4 to 8 A, 2.95 to 5.90 A |
| 28 | 20261015180000 | rules that ran once missed what the loader adds: citations stayed on superseded wire ends, 26 plugs had no node kind, and the new nodes never keyed to the route graph | the reshape's node rule; the citations themselves | classify_harness_endpoint_nodes() and carry_harness_termination_evidence(), called by the loader; cited ends 51 to 88 / 985 (279 links to 55 ends); factory nets 26 to 33 / 337; topology ends 398 to 490 / 985 |
| 29 | (generator, #1639) | woofer 2 was jumpered off woofer 1's push terminals: two 10 AWG wires in a terminal JBL rates for one 14-8 AWG wire, and no MiniSeal takes 10 AWG | JBL Club owner's manual (push terminals 14-8 AWG); JL VX700/5i guide ("two pairs of wire leads ... connected in parallel inside the harness") | woofer 2 on the amp sub harness's second pair (#30c/#30d), jumpers retired; splices 54 to 52; device pins waiting on a lead 12 to 10 |
| 30 | 20261015190000 | segments made after the reshape got no wire-part key and no option link (both written once, by the reshape and pass 1) | the catalog's exact M22759 parts; the plugs' option couplings | key_harness_segments(), called by the loader; wire-part keys 398 to 427 / 670; option links 476 to 531 / 670 |
| 31 | 20261015200000 | the M130 and PDM30 points stood with no coordinates, and nothing could write one (254 / 985 wire ends unplaced) | a headless-Blender free-space study of the twin (research/2026-10-15_m130-pdm30-cab-placement.md): the firewall face is full of pedal and column, the dash underside left of the column fits both | M130 (0.55, -1.22, 0.987) and PDM30 (0.30, -1.30, 0.997) proposed in mounts.yaml, medium-low confidence; load_harness_topology_points; unplaced ends 254 to 44 / 985; segments with both plugs standing 46 to 143 / 670 |
| 32 | 20261015210000 | the node-kind and citation folds matched a plug by row id, so a re-inserted plug lost its citations (88 to 85) and would take the generic kind (PS-STUDS or MARKER-LF as a bus would join supply to ground) | net fold v2's evidence-set kinds | both folds follow a plug by code, evidence-set kinds first; cited ends back to 88 / 985 |
| 33 | 20261015220000 | routing 0 / 670: the June branches fell with the overtaken points and nothing could write a branch or a routing | a twin route study (research/2026-10-15_route-branches.md): 39 branches, 9 junctions, 536.5 in, the 61-pin the only crossing, 88 mm or more from exhaust | load_harness_branches and route_harness_segments (shortest chain), called by the loader; routed segments 0 to 121 / 670 |
| 34 | 20261015230000 | 106 of the 121 routed segments had no planned length, and no check compared a plan with its route | the routes; K5_WIRING_STATE row 33 pads (1.20 engine, 1.15 body) | plan_harness_segment_lengths and the check "routed segments planned shorter than their route (must be 0)"; planned segments 268 to 374 / 670; the check 0 / 121 |
| 35 | (generator, #1671) | 368 of 670 segments could not route: 124 plugs had no position | a headless-Blender study of the twin (research/2026-10-15_device-positions.md): bounding boxes, split lamp meshes, ray casts | 119 end positions in mounts.yaml, loaded as route-graph points. The load stopped half-way at a branch-key clash (pass 36); its tail folds ran by hand |
| 36 | 20261015240000 | the point writer re-rowed a point on new words alone, so a branch kept the old id and the history-wide key refused it; the loader stopped before routing | the pass 35 failure | points re-row only when they move; branches re-link in place; the loader's end folds all run and it exits non-zero after |
| 37 | (generator, #1689) | PS-STUDS was one node for nine studs, so every DC primary cable shared one point | the power-spine records (chapters/17, the DC primary sheet) | nine stud nodes; each cable end on its stud; endpoints 203 to 212, wire ends 993 to 999; supply-to-ground 0 / 328 |
| 38 | (generator, #1690) | 196 placed plug pairs had no branch chain | a second twin route study (research/2026-10-15_route-branches-2.md): 116 branches, 16 junctions | routed segments 125 to 397 / 669; planned 375 to 587 |
| 39 | 20261015250000 | 14 of 397 routed segments were planned shorter than their route, all cut-list estimates copied unpadded; 207 of 417 registry wires had no length | the live routes, exported to inputs/route_lengths.json | the planner pads estimates and gives way to a longer route; the registry takes one-segment routes: 120 wires gain a length, 14 short ones rise; the check 14 to 0 / 397, plans shorter than the straight line 9 to 0 / 424 |
| 40 | (loader + generator, #1698, #1700) | "AMP CH1+" matched no plug, so 26a/26b/27a/27b started at the door and chained back through the amp (26a summed 28.2 ft) | the registry's start text | the start resolves by its first word and the 4 wires re-chain AMP, door, speaker; through runs (one path whose interior plugs are crossings) take their summed route: 72 more wires, 81 of 85 multi-hop wires eligible; the 4 buses wait |

**W| 41 | 20261015260000 (#1702) | 106 Deutsch and MIL-splice wire ends had no crimp tool; the loader wrote an end once and read at most 1,000 rows (999 live ends) | ProWire's HDT-48-00 and MiniSeal pages (saved through fetch_sources.py) | tools mapped, two catalog rows, the loader pages and re-writes changed ends; ends keyed to a crimp tool 475 to 581 / 991 |
| 42 | 20261015270000 (#1705) | 354 wire lengths said nothing about what they were, so the planner called pin leads and twin paths zone estimates; the 32 PDM pigtails had no length | the registry's length kinds; the pin leads' design rule (pass 26) | planned_length_kind and _basis on the wire, the planner names the kind, the pigtails take 4 and 6 in; planned segments 587 to 620 / 669 |
| 43 | (generator, #1726) | 56 segments sat on an unplaced plug, 7 of the 8 open plugs on the engine; the twin's engine was said to sit 15 cm into the cab | three owner photos triangulated against the true-size engine_ls3 model (research/2026-10-15_engine-position.md) | the engine is where it is (the v2 block box was GM's 710 mm misread); 34 engine ends placed on the corrected engine, 22 branches redrawn, 19 added; a shortest-path walk joins 443 / 443 placed segments |
| 44 | (generator, #1729) | 93 of 443 routed segments ran over 2x their straight line (about 246 ft beyond a 1.4x path): the 61-pin had no trunk across the firewall recess, so rear-of-engine wires went round the intake front | a fourth twin route study (research/2026-10-15_route-branches-4.md) | 27 branches and 2 junctions; live, segments over 2x 93 to 16 (each kept one with its reason), excess 344.8 to 164.5 ft |
| 45 | (generator, #1734) | the cut list still carried the routes from before the engine fix and the trunks | the live routes, re-exported | 82 wire lengths change, 63 fall by 79.2 ft as detours leave; BOM wire feet 1,461.5 to 1,426.4 |
hat the loop found that no one asked about:**
- **A short in the model.** It was found while folding loads. The reshape treated PS-STUDS (nine distinct studs) and
  MARKER-LF (a lamp typed ground) as single nodes. The scoreboard now carries the physics check "nets that join a
  supply to ground (must be 0)".
- **Factory baseline gaps.** The build cites 23 GM circuits that the factory baseline has no keyed row for. The
  baseline itself is thin.
- **Six colour conflicts** between the 1973 manual and the 1978 chart: circuits 22, 67, 225, 231, 232 and 234. They are
  recorded and not resolved.
- **Unreadable keys.** Row security was on with no policy on the cavity library and the PDM tables.
- **Impossible lengths.** Four wires from the PDM30 to the Dakota VHX were planned shorter than the straight line
  between their plugs. They were re-planned from the twin's L18 route (20261015001000). Pass 12 then showed L18's own
  PDM30 spot (twin assumption A2) was overtaken on 2026-09-29, so that plan's basis is stale. A driver-side PDM30 sits
  nearer the Dakota box, so the plan errs long.
- **The twin was overtaken.** Ten of its anchors were replaced by later rows of the record. The one 61-pin moved the
  firewall crossing to the driver fuse-box hole; the M130 and PDM30 follow it; the coils are on the central
  DEL-Stributor; the CKP is above the starter; the battery, alternator and O2 sensors moved. 24 of its 30 branches fell
  with those points. Pass 12 keeps them all, superseded, and counts a plug's position only where its point stands.
- **The PDM15 pin map was not MoTeC's.** It numbered outputs A1 to A15 in order. MoTeC's manual pairs the 20 A outputs
  across pins (OUT1 = A1 + A10) and puts the 8 A outputs between them.
- **Wires in one pin were separate circuits.** The fold joined wires only through bus plugs; 89 nets were pieces of 27
  electrical nodes. The 8 marker and clearance feeds on PDM30 OUT19 were 8 nets.
- **Paralleled outputs, on purpose.** PDM30 OUT17 and OUT18 meet at the floor dimmer's feed (receipt 2026-05-14). MoTeC
  allows outputs in parallel when they are one type and share one condition (PDM manual printed p.6, pp.22-23); both
  are 8 A outputs. MoTeC does not say how a trip on one behaves for the other.
- **An output that cannot carry its load.** PDM30 OUT21 (door locks) needs 12 A; an 8 A output's setting caps at 10 A.
- **The design record could not be rebuilt.** The registry's generator read four files that were not on main, so every
  design change since late September was a hand patch, and the BOM drifted from the wires.
- **The scoreboard was blind to ends off segments.** Every wire-end measure counted ends on live segments only, so 47
  ends the loader added sat unseen until pass 19 counted them.
- **Production refuses what the contracts allowed.** The production API refuses an UPDATE without a WHERE, even inside a
  function (pg-safeupdate), and stack_needs objects must be table.column. Both broke a first deploy; each now has a
  contract or a fixture constraint.
- **New wires get no segment.** The reshape segmented the wires that existed on 2026-10-14; a wire the loader adds
  later (the clutch's pigtails, pass 24) has no segment, and no measure counts decided wires without one.
- **A lead in words is not a wire.** The 25 conductors into spliced ECU/PDM contacts had no row, so no cut length, no
  BOM feet and no key; the 68 wires that share those pins were counted as crimped into the contacts. As wire rows
  they cost 10 ft of 20 AWG. Wire ends keyed to a cavity fell 359 to 308 for a physical reason: a splice barrel has
  no cavity.
- **One output per net hid a fault current.** The dimmer's net is fed by two paralleled 4 A outputs; the model read
  4 A where a fault sees 8 A, which is exactly the 20 AWG wires' cap.
- **A rule that runs once decays.** Node kinds (net fold v2) and citations (passes 1 and 3) were written by
  migrations; every row the loader added later missed them. Both now run after every load.
- **The twin's engine sits about 15 cm into the cab** (corrected by pass 43: it does not; its block box was GM's 710 mm
  outline, which runs from the ring gear to the water-pump inlet, so the box's rear face sat 13 cm behind the real block
  rear; the cylinders are within 8 mm of the photos). Its block rear is at y -1.30 against a firewall at -1.447 (route
  study), so the twin cannot settle anything near the rear of the engine; those branches are confidence low. Its
  iBooster also sits 20 mm above the 61-pin point: on the truck the two share the driver firewall, which needs a look.
- **The cut list's zone estimates run 4x the twin routes** (15 routed segments that carry one: average 4.0x, minimum
  1.88x). The estimates may be generous, or the twin may miss slack and service loops. Measured lengths settle it.
- **The cut list's zone estimates were not cut lengths.** 186 segments carried a wire's whole-length estimate as
  their plan, without the pad the column promises; 14 were shorter than their own route (#67 dome lamp 3.5 ft over
  11.29 ft). Pass 34's "4x" ran the other way: those 15 were the long ones.
- **A long route can be a missing branch.** After the engine fix, a fifth of the routed segments ran over twice their
  straight line; the shortest-path walk was right, the graph lacked the trunk a real engine harness has. Studies 3 and 4
  measured the ratio by hand; the scoreboard has no measure for it yet (owed: routed segments over 2x their straight line).
- **A start in words chose the wrong end.** The loader parsed "AMP CH1+" as no plug and started four speaker leads at
  the door, so their segments doubled back through the amp.
- **The crimp tool's colour bands are not the splice maker's ranges.** On TE's own figures two pin splices the formula
  passed are over D-609-05 (M130-B B16's first group, 7,248 against 6,755 CMA).

**Owed, as the scoreboard names it:**
- Routing beyond the placed points: after pass 43, 12 segments sit on an unplaced point (the battery, the driver O2
  sensor, the underhood lamp, and the open frame, head and firewall grounds); 62 join two plugs at one point. One tape
  on the truck (passenger firewall flat face to the passenger head's rear face) settles the engine's fore-aft position
  to 5 mm.
- Buses as trees: CAN_HI/CAN_LO and the door-lock buses are chained like runs; their length and the order of their
  drops is a design question the segment fold cannot answer.
- The DC primary's stud-to-stud topology. It waits on the power-spine re-draw.
- PDM limits still waiting on a cited load current: 12 of 40 outputs, most with no published figure; each status names
  the bench measurement that closes it (coil packs, starter solenoid, PCS ignition, blower, E-Stopp sense, iBooster
  wake, radio ACC, horn, camera, washer solenoid, USB charger input).
- Two outputs in conflict: PDM30 OUT11 (the radio's published 15 A maximum assumes its own speakers; a bench figure
  closes it) and OUT21 (door locks, 9 A needing 12 A on an 8 A output; the actuators stall while a rocker is held, so
  the pulse load wants a measured stall current before the 125 % rule is applied to it).
- The factory baseline's own completeness: 35 rows unkeyed and 23 cited circuits absent. The 1978 diagram pages are
  images.
- Cavity layouts for the families with none cited: GM 56-series blade, Metri-Pack, rings and kit terminals.
- The leads into device terminals the design splices (the dimmer, door jambs, blower, tailgate switches, subwoofer):
  the factory terminals' ranges are open. Five of those joins have no MiniSeal that fits (2 x 12, 2 x 14, 2 x 10 AWG).
- Answers only the makers can give: the Superseal seal range against MoTeC's own 22 AWG Tefzel; two wires in one
  Superseal contact; how paralleled PDM outputs trip.
- Measured lengths (the outcome).

### Recursive refinement: the original request must cross admission and readers (2026-10-11)

**Owner direction, in substance.** Discussion must in parallel shape PostgreSQL, documentation and the
Markdown methodology guiding the next agent. Artist, buyer and researcher are descriptions arising
from behavior, not fixed audience categories. A progress function or proposal is not the completed model.

**Bounded implemented case.** The existing engine-family proposal had a deterministic witness but no
supported admission path. The prepared migration `20261011230939_retained_engine_family_intake.sql`
extends existing PostgreSQL witness, tuple-validation and insertion functions, plus provenance output.
The Edge selector accepts only the retained source ID and derives its claim from that source. The
property must belong to the existing approved proposal and be ratified core vocabulary. A publisher's
label stays separate from `engine_code`, with literal quote, source fingerprint, microsecond clocks
and unknown engine identity/configuration/event time. No new table, stack entry, worker or replay is created.

**Local evidence.** `scripts/test-engine-family-intake.sh` uses PostgreSQL 17 and the actual Edge handler
with a narrow test transport. Both source and child enter through that handler. The unchanged selector
fails before registration, still fails after synthetic curator review against old SQL, then succeeds
after migration. Ten integrated steps verify actual anonymous provenance/canonical readers, same-ID
retry, withdrawal/supersession/visibility refusal, error refusal, twenty SQL/TypeScript witness cases,
preserved function attributes and idempotent reapplication. The existing intake suite reports 330
passing tests; the enforced local repository gate passes. This is not deployed HTTP/PostgREST proof.

**What the iteration corrected.** One reader called the inner value predicate, so the new registration
gate moved to the shared predicate. Duplicate lookup bypassed insertion checks, so success now calls
the existing result validator. Provenance output omitted identity/capture qualifiers, so those now
survive that reader too. Questions, general-model assertions and engine labels in another part of a
sentence were excluded from the family grammar. These observed failures refined code and methodology together.

**Delivery and population boundary.** Implemented and locally tested; production approval, merge,
deployment and runtime verification remain outstanding. The live proposal was still open on the
dated read. This pass changes production coverage by zero; total eligibility and fleet gain were not
measured. Automatic schema repair and the cross-domain behavior-to-role model remain unfinished.

**Integration refresh, 2026-10-15 UTC.** PR #976 was resumed against current main. Live definitions
showed newer native make/model admission and provenance qualifiers; the migration and disposable
baseline now preserve them. The real-handler contract tests make admission before the migration,
then make replay and model admission afterwards. Its service-call tests use the current secret-key
contract and refuse publishable keys, legacy HS256 tokens and authenticated users. A local attack
also showed that changing the family property's unit left one canonical claim readable; the shared
predicate now refuses unit, parent and discriminator changes, and duplicate intake rechecks that
same predicate. Existing testimony remains intact.

The PostgreSQL 17 integration passes twelve steps, and the intake suite passes 351 tests with its
opt-in integration test separately exercised. The enforced local gate passes. Read-only rechecking
the proposal's four original source IDs at 00:35 UTC retains one M50 candidate and three refusals;
these are original controls, not independent held-out accuracy or admitted production claims.

Population boundary: the live atlas at 00:28 UTC estimates 1,014,519 stored vehicle records; public
and engine-family-eligible totals remain unmeasured. Four source controls do not establish fleet
coverage. Net newly usable production answers from this refresh: zero. The production proposal is
still open; merge/deployment authorization and curator ratification remain separate held steps.

### Live-market classifieds: what "ended" means (lane-live-market, 2026-10-15)

A classified listing (Craigslist) has no close and no reserve. While the page reads, `vehicle_events.event_status` is
`unknown`. When a revisit gets HTTP 404 for the post (measured 2026-10-15: posts from 2025 return 404 "Page Not Found"),
the listing is `ended`, `ended_at` is the fetch time, and `metadata.removal` holds the evidence. That says the listing
is gone, withdrawn, expired or sold off-site; the outcome is unknown, never a sale. A listing that scrolls off the first
page of a search is not removed (only the first page is read), so absence from a search page is not evidence. The
revisit rule (a landed post still on a search page is read again after 24 h) is the clock for this. A blank-model post is
kept as an unresolved listing observation (`vehicle_id` NULL) and is not retried as a failure.

### Facebook listings reach the graph the way Craigslist posts do (C16 follow-up, prepared 2026-10-19 UTC)

**The question (owner, 2026-10-18 22:20 PT).** Is the incoming Facebook Marketplace data landing smoothly and going from
snapshot to deeply integrated? Is it on the Sources board and the map? Can a user click through to the listing? Is the
seller kept?

**Measured before the repair (2026-10-19 ~05:30 UTC, bounded reads).** Custody was sound: the iMac Playwright runner's
packets (61 search passes over ~30 metros on 10-18/19, 0 errors) each kept their raw batch in `fb_sweep_jobs` and one
sighting per listing in `fb_listing_sightings`. Integration was not:
- Population: `marketplace_listings` 117,546 rows (111,644 with a `vehicle_id`, almost all from the retired collectors).
  New in 7 days: 1,803, all `fb-browser-capture`; 91 linked (5%), and every recent capture receipt said
  `linked_observations: 0`.
- Cause 1, identity: search cards carried `parsed_year` only, and `linkToVehicle` returns before matching without a make.
  The shared title parser (`ingest/vehicleTitle.ts`) resolves year, make and model on 1,846 of the 1,871 titles first
  seen in that window (98.7%); the rest state no model ("1984 Porsche") and stay unresolved.
- Cause 2, events: the capture path wrote no `vehicle_events`, so the Sources board (`market_sources_read` counts
  listing events by hour) showed Facebook landed 24 h = 0, 7 d = 91, last landed 10-15, while 918 and 1,803 listings
  arrived. The 91 were a one-off `ingest` pass on 10-15.
- Cause 3, ingest overwrote testimony: for a Facebook URL `ingest` upserted `marketplace_listings` on `facebook_id`,
  replacing the captured title, description, seller name, image and `first_seen_at` with its own fields and NULLs.
- Detail pages: of 133 retained listing pages, the "About this vehicle" block states mileage on 128, transmission 128,
  exterior color 128, title status 47, owner count 32; the landed rows held mileage on 3 of 1,803.
- Photos: a listing page's `all_images` also held the "Today's picks" tiles of other people's cars (median 29 captured,
  10 the listing's own); 0 of 117,546 `image_url`s were in storage, and Facebook CDN links expire within days.
- Seller: `seller_name` text on 121 of 1,803; no profile id captured; `external_identities` held 0 facebook rows
  (697,279 bat). `marketplace_listings` has no row policy, so anonymous readers get no rows; `external_identities` and
  `vehicles.seller_name` are publicly readable.
- Map: `/map` and `/atlas` read organizations and `vehicle_location_observations`; that table held no Facebook rows.
  1,449 of 1,804 recent "City, ST" locations match `city_geocode_lookup`.

**The repair, in the existing owners.**
- `extract-facebook-marketplace/listingFacts.ts` reads each packet's own text: identity from the title (Facebook's form
  suffixes such as "Coupe 2D" and "Long Bed" read off first), the About block, the seller block's counts, the listed
  label, and the gallery (center-cropped picks tiles, avatars and ad creatives dropped). Fill-only; the facts and
  `fb-listing-facts-v1` ride in `raw_scrape_data.listing_facts`.
- `integrate.ts`, after the custody receipt: a titled unlinked listing goes through `ingest` (VIN/URL match, gate, new
  `discovered` vehicle or merge proposal, the classified listing event); a linked one lands its listing event at the
  capture clock; a revisit's removal ends the event (outcome unknown); the place lands as a city-grain
  `vehicle_location_observations` row; photos copy through `backfill-images` with `run_analysis: false`; a profile id
  becomes `external_identities ('facebook', id)` with no display name, keyed from
  `marketplace_listings.seller_identity_id`. Saved-items batch mode is not integrated (held privacy PR #1421).
  The receipt joins the capture's `fb_sweep_jobs.metadata.integration`.
- `ingest` links an existing `marketplace_listings` row and never rewrites it.
- The runner (repo copy) sends the seller's profile link and drops photos inside links to other items; the iMac copy is
  owned by its own agents and adopts this separately.
- `map-vehicles` points carry `source_url` and `asking_price`; the pin panel shows the asking price and opens the listing.

**Acceptance.** A new capture's `metadata.integration` shows created/matched vehicles and listing events; the Sources
board's Facebook landed counts follow the arrivals; `/atlas?source=facebook_marketplace` shows the new points and the pin
opens the Facebook listing; a seller key appears only where a profile link was captured. Disagreement case: a title
without a model stays unlinked and is counted `unresolved_identity`. Stages (implemented, tested, merged, deployed,
runtime-verified) are recorded in the PR and the lane log.

**Delivered 2026-10-19.** #2122 (column) and #2124 (writer, ingest, map) merged and deployed 06:17Z; #2133 (card photo
for imageless vehicles) 06:44Z. Runtime-verified on live packets: 06:21:52Z 50 cards gave 40 vehicles, observations,
map rows and photo copies, with 9 deferred by the source_intake ceiling of 40; 06:22:22Z 31 cards gave 30, 0 errors. A
bounded replay (`mode: "integrate"`, 77 calls of 25 ids) over the 1,909 capture-era unlinked listings created 1,805
vehicles, 1,805 observations and 1,697 map rows, left 22 unresolved (no model) and had 0 errors; it added no sighting or
submission count. Population after, first seen since 2026-10-12, measured 06:53Z: 2,066 listings, 2,029 linked (98%),
2,029 with a listing event, 1,820 with a map row, 209 with a stored photo (replayed rows held no image; their next
sighting copies one), 28 unlinked active, 9 unlinked inactive; 28 merge proposals filed, none auto-merged. Sources board
Facebook landed 24 h: 1,938 (this day includes the replay, which the board dates by event creation). Seller identities:
0, waiting on the iMac runner adopting `seller_profile_url`. Not in scope: the 111,644 older linked listings and the 513
older seller ids (replaying them would present phantom actives as live listings).

### 13.13 A listing rises by what it is: the classified merit stack (owner, 2026-10-15)

**Owner direction, in substance.** The arrivals feed is led by Craigslist "not cuz its good but cuz its easy. its
boring to look at. that needs to be expressed in the very thread of the dna." Saying the listings are bad gets nowhere;
the goal is to define in Postgres (keys, foreign keys, folds, larger group cross-analysis) the difference between a 1967
Corvette for $22K and a 1971 Buick for $5,500, so leads surface "preference / hard code agnostic. they rise by way of
what they are." The human explanation: a sick listing sells fast, "but not for us": the why has to be factual, with
citation. Same night (to skylar-83): the benchmark is Barn Finds' "good deal, snatch this up", and the visualizer should
teach the market by saying where each listing sits in our price analysis.

**What was there.** The feed (`classified_ask_board`, Market tab "Just listed") ordered newest first, with a "band" sort
on `compute_taste_score`: hand-typed weights (Chevrolet 40, Blazer 25, a Las Vegas bonus of 5). That is the hard code the
owner names. Every row on 2026-10-15 was Craigslist (1,158 events since 10-13), because Craigslist is the one classified
source landing listing events; 136 Facebook listings landed on 10-12/13 with no vehicle bound and none since.

**The stack, layer by layer.**

| Layer | Object | Grain, key, clock | State 2026-10-15 |
|---|---|---|---|
| Log | `vehicle_events` (classified listings), `marketplace_listings` (Facebook sweeps), `mv_treemap_outcomes` (recorded sales) | one listing / one recorded outcome; created_at / first_seen_at, sale_date | existing |
| Key | `mv_model_family_names.family_id` (#1317, skylar-83) | make and model name -> canonical_models family, year range +/-1 | 494,210 of 681,551 public vehicles keyed |
| Dimension | factory model family x model year | canonical_models | existing |
| Fold / baseline | `mv_family_year_prices` (#1375) | family x model year x basis (sold, asked); narrowest 0/1/2/3/5-year window holding 10 prices, cited; conflicts counted | created empty; first build by the 09:40 UTC cron (load, see below) |
| Residual / feature | `classified_ask_board.position` (#1382) | per listing: at_or_below among sales and among other asks, p25/p50/p75, n, venues, share; `position` sort | merges after the first build |
| Prediction | `classified_ask_board.merit` from the active `listing_exit_models` row (#1380) | P(gone within 7 days of first sight) | no active model: the exit test failed (below) |
| Outcome | `v_classified_exit_outcomes` (#1380) | per listing: first seen, last seen, exited_at, region, fate_7d | Facebook 3,777 exits Feb-Jun; Craigslist revisits from 10-15 (5 per 15 min) |

**The identity guard (a raw-vs-model test inside the fold).** Of 469 recorded 1967 Corvette sales (model strings
beginning "corvette"), 34 have their own source page naming a different car: Camaros, Chevelles, Impalas, a C10, a Nova,
El Caminos. Of the six recorded at $22K or less, three are other cars (a C10 at $10,999, a custom sport truck at $3,450, a
Mecum Chevelle at $16,000) and two are real project coupes ($16,500, $20,250). The fold refuses a sale whose page names its
model year but not its family and counts it in `conflicts`, so the defect is measured fleet-wide and a cheap ask is not
flattered by mislabeled sales. A page counts as naming the family if it carries any of the family's canonical_models
phrases (name and aliases, 3+ characters): the first rule, the alias the name matched, refused 535 of 548 Wrangler sales
whose pages read "2000-jeep-wrangler-82". Across 1962-72 the refused "Corvette" pages read Impala 38, Camaro 32, Chevelle
16, Corvair 12, El Camino 10, Bel Air 9, Nova 7, Biscayne 7, C10 8. The record repair is the vehicle-identity owner's
(supersession of `vehicles.model`). This stack realizes registered stacks SC (liquidity as an option) and S10 (liquidity
surface) for classifieds; registering its needs in `stack_needs` is the next registry step.

**The two cars, read with the fold's rules** (bounded reads 2026-10-15 ~04:50Z; the fold's first build is the
authority). A 1967 Corvette asking $22,000: 435 recorded 1967 Corvette sales (Bring a Trailer 243, Mecum 37, Gooding 16,
other 138), median $93,000 (p25 $70,641, p75 $132,000); 4 of 435 sold for $22,000 or less, so the ask sits under 431 of
them, $71,000 below the median, in a single model year. The 1971 Electra 225 asking $5,500 (Sacramento, Craigslist): 17
recorded Electra sales across 1969-73 (the window had to widen two years either side), median $17,500 (p25 $12,750); none
at or below $5,500. Both asks sit at the bottom of their family's sales; what separates them is depth (435 sales in one
model year against 17 across five), the dollars between ask and the middle ($71,000 against $12,000) and the multiple
(4.2x against 3.2x). Among Facebook asks first seen in the last year the Corvette sits 5 of 16 (1965-69, median $31,250)
and the Electra 4 of 10 (1968-74, median $8,000): a classified ask against auction sales mostly measures venue.

**The owner's acceptance case** (skylar-83, his read of the top three in the feed, 04:15Z). 1965 Barracuda $29,500, "top
dollar": 11 of 14 recorded 1965 Barracuda sales at or below, above the p75 ($28,375). 1999 Wrangler $14,000 at 178,000 mi,
"right in the middle": 24 of 51 recorded 1999 Wrangler sales at or below (median $14,500), and 45 of 46 Facebook asks
(median $5,500), so expensive for a classified. 1995 GMC K1500 $3,500 at 300,000 mi, "busted up": 6 recorded K1500 sales
across 1990-2000 and 2 asks, so no position; GMC and Chevrolet K1500s are separate families today (a badge-twin gap in
the key layer), and mileage is not a feature yet.

**The exit test (the "sells fast" claim, measured).** Facebook listings keyed to a family with a known 7-day fate,
restricted to the five weeks the removal sweep ran (2026-02-23, 03-02, 03-23, 03-30, 06-08; in other weeks only survivors
have a known fate): 1,743 listings, 339 gone within 7 days (19.4%). Of those, 952 sit among 10+ earlier asks of their
family (point-in-time, another vehicle, the fold's window rule). Train before 03-30, test after: position among asks gave
a held-out AUC of 0.501 +/- 0.031 (price alone 0.541 +/- 0.028); the exit rate by ask position ran 23.1%, 21.7%, 17.6%,
25.1%, 16.1% from the bottom fifth to the top. On this label, where an ask sits among its family's asks does not predict
that it is gone in a week, so no `listing_exit_models` row is active and `merit` stays null. The label is weak (missing
from a later sweep is not a sale) and small; the next tests are the sale position once the fold is built and Craigslist
404 exits as they accrue. Scripts and the result: `scripts/stacks/classified-exit/`. Until a model beats chance on held-out
exits, the feed's factual order is `position` (the share of the family's prices at or below the ask, lowest first): one
measured quantity, labeled as what it is, never as "best deal".

**Load, measured.** Production estimates the family join at 1 row (it is ~400,000), and with nested loops the planner
paired every year row with every target year: a 0.5% sample ran past 10 s. Built without nested loops it reads `vehicles`
once (parallel seq scan) and merge-joins on the family; the same query over 170,252 sales and 111,553 asks took 0.84 s on
PostgreSQL 17 locally. Intake lanes were writing at deploy time (skylar-f7), so the view is created empty and the first
build is the 09:40 UTC cron.

**What is still missing.** Condition: the price follows condition, and condition comes from photos; 0 of 690 photos on 60
recent Craigslist cars carry a condition read, so seller-declared condition (an attributed claim, `condition` on the
board) is the only input until the on-demand Analyze path exists. Venue: a classified ask against auction sales mostly
measures venue and condition, which is why the ask-vs-asks position leads and the sale position follows. Facebook
classified listings do not reach the board (no vehicle binding since 10-13). Craigslist exits accrue at the revisit
sweep's rate (5 posts per 15-minute run). Mileage is not yet a feature.

### Work-order resource evidence — owner direction and executable first slice, 2026-10-19

Owner direction: build the data model beneath inspection, job planning, provider tools,
shared facilities, scoped sign-offs and contributions. Historical messages, images,
receipts, invoices and payments are retained evidence for reconstructing real jobs;
their full linked population and replay coverage have not been measured. A missing
resource should permit alternative supplying arrangements rather than disqualifying
the performing mechanic automatically. Ownership, access, capability, availability,
approval and compensation are separate relationships.

The live atlas and column inspection found existing owners in work_orders,
work_order_line_items, work_order_assignments, user_tools, tool_inventory, equipment,
organizations, actor_capabilities and the observation logs. A tool verification boolean
does not carry a scoped attestation; an assignment's payout fields do not establish an
equipment reservation. The resource relations did not exist at inspection.

The implementation in migration `20261019005027_work_order_resource_evidence.sql`
adds three private typed indexes of existing work_record testimony: operation requirements,
candidate resource arrangements, and reported scoped attestations. Source IDs key every
row; no raw source writer or duplicated identity/invoice/payment ledger is introduced.
The service-only projector validates the source and same-job relationships. The service-only
reader excludes superseded/reattributed source chains and keeps unknown coverage explicit.
Details and payload contract: `docs/library/technical/work-order-intelligence.md`.

Acceptance is the actual migration on disposable PG17: personal-tool and shop alternatives,
source-to-graph reads, duplicate replay, cross-order/source/type refusals, immutable projections,
withdrawal/reattribution propagation and anonymous/authenticated access refusals. This tests
the supplied cases; it does not measure historical-job coverage or certify physical work.
Provider authority, authenticated sign-off, reservations and conflicts, compensation settlement,
historical replay, end-user exposure and historical source reconstruction remain to implement.
No empty or populated graph declares a booking ready. Deployment is a separate stage and must
be checked against the live function and relation definitions after the normal CI release.


Historical resource reconstruction follow-up (2026-10-19): bounded retained-message
inspection found explicit work requirements without resource quantities, and legacy
message observations lacking source_id. Migration `20261019013808_work_resource_retained_basis.sql`
allows a paired unknown quantity/unit and links interpretations to the original observation
and exact excerpt. Admission preserves the original clock, validates same-vehicle custody,
and refuses nested resource interpretations. Original withdrawal/reattribution propagates
through current reads and duplicate projections; the original testimony is untouched.
The disposable contract covers these cases and private source visibility remains unchanged.
A selected historical case is validation scope; neither its requirements nor the complete
historical-job population has been exhaustively enumerated. No candidate, permission,
booking readiness, reservation or payment is inferred from these requirement records.

Participant follow-up (2026-10-19): inspection of actors, actor_capabilities, technicians,
assignments and identity bridges found a canonical actor reference on a selected retained
operation, but no supported account bridge or proof of qualification. Migration
`20261019030510_work_resource_actor_candidates.sql` extends the existing fulfillment
owner with an actor alternative for skill/inspection and an optional exact operation
snapshot. The supplier remains separate and can be unknown. Existing internal-inference
intake identifies derived evidence; it does not impersonate a provider. Changed operation
bases withhold current descendants without deleting history. The reader carries method,
confidence and unresolved source interpretation, including process disagreements.
Disposable PG17 exercises participant alternatives, inspection, type/identity refusals,
snapshot custody, stale-basis propagation and the unchanged private access boundary.
This selected case does not establish broader historical coverage, accepted terms,
authenticated approval, capacity reservation, completion or payment accounting.

Image-object connection (2026-10-19): owner emphasized every background object occurrence,
entity endpoints, separate cost/value claims and the eventual calculation of labor value.
Live inspection found retained canonical tool/component arrays, an equipment ledger and
legacy per-image equipment evidence. Old cascade code resolves names globally and can
convert photo visibility into estimated minutes; those claims cannot be silently treated
as measured use or a physical-instance identity. Migration
`20261019031934_work_order_image_objects.sql` adds a private bounded job-context reader
over existing observations, preserving source pointers, repeated appearances and clocks.
It joins existing image/equipment associations while separating recorded purchase cost,
computed depreciation value and unknown market/job/labor values. Current source and image
qualification gates apply. The disposable PG17 contract covers custody, pagination,
malformed evidence, privacy and refusal to accrue usage/value. This connects retained
evidence without a new observation ledger, photo processing, paid inference or canonical
asset minting. Full image coverage and a physical-object identity resolver remain unmeasured
and unimplemented respectively; vehicle context does not establish operation usage.

Work-specification connection (2026-10-19): owner direction that material and process belong
together in the work specification, not in a free-standing provider qualification judgment.
Live inspection of the selected case found three disagreeing accounts already retained: the
requested scope quote, installed part records (graded and ungraded stainless, a stainless TIG
filler) and the operation's component event (mild steel with MIG). Parts carry no typed
operation link, and cost subsets matching the operation total were not unique, so part
supply cannot be assigned to an operation by inference. Migration
`20261019035407_work_order_resource_specifications.sql` adds a `specification` event to the
existing resource projector and an immutable private table. Each claim records a stage, role,
verbatim labels and dotted interpretation keys; its basis is a retained excerpt or an exact
component-event or part row snapshot. The existing reader compares requested pairs with
current claims by role and key and reports a conflict without adjudicating substitution,
qualification or completion. Changed, withdrawn or reattributed bases withhold claims; history
remains. Disposable PG17 covers 57 specification cases and reruns the 88 existing resource
assertions against the new projector. This is one selected case; the specification population
of other jobs is not assessed, and accepted scope changes, measured usage, completion and
compensation remain open.

Mechanics RSI pass 1, job-path scoreboard (2026-10-19): owner direction "rsi" applies the
measure → largest closable gap → migration + PG17 → re-measure loop to the mechanics job path.
The job path had no self-measurement. Migration `20261019045753_work_order_job_path.sql`
adds a private read-only reader per work order and a population scoreboard over existing
owners, reporting stage states, gaps and status/clock/record inconsistencies without repair.
Before (live, 2026-10-19 04:56 UTC, denominator all 26 work_orders rows): 22 vehicle-bound;
operations itemized on 2; resource requirements on 2 and specifications on 1; installed parts
on 2, parts with an operation code on 1; assignments on 1 (9 rows, none with an accept clock);
labor rows on 3; start clocks 5; completion clocks 7 against 10 done/paid statuses; payment
records on 3, including one without a vehicle; a paid status with no payment record; 15
vehicle-scoped payment events with no job attribution; no approval clock and no payout record
anywhere. Next passes take the largest gap the retained evidence can close; readiness,
acceptance, usage and labor value stay unassessed until evidence supports them.

Mechanics RSI pass 2, requested operations (2026-10-19): the pass 1 scoreboard's largest gap was
`no_operations`, 24 of 26 work orders. Retained evidence for those 24 is mostly prose summary;
one quoted work order itemizes its scope line by line, and one completed order holds labor-task
rows the scoreboard did not count. The operations owner, `work_order_line_items`, had no
provenance or sanctioned insert path, and billing reads only priced lines. Migration
`20261019051336_work_order_scope_operations.sql` adds provenance to that owner and an `operation`
projection that quotes the work order's own text verbatim into pending, unpriced, unassigned
line items. A guard keeps sourced text and provenance immutable while parties keep editing status.
The job path now counts labor-task evidence and reports withdrawn or stale sources. Disposable
PG17 covers 27 cases and reruns the 25 + 57 + 88 earlier mechanics assertions. Prose-only scopes
remain unitemized; splitting comma lists is a later, separately evidenced pass.

A job is a quote (2026-10-19; owner: use the standard language): the mechanics slices above
are read together as one model. A job is a quote whose itemized lines each name the witness,
clock and signer that close them; acceptance makes it a work order, and invoice and payment
conclude it as a receipt, a computed conclusion over reconciled witnesses. The lifecycle
vocabulary, stage-to-line table, invariants, fourteen-agreement inventory with holders and
gaps, privacy doctrine (job data open, personal information withheld, party payments visible
only to the parties, contact brokered by the platform), adopted owner-overridable defaults,
listing-to-inspection pipeline and explainable matching join live in
`docs/library/technical/work-order-intelligence.md` § "A job is a quote".

Mechanics RSI pass 3, retained lifecycle testimony (2026-10-19): overnight the job loop gained Sign owners for
quote acceptance, start, completion, invoice and payment witness, all empty across the 26 work orders because
their Signs need authenticated parties. The selected real job's retained messages already state client price
acceptance, an invoice, a pause and finished operations. Forging Signs from them would invent authentication,
so migration `20261020003000_work_order_retained_testimony.sql` adds a separate immutable projection keyed to the
interpretation, quoting the original message under its own clock and speaker label, and anchors count-only
testimony blocks into the shared job-path reader and scoreboard without changing stage states. Disposable PG17
covers 33 cases; the job-loop replay contract proves the anchored edits against the real build. A name collision
with the completion/invoice lane's `project_work_order_lifecycle_event` was caught by that replay and avoided.

Card payment of job invoices (2026-10-19, owner: "build it out we have stripe"): the job loop could invoice and
record payment testimony but not take a payment, and the existing stripe-webhook credited the AI wallet for every
completed Checkout, including non-credit purchases. Migration `20261020014500_work_order_invoice_stripe_payments.sql`
adds a `stripe` documentation source, an immutable processor-payment projection, customer-only checkout terms over
the current invoice balance, a webhook recorder idempotent on Stripe event and session ids, and anchored edits so
reconciliation counts processor receipts and the customer's job actions offer `pay_invoice`. The webhook now routes
by purchase type. Collection only: no transfer, payout or release; the live key is not exercised by tests.

## 14. The map: place as where a user participates (owner, 2026-10-20)

**Owner direction, 2026-10-20 09:12–09:25 PT**, on the web map that copies the iOS map (#2357), in his words:
"i actually still prefer we focus on selected zip but we need more nesting dolls metrics because a lot of data is being
hidden cuz it doesnt have a zip associated." "when we are drilling in to a map what are we hoping to find? we want to see
the sources of the vehicles thats why maybe having the addresses of the prominent businesses would surface at a certain
point, the color of the fill permeating from them." "the side menu i dont get to click which violates click through."
"i wanna find cool things, i wanna see metrics on past listings more than the listings themselves because previous
listings that are done and sold really only exist to provide data intelligence on the area and then finding the current
listing is perhaps more priority because available listings is where a user can participate, the other area a user can
participate is by discovering other users, or service providers active in that zip or zone. that doesnt yet exist...
being able to follow or participate with those other users becomes a thing we start to ruminate on." "as for the vehicle
list... whats that point in its current state. the data is bland... id wanna see the vehicles performance on the market."
"eventually the view will transform... as the system is adopted people will provide their live profiles of vehicles
present in the area. sold vehicles travel out of the zip usually... so what it shows is actually a little bit misleading
we are currently showing a historic ledger of vehicles that sold thru that zip... usually more of an indication of the
location of the seller." "the metrics dont differentiate listing type." "i zoom out and it just spins." "the theories
havent been written on what we aspire to do."

**The theory, as the lead reads it (to be corrected by the owner, not by agents).**

1. **The unit stays the selected ZIP.** The view is navigation, not the cohort. A ZIP's reading sits inside its
   county, its state and the country, and shows all four at once (nesting dolls), because records that carry no ZIP
   are not missing: they are county-grain or state-grain evidence and count at the grain they have. "11,080 records
   without a ZIP" is a coverage statement, not a footnote. (map_facts already holds the three grains with their
   "no key" rows; the panel must show them.)
2. **A place has two different facts, and the map must say which it is showing.** (a) *Where a vehicle was sold from*:
   the seller's location at listing time, which is what every location observation is today; a sold vehicle has usually
   left that ZIP. (b) *Where a vehicle is present*: an owner's live profile placing the asset there, which exists only as
   adoption grows. Today's map is (a) and must label itself as the seller ledger of the area, never as "vehicles here".
3. **Drilling in looks for sources.** The question behind the drill is "who is selling here": dealers, consignors,
   auction houses, private sellers. Prominent businesses with addresses surface at a zoom, and the fill is attributable
   to them (the color permeates from its sources). The ZIP panel leads with its top sources and their share, each
   opening to the organization.
4. **Past listings are intelligence; current listings are participation.** Done and sold episodes exist to produce the
   area's numbers (what sells, sell-through, time to sell, like-for-like premium against the same cars elsewhere, trend);
   they are shown as readings, not as a list. Available listings are the list, first, because they are where a user can
   act. The third kind of participation is people: other users and service providers active in the zone, to discover
   and follow (not built; see the organization layer and actors).
5. **Every datum on the panel is a button.** Platforms, mix, metrics, records: each opens to its rows and its evidence.
   A "1 record" line that does not open is a tenet-1 failure.
6. **Metrics differentiate the kind of episode.** Listing, sale, sighting and bid are different layers (map_layers) and
   are never summed as "vehicles".
7. **A vehicle row carries its market performance**, not its name: outcome (sold, reserve not met, withdrawn, live),
   price against its cohort's expectation, bids, days, relist count. Where the engine has no cohort, "too few to tell".
8. **Speed is a fold, not a read.** Counts and readings at every zoom come from map_facts (sum over areas in
   milliseconds); the raw records are read only for the selected ZIP. Reading every county in view is what spins.

**Open for the owner to settle (not for agents):** the comparison that "performance" means (the car's national
like-for-like cohort, the lead's default; or the ZIP's own past); and the second fact (vehicle presence) as a layer
distinct from the seller ledger, once owner profiles place assets.

**Status.** Theory written 2026-10-20; nothing in it is built beyond map_facts (#2331), map_layers (#2324) and the
iOS-copy map (#2357). The lead's first repairs in this order: counts from map_facts at every zoom (8), the nested
grains and the seller-ledger label (1, 2), click-through on every panel datum (5), sources first (3), then the readings
(4, 7) once the like-for-like residual per sale exists.

## 15. Decisions 2026-10-20: the stewardship chain and what a recorded sale is

The owner delegated these two calls on 2026-10-20; they are written from his rules (the evidence ladder: store the
narrow provable claim and never collapse it into a stronger one; the privacy masking spectrum: existence and shape are free, identity
is locked, people never appear as something tracked).

**Stewardship chain, private by default.** The owner periods folded from sold lots (`vehicle_ownerships` rows with
`basis = 'auction_sale'`, written only by `fold_vehicle_ownership_periods`) stay private. Anon and signed-in readers see
none of them (`vehicle_ownerships_fold_rows_read_guard`), and the reader view `v_vehicle_owner_periods` and the flag
table are service_role only. The lot facts they come from are already public in `auction_events`; what stays private is the stitched,
derived chain from handle to vehicle to dates. A public layer, when built, is a masked shape only: how many stewards, the
first and last recorded dates, counts by `sale_confirmation`; never an identity or a handle. Opening the chain itself would be a new
product decision, done by dropping the read guard.

**A sold lot is a recorded sale, not a completed transfer.** A scraper observes the hammer and nothing after it, so the claim
stored is the narrow one. Status of an auction-seeded `ownership_transfers` row, by evidence:

| Evidence | Status | Why |
|---|---|---|
| hammer only (fold `sale_confirmation = 'recorded'`) | `recorded_unconfirmed` | the only thing observed |
| the winner listed the car next (`confirmed_next_lot`) | `recorded_unconfirmed` | the stronger evidence lives on the period row; `completed` means title and payment finished in the deal pipeline, which no scraped sale proves |
| the same seller listed the car again right after (`relist_same_seller`) | `cancelled`, `cancelled_at` = the relisting lot's event clock | direct evidence the sale did not hand the car on |

The open milestones of a relabelled transfer become `not_observable`; the hammer (`agreement_reached`) stays completed. A transfer
with a user on either side, any milestone beyond the hammer, a party communication or a trigger other than a lot is never touched.
Every relabel is recorded in `ownership_transfer_relabels` (previous status, new status, reason, the lot and the evidence lot)
and `revert_auction_transfer_relabels` puts it back, so later evidence (a bridge between two handles, a title) can flip a status.
New seeds follow the same rule: `transfer-automator` seeds a lot as `recorded_unconfirmed` with the one hammer milestone and
seeds nothing for a lot the fold flagged as relisted; `transfer-advance` creates the deal pipeline and moves the transfer to
`in_progress` when a party engages. The listing-seeded path (a deal run through Nuke) keeps the full pipeline.
