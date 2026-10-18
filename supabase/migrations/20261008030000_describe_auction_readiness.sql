-- Describe auction_readiness: all 19 columns (0 of 19 had a COMMENT ON COLUMN before; catalog count on prod, 2026-10-07)
-- and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table in the atlas (13,153 updates since the statistics counters began):
-- 378,598 rows on 2026-10-07 14:42Z by exact count (the atlas estimate of 378,443 is a stale pg_class.reltuples); the
-- newest score was computed 2026-10-07 12:17Z.
--
-- METHOD (read 2026-10-07 14:32-14:47Z UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, RLS, grants (has_table_privilege and
--   has_any_column_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy, pg_class and pg_description; the one view that reads it from
--   pg_depend (supplier_vehicle_readiness, security_invoker). The row count, the tier, month and score counts, the fills
--   of the scalar, array and json columns, the check of composite_score and tier against the rules of both scorers, the
--   equality of top_gaps and coaching_plan and of last_data_event_at and computed_at, and the zone counts are exact
--   counts over the whole table (896 MB heap, 1,436 MB in all, read only). Gap keys, texts, points and actions, array
--   lengths and the vehicle status of scored rows come from a 1% block sample (TABLESAMPLE SYSTEM (1) REPEATABLE
--   (20261007), 3,569 rows). What anon and authenticated can read comes from counts under SET LOCAL ROLE in read-only
--   transactions. "Filled" means non-NULL; arrays and json count non-empty.
--   Writers and readers from code at origin/main 80846a5fc (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; docs/strategy/auction-readiness-strategy.md for the design). The creating
--   migration is not in the repo: it is prod migration 20260320075640 create_auction_readiness_tables, read from
--   supabase_migrations.schema_migrations with the scorer versions 20260320080331 create_compute_auction_readiness,
--   20260323071208 wire_signals_to_ars_market and 20260411091759 fix_ars_mvps_zone_mapping; the repo holds
--   20260322220000_supplier_pipeline.sql (the view), 20261006073000_table_purpose_live_tables.sql (the former table
--   comment) and 20261007080000_compute_auction_readiness_ignore_failed_runs.sql. Bodies read with pg_get_functiondef:
--   the functions that name the table (persist_auction_readiness, recompute_ars_dimension, get_auction_readiness_batch),
--   the ones that call its writers (trigger_ars_on_evidence, trigger_ars_on_image, trigger_ars_on_image_stmt,
--   trigger_ars_on_observation, drain_ars_recompute_queue, synthesize_profile_from_vision), compute_auction_readiness,
--   check_mvps_zone_coverage and trigger_ars_on_vehicle_update. pg_trigger (the five ARS triggers on other tables);
--   cron.job (drain-ars-recompute-queue, jobid 473, inactive; analysis-engine-sweep 368 and analysis-widget-backfill 430,
--   inactive); write_receipts (no rows); pg_stat_user_tables; pipeline_registry (1 table-level row; none is added or
--   changed here); the deployed function list read through the management API (328 functions) for mcp-connector
--   (version 104, deployed 2026-10-02 05:16Z, a minute after the last commit to its source), generate-listing-package
--   and analysis-engine-coordinator. Reader code: nuke_frontend/src/pages/vehicle-profile/AuctionReadinessPanel.tsx,
--   nuke_frontend/src/components/listing/ChannelSwitchboard.tsx, nuke_frontend/src/services/channelRegistry.ts,
--   supabase/functions/mcp-connector, generate-listing-package and analysis-engine-coordinator; scripts
--   batch-ars-scoring.mjs, deep-resolve-vehicle.mjs and fb-sweep-and-enrich.mjs.
-- LIMITS:
--   Rows are overwritten in place, so the table keeps the last score only (ars_tier_transitions keeps tier changes).
--   Which caller made which row is not recorded: no write receipts, no created_at. Gap shapes come from a 1% block
--   sample and can miss rare texts. The vehicles denominator is the atlas estimate (pg_class.reltuples), not a count.
--   The anonymous write path through mcp-connector is read from its source, not probed. Deployed functions without
--   source on main were not read. pg_stat_user_tables counters began at the last server start (2026-09-29 09:20Z). The
--   table holds scores of vehicles, no personal data: quoted values are tier, gap, action and zone codes, column and
--   function names and counts only; no vehicle id or VIN.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Auction Readiness Score per vehicle: one row per vehicle with composite score, tier, six dimension
--   scores, gaps, coaching plan and photo zones (grain: one vehicle, current state, overwritten). Writers: SQL
--   persist_auction_readiness and recompute_ars_dimension (pipeline_registry owner compute_auction_readiness). Clock:
--   computed_at (derived, when scored); last_data_event_at is the newest input considered. Tier changes are logged in
--   ars_tier_transitions." The opening stays. "last_data_event_at is the newest input considered" is wrong: both writers
--   set it to now() and it equals computed_at on all 378,598 rows; the new comment says so and adds the two scorers, the
--   callers, the triggers, the liveness, the readers, the access paths and the never-filled fields.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.auction_readiness IS
'Auction Readiness Score per vehicle: one row per vehicle with composite score, tier, six dimension scores, gaps, coaching plan and photo zones (grain: one vehicle, current state, overwritten). 378,598 rows on 2026-10-07 (the atlas estimate of 378,443 is a stale reltuples), against an atlas estimate of 1,008,263 vehicles. By tier: DISCOVERY_ONLY 284,525, TIER_4_INCOMPLETE 53,671, TIER_3_VIABLE 18,216, EARLY_STAGE 17,953, TIER_2_COMPETITIVE 4,112, NEEDS_WORK 121; no TIER_1_EXCEPTIONAL (the highest score is 84). Two scorers coexist: 224,359 rows (59.3%) were last computed 2026-03-20 08:05Z .. 2026-03-23 07:00Z by the first compute_auction_readiness (prod migration 20260320080331, the weights and tiers of docs/strategy/auction-readiness-strategy.md, EARLY_STAGE and NEEDS_WORK among them) and never rescored; the 154,239 rows computed since 2026-03-23 14:16Z follow the current rule (prod migration 20260323071208 wire_signals_to_ars_market, then 20260411091759 for the photo zones and 20261007080000 for failed-run signals). Scores, tiers, gaps and zones of the two groups are not comparable (see composite_score, tier, top_gaps, photo_zones_missing). Writers: SQL persist_auction_readiness (an upsert, the only path that adds a row) and recompute_ars_dimension (updates an existing row); both call compute_auction_readiness and recompute all six dimensions. persist_auction_readiness is called by the mcp-connector tools get_auction_readiness, get_coaching_plan and prepare_listing and by the edge function generate-listing-package when a vehicle has no row, by synthesize_profile_from_vision after it fills vehicle fields, and by scripts/batch-ars-scoring.mjs (the 2026-03 bulk run), deep-resolve-vehicle.mjs and fb-sweep-and-enrich.mjs. recompute_ars_dimension runs from the triggers trg_ars_on_evidence_insert (AFTER INSERT on field_evidence, per row) and trg_ars_on_image_insert (AFTER INSERT on vehicle_images, per statement). The queue path is off: trg_ars_on_observation_insert on vehicle_observations is disabled, the cron job drain-ars-recompute-queue (jobid 473) is inactive and ars_recompute_queue is empty; trg_ars_on_vehicle_update on vehicles does nothing. Both writers run with the rights of the caller and RLS has no policy, so an insert into field_evidence or vehicle_images made as anon or authenticated finds no row and recomputes nothing; only service_role and postgres inserts refresh scores. Liveness: pg_stat_user_tables counts 0 inserts, 13,153 updates (7,915 HOT) and 0 deletes since the server last started (2026-09-29 09:20Z; read 14:42Z), so no vehicle has gained a row since then; 1,306 rows carry a computed_at after the restart, the newest 2026-10-07 12:17Z, and none carries one in 2026-08. Tier changes go to ars_tier_transitions (83,346 rows: trigger_identity 68,021, the latest 2026-10-07 08:10Z; trigger_photos 8,841, the latest 2026-10-06; trigger_description 6,465, the last 2026-04-14; full_recompute 19, the last 2026-05-04). pipeline_registry holds one table-level row (2026-03-20: owner compute_auction_readiness, write_via compute_auction_readiness(), do_not_write_directly true); compute_auction_readiness only returns the score as jsonb, the writes are made by the two functions above. Readers: mcp-connector (the three tools), generate-listing-package and analysis-engine-coordinator (action backfill_auctions; its cron jobs analysis-engine-sweep and analysis-widget-backfill are inactive) through the service role; the view supplier_vehicle_readiness (security_invoker); get_auction_readiness_batch(uuid[]) (no caller in the repo); the vehicle profile panel AuctionReadinessPanel.tsx and ChannelSwitchboard.tsx in the browser, where RLS returns no row, so the panel never renders; the three scripts. Never varied by the writers: is_stale (false), stale_reason (NULL), rejection_penalties ([]); last_data_event_at equals computed_at and coaching_plan equals top_gaps on every row. Access: RLS is on with no policy; anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE on the table, see 0 rows (counted under SET LOCAL ROLE, 2026-10-07) and cannot write rows through the API. Paths around RLS: compute_auction_readiness (SECURITY DEFINER, EXECUTE granted to anon) returns the score and gaps of any vehicle without writing; by its source the mcp-connector read tools need no authentication, return the stored row and, for a vehicle without a row, have the service role call persist_auction_readiness, so an anonymous caller can add rows; generate-listing-package admits any signed-in user, owner of the vehicle or not. No write receipts and no triggers on the table. Clocks: computed_at is when the row was last scored (writer time, overwritten on every recompute); last_data_event_at holds the same value, not the time of the newest input; there is no created_at.';

-- ── Identity ───────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.auction_readiness.vehicle_id IS
'Vehicle the score is for: a vehicles.id, uuid, the PRIMARY KEY (one row per vehicle), foreign key to vehicles(id) without ON DELETE action (validated), so a scored vehicle cannot be deleted while its row exists. 378,598 values (2026-10-07) against an atlas estimate of 1,008,263 vehicles. In a 1% block sample of 3,569 rows the vehicle status is active 3,225, archived 147, sold 125, pending 63, rejected 9. Only persist_auction_readiness adds a row; the triggers update existing rows and never add one, and no row has been added since 2026-09-29 09:20Z. Unit: none (uuid). Source: the argument of the writer. Grain: one vehicle. Clock: n/a.';

-- ── Composite and tier ─────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.auction_readiness.composite_score IS
'Auction Readiness Score: the weighted sum of the six dimension scores, 0 to 100, smallint NOT NULL, default 0, indexed descending (idx_auction_readiness_score). Current rule (compute_auction_readiness since prod migration 20260323071208, 2026-03-23 07:12Z): round(identity 0.15 + photo 0.20 + doc 0.15 + desc 0.10 + market 0.20 + condition 0.20), capped at 100; it holds on all 154,239 rows computed since 2026-03-23 14:16Z. The 224,359 rows last computed 2026-03-20 08:05Z .. 2026-03-23 07:00Z come from the first scorer (prod migration 20260320080331), weights identity 0.10, photo 0.25, doc 0.20, desc 0.15, market 0.20, condition 0.10 (224,353 of them within 1 point), with other dimension rules; 155,827 of them differ from the current rule. Compare scores only within one scorer (computed_at tells which). Range 4 .. 84, median 21 (29 on current rows, 19 on first-scorer rows; 2026-10-07). Unit: points (0 to 100). Source: compute_auction_readiness. Grain: one vehicle. Clock: as of computed_at.';
COMMENT ON COLUMN public.auction_readiness.tier IS
'Readiness tier derived from composite_score, text NOT NULL, default DISCOVERY_ONLY, no CHECK, indexed (idx_auction_readiness_tier). Current rule: TIER_1_EXCEPTIONAL at 85 or more, TIER_2_COMPETITIVE at 70, TIER_3_VIABLE at 50, TIER_4_INCOMPLETE at 30, else DISCOVERY_ONLY; all 154,239 rows computed since 2026-03-23 14:16Z follow it. 6 values occur (2026-10-07): DISCOVERY_ONLY 284,525, TIER_4_INCOMPLETE 53,671, TIER_3_VIABLE 18,216, EARLY_STAGE 17,953, TIER_2_COMPETITIVE 4,112, NEEDS_WORK 121; TIER_1_EXCEPTIONAL never (the highest score is 84). EARLY_STAGE and NEEDS_WORK are codes of the first scorer (AUCTION_READY at 90, NEARLY_READY at 75, NEEDS_WORK at 55, EARLY_STAGE at 35, else DISCOVERY_ONLY; the first two never occur), on rows last computed 2026-03-20 .. 2026-03-23 and never rescored; the 206,285 DISCOVERY_ONLY rows of that window were cut at 35, not 30. Readers treat TIER_1 and TIER_2 as listing-ready, TIER_3 as viable and every other code, the legacy ones included, as not ready (generate-listing-package, mcp-connector prepare_listing, arsTierToRank in nuke_frontend/src/services/channelRegistry.ts). A change of tier is logged in ars_tier_transitions. Unit: none (text code). Source: compute_auction_readiness. Grain: one vehicle. Clock: as of computed_at.';

-- ── Dimension scores (current rule; first-scorer rows used other rules) ────────────────────────────────────────

COMMENT ON COLUMN public.auction_readiness.identity_score IS
'Identity dimension, 0 to 100, smallint NOT NULL, default 0. Current rule, points from the vehicles row: year 10, make 10, model 10, a VIN of 11 or more characters 20 (a shorter one 10), a title longer than 10 characters 10, color 5, interior_color 5, engine_type 10, transmission 10, mileage 10; capped at 100. Current rows 0 .. 100, median 70; first-scorer rows 0 .. 75, median 45 (2026-10-07). An insert into field_evidence triggers the recompute logged as trigger_identity, though every recompute covers all six dimensions. Unit: points (0 to 100). Source: compute_auction_readiness over vehicles. Grain: one vehicle. Clock: as of computed_at.';
COMMENT ON COLUMN public.auction_readiness.photo_score IS
'Photo dimension, 0 to 100, smallint NOT NULL, default 0. Current rule: by the number of vehicle_images rows of the vehicle whose ai_processing_status is not failed (duplicates counted): 0 for none, 15 under 5, 35 under 20, 55 under 40, 75 under 80, 90 at 80 or more; raised to at least 70 when mvps_complete and to at least 85 with 12 or more distinct zones. Values on current rows (2026-10-07): 15 on 65,769, 90 on 33,574, 35 on 20,669, 75 on 17,833, 0 on 9,035, 55 on 7,349, 85 on 10. The first scorer summed the points of the zones of photo_coverage_requirements (platform universal) found among non-duplicate images, so first-scorer rows hold 94 distinct values from 0 to 98, median 4. Unit: points (0 to 100). Source: compute_auction_readiness over vehicle_images. Grain: one vehicle. Clock: as of computed_at.';
COMMENT ON COLUMN public.auction_readiness.doc_score IS
'Documentation dimension, 0 to 100, smallint NOT NULL, default 0. Current rule: vehicle_documents rows of the vehicle, none 5, 1 or 2 25, 3 to 5 50, 6 or more 70; plus timeline_events of type service, maintenance or repair, 1 to 4 10, 5 or more 25; plus 15 when vehicles.title_status is set and 5 more when it is clean; capped at 100. Current rows 5 .. 95, median 5; first-scorer rows 0 .. 45, median 5 (2026-10-07). Unit: points (0 to 100). Source: compute_auction_readiness over vehicle_documents, timeline_events and vehicles. Grain: one vehicle. Clock: as of computed_at.';
COMMENT ON COLUMN public.auction_readiness.desc_score IS
'Description dimension, 0 to 100, smallint NOT NULL, default 0. Current rule: vehicles.description longer than 500 characters 40, longer than 100 20, else 5; highlights 15, known_flaws 10, equipment 10 and modifications 10, each when longer than 2 characters; vehicle_observations of kind comment, 5 to 19 8, 20 or more 15; capped at 100. Current rows 5 .. 100, median 20; first-scorer rows 0 .. 95, median 20 (2026-10-07). Unit: points (0 to 100). Source: compute_auction_readiness over vehicles and vehicle_observations. Grain: one vehicle. Clock: as of computed_at.';
COMMENT ON COLUMN public.auction_readiness.market_score IS
'Market dimension, 0 to 100, smallint NOT NULL, default 0. Current rule: the latest nuke_estimates row, an estimate 10, confidence_score 50 or more 10 and 70 or more 5, input_count 3 or more 15 and 5 or more 5; heat_score above 50 5 and deal_score above 50 5 (the vehicles value, else the estimate); 10 when no listing observation mentions no sale, withdrawn or reserve not met, else 3; 10 when a sale price is recorded (sale_price, sold_price or canonical_sold_price); 5 when price_confidence is high; analysis_signals of severity ok or info, 3 or more 5 and 6 or more 5; capped at 100. Since migration 20261007080000 (2026-10-07) failed-run placeholder signals (score NULL with an error in value_json) no longer count; rows computed before it counted them. Current rows 10 .. 75, median 40; first-scorer rows 10 .. 70, median 45 (2026-10-07). Unit: points (0 to 100). Source: compute_auction_readiness over nuke_estimates, vehicles, vehicle_observations and analysis_signals. Grain: one vehicle. Clock: as of computed_at.';
COMMENT ON COLUMN public.auction_readiness.condition_score IS
'Condition dimension, 0 to 100, smallint NOT NULL, default 0. Current rule: vehicles.condition_rating times 10, at most 80, plus 10 when the rating is 8 or more; 5 without a rating; at least 50 and 10 more when the vehicle has a vehicle_observations row of kind condition; 10 more when ownership_verified; capped at 100. Current rows 5 .. 100, median 5; first-scorer rows 0 .. 80, median 0 (2026-10-07). Unit: points (0 to 100). Source: compute_auction_readiness over vehicles and vehicle_observations. Grain: one vehicle. Clock: as of computed_at.';

-- ── Gaps and coaching ──────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.auction_readiness.top_gaps IS
'Every gap the scorer found, ordered by points descending (all of them, not a top-N cut), jsonb NOT NULL, default []. Each element has dimension, gap (a fixed text such as No VIN, No documents uploaded or Missing required zone: <zone>), points (the dimension points the scorer assigns the gap, 8 to 100 on current rows; not composite points) and action (DATA_SUPPLY, PHOTO_UPLOAD, DOC_UPLOAD, NARRATIVE_WRITE or VERIFY_CLAIM); the No photos gap adds coaching_prompt. Identical to coaching_plan on all 378,598 rows and never empty (2026-10-07). In a 1% block sample of 3,569 rows: 2 to 17 elements, median 10 on current rows and 14 on first-scorer rows; current dimension names identity, photo, doc, desc, market, condition; first-scorer rows name photos, documentation and description, use other texts (Trim not specified, Highlights not populated, VIN missing) and carry a coaching key on zone gaps. Read by get_auction_readiness_batch and the view supplier_vehicle_readiness. Unit: none (jsonb array). Source: compute_auction_readiness. Grain: one vehicle. Clock: as of computed_at.';
COMMENT ON COLUMN public.auction_readiness.coaching_plan IS
'Meant as the full ordered action list (docs/strategy/auction-readiness-strategy.md), jsonb, nullable. Both scorers return the same array for top_gaps and coaching_plan, so it equals top_gaps on all 378,598 rows and is never NULL (2026-10-07); see top_gaps for its shape. Shown by AuctionReadinessPanel.tsx (which RLS gives no row) and the get_coaching_plan tool of mcp-connector. Unit: none (jsonb array). Source: compute_auction_readiness. Grain: one vehicle. Clock: as of computed_at.';

-- ── Photo coverage ─────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.auction_readiness.photo_zones_present IS
'Distinct vehicle_images.vehicle_zone codes among the images of the vehicle (current rule: any image; the first scorer kept only the 20 universal zones of photo_coverage_requirements found on non-duplicate images), text[], nullable, default {}. Non-empty on 10,331 rows (2.7%, 2026-10-07): 35,599 entries of 52 codes, the most frequent ext_driver_side 6,426, ext_front_driver 5,270, detail_badge 4,134, int_dashboard 3,805, mech_engine_bay 3,171 and ext_undercarriage 2,287. In a 1% block sample the median where non-empty is 1 zone on current rows and 5 on first-scorer rows, at most 18. Empty means no image of the vehicle carried a zone when it was scored, not that it has no photos. Unit: none (text array of zone codes). Source: compute_auction_readiness over vehicle_images. Grain: one vehicle. Clock: as of computed_at.';
COMMENT ON COLUMN public.auction_readiness.photo_zones_missing IS
'Photo requirements not covered, text[], nullable, default {}. Its meaning changed with the scorer. Since prod migration 20260411091759 fix_ars_mvps_zone_mapping (2026-04-11 09:17Z; 83,724 rows): the names of the 8 minimum viable photo set requirements (engine_bay, exterior_front_34, exterior_rear_34, interior_full, trunk, wheels, undercarriage, vin_plate) that no alias zone in photo_zones_present satisfies (check_mvps_zone_coverage); 0 to 8 names. On the 70,515 rows computed 2026-03-23 .. 2026-04-11: all 8 names on every row, whatever the zones, because the alias mapping did not exist yet. On the 224,359 first-scorer rows: raw zone codes of the 20 universal zones of photo_coverage_requirements not found (detail_odometer, int_door_panel, ext_roof and others), 3 to 20 per row. Empty on 44 rows (2026-10-07). Read by ChannelSwitchboard.tsx (which RLS gives no row) and the get_coaching_plan tool of mcp-connector. Unit: none (text array). Source: compute_auction_readiness. Grain: one vehicle. Clock: as of computed_at.';
COMMENT ON COLUMN public.auction_readiness.mvps_complete IS
'Whether the zones cover all 8 minimum viable photo set requirements (check_mvps_zone_coverage), boolean, nullable, default false. true on 53 rows (2026-10-07): 44 computed since 2026-04-11 and 9 first-scorer rows; never true on the 70,515 rows of 2026-03-23 .. 2026-04-11 (see photo_zones_missing). When true the photo score is at least 70. Unit: none (boolean). Source: compute_auction_readiness. Grain: one vehicle. Clock: as of computed_at.';

-- ── Staleness and outcome fields (never varied) ────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.auction_readiness.is_stale IS
'Intended staleness flag (docs/strategy/auction-readiness-strategy.md: a daily job would set it when computed_at is over 30 days old and no data event followed), boolean, nullable, default false. false on all 378,598 rows (2026-10-07): both writers set it false and no job, function or trigger sets it true. The mcp-connector tool get_auction_readiness recomputes a stale row, so that branch never runs. Unit: none (boolean). Source: the writers (constant false). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.auction_readiness.stale_reason IS
'Intended reason for is_stale, text, nullable. NULL on all 378,598 rows (2026-10-07): both writers set it NULL and nothing else writes it. Unit: none (text). Source: none (never set). Grain: one vehicle. Clock: n/a.';
COMMENT ON COLUMN public.auction_readiness.last_data_event_at IS
'Meant as the time of the newest data event the score reflects (the strategy doc; the former table comment said the newest input considered). Both writers set it to now(), the clock they also write to computed_at, and it equals computed_at on all 378,598 rows (2026-10-07), so it records when the row was scored, not when its inputs changed. timestamptz, nullable, no default. Unit: timestamptz. Source: the writers (now()). Grain: one vehicle. Clock: write time of the score, equal to computed_at.';
COMMENT ON COLUMN public.auction_readiness.rejection_penalties IS
'Intended penalties from platform rejections of a submission (the outcome loop of the strategy doc), jsonb, nullable, default []. [] on all 378,598 rows (2026-10-07): compute_auction_readiness returns an empty list under this name and neither writer stores it, so the column keeps its default. Unit: none (jsonb array). Source: column default. Grain: one vehicle. Clock: n/a.';

-- ── Clock ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.auction_readiness.computed_at IS
'When the row was last scored: now() of the writing transaction (persist_auction_readiness or recompute_ars_dimension), timestamptz, nullable, default now(), not indexed. Filled on every row, 2026-03-20 08:05Z .. 2026-10-07 12:17Z (2026-10-07); by month 2026-03 283,625, 2026-04 13,812, 2026-05 337, 2026-06 29,949, 2026-07 46,324, 2026-08 none, 2026-09 4,498 (09-27 .. 09-30), 2026-10 53. Before 2026-03-23 07:12Z the first scorer wrote, from 2026-03-23 14:16Z the current one (see composite_score). Overwritten on every recompute, also when no score changes; there is no created_at, so when a vehicle was first scored is not kept. Exposed as ars_computed_at by the view supplier_vehicle_readiness. Unit: timestamptz. Source: the writer clock. Grain: one vehicle. Clock: derived (when scored).';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.auction_readiness'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'auction_readiness: every column has a comment';
  ELSE
    RAISE NOTICE 'auction_readiness columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
