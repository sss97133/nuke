# Market comparison UI and SQL contract — owner correction, 2026-10-04

This supersedes the price-histogram-first presentation. The owner wants market movement made visible through measured commentary, bidding, sales, supply and attention. No hypothetical numbers, invented trend or quote wall. This is a design/reader request, not authorization for database writes or scoring/model spend.

## Public experience

One cohort selector (make → model → supported submodel/year/build scope), one event-time range and one comparison selector govern the market screen and its supporting lots. The default comparison is the same platform's broader market excluding the selected cohort; overlapping benchmarks must say so. Preserve the current visual language. Remove duplicated page/header navigation and inconsistent Market destinations.

The opening is a comparison chart and a compact set of related measures, ahead of the vehicle list. The chart has two labeled series: selected cohort and benchmark, with the exact unit, period, numerator/denominator and coverage. The SQL reader supplies the changes and comparison basis; the browser only formats and draws them. Signed commentary scores use their actual scale (not a base-100 index). Prices may be indexed only when the reader provides a supported consistent basket; raw median shifts must say that the mix of sold vehicles changed. Never call a composite of bids/sales/prices 'commentary mood'.

The measures are commentary stance, bid rate, recorded sales and value, sell-through, active supply and view rate. Only measures with deployed, qualified real reader output appear. Missing contracts are recorded here, not filled with fake values or six empty production tiles. A metric changing direction changes the chart, the comparison sentence and the evidence list together. Do not narrate 'Porsche is strong' from one metric: report which measure rose/fell relative to what, with its sample and dates.

Selecting a time point opens contributing auction/vehicle summaries, each with its measured feature, scope, source-read clock and source link. Selecting commentary expands the vehicle summary into **derived per-comment features** with rubric/version, event time, classification uncertainty, eligible/scored counts and the exact contributing comment/source IDs. Original text is a final evidence drill, with source attribution, not the primary analytic presentation. Include counterexamples and unclassified coverage; do not select only supportive quotations. Per-vehicle distributions reveal disagreement instead of collapsing all testimony into a falsely precise mood score.

Keyboard-accessible metric buttons, native cohort/time controls, a text/table equivalent for plotted values and visible focus. On phones the comparison chart and a concise selected measure remain first; supporting measures wrap, evidence opens below. No decorative graph or new vehicle page.

## Required grain and weighting

1. Comment feature: stable source comment ID + auction/listing event ID + vehicle UUID; posted_at is event time, created_at/ingested_at is knowledge time, analyzed_at is scoring time. The source link and scoring method/version/range belong to the feature. Return the measured dimension (asset enthusiasm, condition/restoration concern, originality, price expectation or seller credibility where the rubric actually supports it); social politeness is not evidence of rising prices. Preserve uncertainty and mixed/disagreeing dimensions instead of forcing a single positive/negative tag. Bids are events, not automatically opinions. Seller statements, questions and reactions are separately typed.
2. Auction commentary: summarize eligible scored comments for one source-qualified listing episode, not all lifetime comments on a vehicle. Return distribution, scored/eligible counts, unique platform-qualified participants where known, and uncertainty. Repeated comments from one participant/source are not independent corroboration. Unknown author keys remain unknown, never unified by equal handles.
3. Vehicle: keep auction episodes distinguishable; a relisting does not duplicate a fixed sale or make historical commentary current. Provide a supported rule if rolling episodes into a vehicle summary.
4. Model/submodel cohort: use exact supported registry membership and canonical/source-qualified identity, not substring matching or inferred build class. Ambiguous members stay out or appear as explicit unresolved coverage. Default stance is equal-weight eligible auction summaries; return comment-weighted stance separately with its weighting label so one popular lot cannot dominate unnoticed.
5. Timeframe: bucket comments/bids by posted_at, sales by supported sale event time, inventory by source snapshot time. Comment → auction → cohort folding happens in SQL/the existing fold. Today vs recorded history needs an explicit baseline ending before today's window; also offer prior equal-length window and same season/year when coverage supports them. Missing bucket data is a gap, not zero or interpolated evidence.
6. Comparison: cohort and benchmark use identical platform, units, event windows, cutoffs, scoring versions, coverage gates and phase rules. Return whether the benchmark excludes the cohort. Include historical coverage start/end, source changes and elapsed fraction of an incomplete current bucket.

