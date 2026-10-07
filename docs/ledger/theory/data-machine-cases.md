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
| C7 | `platform_source` NULL on every new vehicle | 55,507 in 7 days | **writers fixed** 567bf9b0d: extract-bat-core stamps `bringatrailer` on insert and fills it on update; ingest maps its platform to `source_registry.slug` (the platform entity exists: slug matches the column's main values). Measured 10-01: 56,243 of 58,566 rows created 09-24..10-01 NULL (45,612 BaT, 9,963 Craigslist); 10 of 1,227 live BaT lots NULL and so unscheduled by the live pull. **Backfilled** 4191be659 (`backfill_vehicle_platform_source`, cron 512, self-retiring): NULL on vehicles created since 09-24 went 56,243 → 217 (59,549 filled) in 60 runs 08:12Z–10:10Z (2 hit the 50 s timeout), then the job turned itself off; the 217 are hosts outside the map. (PR #498 closed: merging is agent work, not the owner's.) Tested live 10-01 ~09:30Z: a Facebook Marketplace listing (1993 Land Cruiser FZJ80, item 1081313484286582, $9,500, 266,000 mi, Moreno Valley CA) sent through the `ingest` edge function with the service key landed as vehicle 6044cfee with `platform_source = facebook_marketplace`, anon-visible. Found: fan-out 1 (one `marketplace_listings` row); 0 `vehicle_observations`, 0 `vehicle_events`, 0 `vehicle_images`: the ingest writer makes an entity and a blip but no event in the log (§2.3 again). The Nuke MCP connector returned 401 (not a JWT), the wall the Opus session also hit | yes | a `NOT VALID` key to `source_registry.slug` once `unknown`, `facebook_marketplace`, `classiccars`, `bonhams` have registry rows |
| C8 | Place is not an entity | 13 location columns; `geocoding_cache` 26K idle | **declared at county grain** 2026-10-07 (migration 20261007210000, memo `docs/proposals/2026-10-07-place-entity.md`): `us_county_boundaries` (3,231 counties) is the place entity; `vehicle_location_observations.county_fips` and `zip_to_fips.fips` key to it (NOT VALID). County coding had stopped in 2026-04 (0 of 207,324 rows since carried a code): migration 20261007213000 keys `county_fips` at insert from the postal code through `zip_to_fips` (trigger `trg_key_vehicle_location_county`, ZIP grain, method in `metadata.county_key`) and back-fills the 183,478 eligible rows through `key_vehicle_location_county_from_zip()` (receipted). Still open: state → region levels; non-US places; the 3,244 `_none` rows and 244 retired ZIP codes | yes | a state level when a reader needs it; the per-county residual fold for S01 |
| C9 | Comparables too narrow for half the lots | 6 of 12 lots closing within 10 min had < 8 same-model comparables | open | yes | widen model → make → department per `TEMPERATURE_PLAN.md`; store level and n |
| C10 | Two truths for the sale of record | §2.7 | open | yes | every cohort reader goes through `vehicle_sale_basis()`; `canonical_sold_price` nulled on live lots through the chokepoint |
| C11 | Analysis organs frozen | §2.8 | open | partly | decide which folds have a reader; revive those as scheduled, assayed folds; archive the rest |
| C12 | Atlas write-receipt coverage incomplete | 2026-10-02 12:06Z: atlas join exists, but 0 comment receipts in 30 days, NULL comment writer/last-write, 0 comment receipts among newest 100 receipts despite 100 sampled new comments. After CI, first 2 fresh comments produced 2 receipts naming `extract-bat-core` (12:10Z); atlas shows writer/last-write, receipt-covered tables 3 → 4, 0 lock waiters. | comment log wired — wider coverage open | yes | `58fb870b0` (20261002000100), [CI](https://github.com/sss97133/nuke/actions/runs/37004973159): attach existing INSERT statement observer; reader declares X-Nuke-Writer. PG17 tests cover batch/empty/conflict/mixed replay, preserved testimony/times, unknown writer, SQL precedence and sensor failure. Live caps: 10,000 comments / 1,000 receipts since 12:09:38Z, measured 12:10:50Z. No historical DML. Writer names are caller declarations, not authentication. Next: sensor coverage for one more active trunk table; fan-out remains. |
| C13 | Dealer monitors dead since 2026-02-17 | 495 of 496; no second visit ever | open | yes | the diff step inside `poll-listing-feeds`: presence ledger (dealer, listing_url, observed_at, status, price), appear/disappear/sold events |
| C14 | Craigslist stores share URLs, no post id, no HTML diff, no second sighting | 100% of rows since August | open | yes | read the post id from the detail page; snapshot the detail page (`archiveFetch`); diff the search snapshot per poll into appear/disappear events |
| C15 | Block auctions: no sale entity, no catalog-before, no video | `auction_events` last house row 2026-04-01 | open | yes (catalog); video needs a cost plan | a sale entity (house, start, end, location, catalog); catalog-before per event; results after; video clips as documentation later |
| C16 | Facebook dead since 2026-06-12, 111,669 phantom actives | monitor cron off | open | no (Mac fetch) | per-metro request budget and sighting log; the cloud only folds and checks |
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
