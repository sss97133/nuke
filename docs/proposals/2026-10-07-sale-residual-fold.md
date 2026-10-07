# S01: qualify a monthly sale residual before persisting the fold

Owner direction, 2026-10-07: continue the data model and automate processing of retained evidence, using the stacks to expose missing relationships. This first implementation is a bounded, service-only SQL prototype, `sale_residuals_by_ymm`. It establishes a source-to-consumer contract before a scheduled materialization. No new intake or model inference is needed.

## What the live evidence supports

Read 2026-10-07 18:35–18:40Z. The atlas and catalog have no sale-residual organ. `v_residual` ranks schema repair, `vein_runs` grades a registered hypothesis, `nuke_estimates` holds current vehicle estimates, and `vehicle_market_estimates` is a different estimate grain. `market_index_values` holds index OHLCV, with the live-bid recorder as owner. None represents a sale compared to its pre-sale cohort. The capability map assigns source-sale qualification to `valuation_by_ymm`, which already calls `vehicle_price_facts` where a current scalar is relevant and preserves separate native episodes.

The earlier S01 sizing used raw vehicle columns; its dated-sale totals cannot establish qualified residual coverage. An existing-reader probe of the retained 1963 Corvette cohort returned 21 qualified episodes over September 2023–September 2026, with 1,256 current members, 30 agreeing qualified captures and nine duplicate presentations. Six qualified sales occurred in March 2026. These are source-qualified captured episodes, not the whole market. They demonstrate why a dense scalar population and a qualified-price population must be measured separately.

The geography atlas exposes another boundary: live `observed_at` often means extraction time, and county keys were filled later from ZIP evidence. A vehicle's latest county does not establish its county at a historical sale. The prototype only accepts a county on the same vehicle and normalized BaT listing URL, listing source type, US country, confidence at least 0.5, non-future observation/creation clocks and an existing county key. Conflicting counties and bounded lookup overflow withhold geography. The output explicitly calls this a current county key on same-listing testimony, not a verified sale-time location.

## Contract and seven pre-mint questions

1. **Existing owners:** reuse `valuation_by_ymm` for complete source qualification, currencies, published-bid fee basis, capture hashes, admission, clocks, duplicates and conflicts. Its existing bounded membership and capture refusals propagate. The prototype does not create another sale parser or price owner.
2. **Grain:** one qualified source episode within a closed UTC month and declared current cohort. Different sales of the same vehicle remain separate. This is a derived measurement, not new testimony.
3. **Units and clocks:** baseline is the continuous median of qualified same-currency source sales in the 36 months before month start; minimum ten. Residual is `ln(sold/baseline)`. Same-month and future sales never train that baseline. Evidence is evaluated at this statement's clock. Current membership and later-learned evidence make this a retrospective measurement, not a known-at backtest. No FX, fee, inflation or condition adjustment.
4. **View before table:** a bounded function proves the calculation first. It performs no writes and makes no durability or automatic maintenance claim. Persisted results need immutable input receipts, method revisions and keys; that next schema decision should follow the runtime assay.
5. **Enforcement:** service-role-only EXECUTE, SECURITY INVOKER, fixed search path/timezone, 20-second function timeout, 500 target-episode cap and 101-row per-vehicle geography probe. Incomplete source populations, duplicate source keys and incompatible units are refused. Geography overflow withholds only geography; it does not erase a qualified sale residual. SQL fixtures exercise these boundaries, and an integration test uses the actual canonical parser/price/valuation functions.
6. **Ownership:** `sale_residuals_by_ymm` owns this read-time calculation. No persisted field is introduced, so no competing writer or pipeline registry row is created. The consuming operator reads its county summary and follows each sale to the retained source receipt. County sample counts are shown without causal/confidence claims.
7. **Delivery:** one migration, two PG17 contracts, existing CI jobs, capability-map entry and this memo. Deployment via normal PR/CI only. No stack coverage claim, new table, backfill or cron is included.

## Executable acceptance

`select sale_residuals_by_ymm(1963,'Chevrolet','Corvette','2026-03-01','USD');`

Return the complete source receipt, prior-window baseline, each target episode's residual, same-listing county evidence IDs and explicit missing/conflict/scan-limit reasons, then county count, median log residual, IQR and share above baseline. A missing/sparse baseline returns the target evidence with residuals withheld. Sell-through remains NULL until its sold-and-unsold denominator is qualified; days-to-sale remains NULL until exposure clocks are established.

The synthetic contract proves repeat sales, disjoint windows, minimum sample, mixed-unit refusal, duplicate refusal, cap behavior, conflicting and unrelated locations, private sighting exclusion, missing county keys, source-reader failures and deterministic same-statement replay. The integration contract proves a protected source capture reaches the baseline/residual/county; tampering its raw hash removes the target instead of falling back to the vehicle scalar.

## Next automation, after the assay

1. Persist the qualified episode and baseline receipts with explicit source/episode/vehicle/county references and immutable revisions. A later correction changes today's revision, preserving earlier readings.
2. Build a bounded cohort/month queue. Changes to admitted sales invalidate affected later baseline months within 36 months; source supersession, membership and location changes require explicit invalidation rules. One writer, resumable checkpoints and deduplicated requests.
3. Reuse the standing runner and governor. Serial cohort reads first; record eligible, computed, withheld and failed counts, latency, oldest work and consumer freshness. Stop on repeated reader failures or load threshold breach. A retry never becomes duplicate testimony.
4. Introduce known-at geography and historical membership only when their evidence exists. Do not rename this retrospective prototype into a backtest.

S01 is partial until persistence, replay, bounded scheduling and runtime throughput are proved. S20 and SA may reuse the grammar, but their distinct residual grains do not become satisfied by this function's existence.