## Reader envelope, additive to existing owners

Capability guard identifies api-v1-market-trends / get_market_trends as the existing comparison owner. Extend that surface or its sanctioned backing fold; do not create a competing analytics pipeline. Existing market_lot_activity remains the bounded current-lot drill; it currently exposes 40 typed interactions for at most eight lots, not cohort-wide distilled commentary. Coordinate additive output with UI; preserve the deployed fallback.


The existing api-v1-market-trends Edge route authenticates an API user and uses a server-held service role. It is not an anonymous browser endpoint. Preserve that authentication. The public UI needs the same owner’s qualified output through its existing anonymous/RLS reader path; do not ship API keys or service role to make the route usable. Keep legacy get_market_trends callers compatible; choose an additive response/overload within this owner rather than silently changing its existing table return type.

Each metric requires: metric_id, state (ready/partial/unknown/unavailable/conflict), value/null, unit, numerator/null, denominator/null, grain, weighting, method_id/version, event_from/to, knowledge_cutoff, source_observed_at/null, folded_at, coverage (eligible/scored lots/comments; earliest/latest event; source completeness/limits), and bounded evidence cursor. `generated_at` never substitutes for source freshness. Do not invent confidence by recycling a stored observation score into aggregate certainty.

Series points require the same receipt at bucket grain, comparison value and baseline, plus SQL-calculated absolute/relative change when defined. Denominator zero yields a null ratio with a reason. A known zero under complete coverage remains zero. Overlap, incompatible scoring revisions, stale sources or mixed currency prevent an unqualified comparison. Current cumulative materialization is not historical as-of; future knowledge cannot silently enter a sale-time assessment.

Evidence responses repeat metric/cohort/bucket/cutoffs and provide stable UUIDs for contributing lots/observations/comments, contribution/weight, method and source attribution. Cursor pagination is server-side and bounded. Public/undeleted/vehicle-only eligibility applies to aggregates AND drill. Denied/private records must contribute neither payload nor public aggregate counts. No service-role browser credentials, no page-time observation-log reconstruction.

## Live reader inspection and exact gaps

Read-only deployment inspection at 2026-10-04 UTC:

- `auction_comments` has sentiment, sentiment_score, analyzed_at, community_stance_score, stance_scored_at, stance_model, condition_polarity, extracted_claims and rubric_version alongside posted_at, source_url and platform-qualified identity keys. Their existence does not prove comparable current/history coverage or a deployed cohort fold.
- `market_lot_activity` is newly deployed under PR525 (root live assay pending in DB status). Its typed current activity omits comment_text and distilled stance fields. It is a drill seed, not the market aggregate.
- `get_market_trends` reads raw vehicles.sale_price/sale_date. Its inspected body does not establish the qualified sold/public/deleted/nonvehicle eligibility required here. Do not label it verified sales-performance output.
- `get_make_market_stats` averages stored market_trends scores without a exposed rubric/cutoff/coverage receipt. This cannot justify today's Porsche mood vs all history.
- `get_auction_trends_v2` synthesizes a 'market sentiment' score from bid depth, sell-through and average-price movement. That is not measured commentary. Its commentary section joins comment_discoveries to vehicle_events by vehicle UUID rather than exact episode, groups neutral with negative, and substitutes missing measures with zero. Public eligibility and this episode/score semantics need repair/assay before exposing it as the requested experience.
- `get_model_price_history` has public/deleted/nonvehicle and vehicle_sale_basis eligibility, but latest 30 records are a bounded evidence sample, not a whole-market denominator or historical performance series.
- Current live-bid index history provides same-hour snapshots, with source/make coverage differing between archived and live readings. Do not present this as historical bid-event velocity or sale-return performance.

## Acceptance assays (real records only)

SQL and browser must agree on the contributing event/cohort IDs and metric receipts. Test: current vs prior window; model/submodel resolves to a supported exact cohort; sparse/absent history; negative/zero stance; incompatible rubric revisions; repeated author testimony; contradictory scores; incomplete current period; stale source; successful source read with no change; bid truncation; source view-counter reset; mixed currencies; relisting; private/deleted/nonvehicle exclusion; source/event/ingest clocks. No production synthetic testimony. A cohort-strength headline requires the actual measures and comparison receipts; if the reader is absent, the UI does not make that claim.
