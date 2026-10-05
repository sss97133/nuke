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
| C1 | Live pull starves lots beyond 48 h; check blind to never-read lots | 760 of 1,347 never dispatched; 106 of 243 closing <12 h overdue at 19:45Z | **closed** fc5fc212f (20261001000100): one of 3 slots per run reserved for `next_poll_at IS NULL`; the check counts never-read lots > 2 h as overdue. Before 01:00Z 10-01: 517 of 1,217 live lots never dispatched (all beyond 48 h), check said ok. After 07:41Z: 0 never dispatched, 0 overdue in every bucket, check ok (it was red for the ~6 h the backlog took to drain, which is right) | yes | done |
| C2 | The final minutes are not read live | median last read 48 min before close; 0 of 5 within 15 min; chain observed only at settlement next morning | open | yes | a closing-window cadence: within 10 min of the current end read every minute until 5 min after it stops moving; each read that sees the end move writes an extension event |
| C3 | Scheduled end is overwritten by the reader | `auction_end_date` upserted on every read; `monitored_auctions.extension_count / is_in_soft_close / last_extension_at` empty on all rows | open | yes | keep the first-read end as the scheduled end; write extensions as events (pre-mint check: `timeline_events` vs a fact table keyed to `auction_events.id` and the trigger bid) |
| C4 | Soft-close fold for every closed lot | 400-lot sample: 80% extend; 39% of bids in chains; median +25% price made in chain | open | yes | read-only chain function; batch fold per closed lot as-of its close; bidder record as-of date keyed to `external_identities` |
| C5 | `hours_until_close` defect | 73% wrong; 98.8% right since 09-27 | **closed for the reader** 2f48581f4 (20261001000200): `live_lot_temperature` keys comparables on `auction_events.auction_end_date` (else the vehicle's clocked end) minus `posted_at`; lots with no defensible close are not counted (`lots_without_close`). SL500 cohort before: the "bid at 2 h" equalled the final bid on 179 of 312 lots (median 20 bids by 2 h); after: 7 of 183 (median 6). Live lot 99fcbbd4: above 157 of 182 sold comparables, 101 lots without a close, 0.78 s as anon. The column itself is still wrong: a recompute or view is a separate case | yes | the column: recompute from `auction_events` in batches, or a view; never trust it |
| C6 | Identity keys half filled | 2026-10-02 08:17Z: latest 10,000 comments, 9,971 identifiable, 7,960 missing keys; 6,905 missing keys match existing exact identities. At 12:11Z: all 187/187 identifiable arrivals since deployment linked, 0 mismatches, 0 missing vehicle/event links (10,000-row cap; arrivals 08:25–12:11Z). | open — fresh writer verified | yes | `e96ba7f02`: shared bounded identity resolver in core reader + archive loader, deployed `extract-bat-core` v155 via [CI](https://github.com/sss97133/nuke/actions/runs/36983740279). Re-measure with `node scripts/check-comment-linkage.ts --since 2026-10-02T08:24:02.906Z`. Historical rows untouched; historical repair through sanctioned supersession, listing/event identities and `bat_users` retirement remain. |
| C7 | `platform_source` NULL on every new vehicle | 55,507 in 7 days | **writers fixed** 567bf9b0d: extract-bat-core stamps `bringatrailer` on insert and fills it on update; ingest maps its platform to `source_registry.slug` (the platform entity exists: slug matches the column's main values). Measured 10-01: 56,243 of 58,566 rows created 09-24..10-01 NULL (45,612 BaT, 9,963 Craigslist); 10 of 1,227 live BaT lots NULL and so unscheduled by the live pull. **Backfilled** 4191be659 (`backfill_vehicle_platform_source`, cron 512, self-retiring): NULL on vehicles created since 09-24 went 56,243 → 217 (59,549 filled) in 60 runs 08:12Z–10:10Z (2 hit the 50 s timeout), then the job turned itself off; the 217 are hosts outside the map. (PR #498 closed: merging is agent work, not the owner's.) Tested live 10-01 ~09:30Z: a Facebook Marketplace listing (1993 Land Cruiser FZJ80, item 1081313484286582, $9,500, 266,000 mi, Moreno Valley CA) sent through the `ingest` edge function with the service key landed as vehicle 6044cfee with `platform_source = facebook_marketplace`, anon-visible. Found: fan-out 1 (one `marketplace_listings` row); 0 `vehicle_observations`, 0 `vehicle_events`, 0 `vehicle_images`: the ingest writer makes an entity and a blip but no event in the log (§2.3 again). The Nuke MCP connector returned 401 (not a JWT), the wall the Opus session also hit | yes | a `NOT VALID` key to `source_registry.slug` once `unknown`, `facebook_marketplace`, `classiccars`, `bonhams` have registry rows |
| C8 | Place is not an entity | 13 location columns; `geocoding_cache` 26K idle | open | yes | a place entity with hierarchy (county → state → region); keys from vehicles, organizations, listings |
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
| C27 | Stored market evidence cannot reach an immediate vehicle/opportunity answer | 2026-10-04 Corvette conversation; bounded DB and public-reader probes, §11 | partial — private context query delivered; repair assay prepared; public integration and source corrections open | yes, within each lane's existing authorization | Reconcile stored source fields and event identities; extend the shared reader to retain broad market context, nested cohorts, unresolved evidence and measurable arrival performance |

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
production record changed. **126 focused tests pass**, including that private replay and existing
BaT archive/intake custody regressions; public CI runs125 synthetic tests. The enforced checkout
gate and write guard pass. Publication/deployment stages belong to this repair's PR receipt; this
is prepared code, not a live source correction. Historical admission, capture-to-vehicle/event
binding, episode configuration semantics and qualified cross-venue prices remain held/open.
