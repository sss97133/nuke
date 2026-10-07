-- Describe analysis_signals: all 26 columns, none had a COMMENT ON COLUMN (0 of 26 described before, catalog count on
-- prod, 2026-10-07) and an extended table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Read-only table in the atlas: 1,254,910 rows on 2026-10-07 02:46Z by exact count (the
-- atlas estimate of 1,247,836 is a stale pg_class.reltuples), no insert or update since the statistics counters began.
--
-- METHOD (read 2026-10-07 UTC):
--   Columns, types, defaults, constraints, indexes, triggers, policies, grants and existing comments from pg_attribute,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy, information_schema and pg_description. Fill, values and date windows
--   are exact counts over the whole table (603 MB heap, read only). The key sets of value_json and the shape of
--   recommendations come from a 3% block sample (TABLESAMPLE SYSTEM (3) REPEATABLE (20261007), 36,508 rows); the first
--   reason per widget from the same sample, with the failure rows counted exactly. What anon can read comes from a count
--   under SET LOCAL ROLE anon in a read-only transaction. "Filled" means non-NULL and, for arrays, non-empty.
--   Writers and readers from code at origin/main 2b9e1d0f3 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-servers, apps): the edge function analysis-engine-coordinator (upsertSignal, handleAcknowledge,
--   handleDismiss), the edge function api-v1-analysis, scripts/backfill-analysis-signals.mjs, the migration
--   20260306000001_analysis_engine_foundation.sql that creates the table, the bodies of the 2 live public SQL functions that
--   name the table (compute_auction_readiness, get_day_card_context; neither writes it), the 1 trigger on the table, the 2
--   pg_cron jobs that call the coordinator (both inactive), write_receipts (no rows for this table), pg_stat_user_tables
--   (0 writes since the counters began) and pipeline_registry (4 rows, all owned by analysis-engine-coordinator: the table,
--   score, severity and recommendations; no row is added or changed here).
-- LIMITS:
--   Rows have no run log; runs are dated by computed_at. The split between real outputs and failure rows rests on the first
--   reason ("Widget <slug> computation failed" and "Widget <slug> failed: ..."), counted over the whole table and equal to
--   every row of the 10 widgets that never produced a result. Key sets of value_json are from a 3% block sample, so a rare
--   key may be missing. Valuation figures inside value_json (sale price, estimate, best price) are described by key only.
--   Quoted values are categorical codes, labels, reason templates, key names and function names only: no names, handles,
--   contacts, ids or amounts.
-- CHANGED EXISTING COMMENTS:
--   Table comment only: it said one row per widget per vehicle, upserted on recomputation, and nothing else; it now states
--   the dormancy since 2026-04-14, that 55% of the rows record failed widget runs, the live reader that counts them, the
--   slugs a reader asks for that no row has, the access and the clocks. There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.analysis_signals IS
'Per-vehicle widget outputs of the Analysis Engine: one row per widget per vehicle (grain: one vehicle x one widget; UNIQUE (vehicle_id, widget_slug)), upserted on recomputation, so it holds the latest output only; the changes are in analysis_signal_history. 1,254,910 rows on 2026-10-07 (the atlas estimate of 1,247,836 is a stale reltuples) for 70,014 vehicles and 19 of the 20 widgets in analysis_widgets (comment-refinery-coverage has none): 57,930 vehicles have all 19 rows, 9,686 have 14, 602 have one. Dormant: computed_at falls on 2026-03-23 .. 2026-04-14 on every row, created_at on 2026-03-07 .. 2026-04-14, and every row is past its stale_at (latest 2026-04-21). The only writer is the edge function analysis-engine-coordinator (pipeline_registry owner; also run by hand through scripts/backfill-analysis-signals.mjs); both pg_cron jobs that call it are inactive (analysis-engine-sweep every 15 minutes, analysis-widget-backfill every 10 minutes). 55.0% of the rows (690,554) record a failed widget run, not an analysis: severity info, no score, value_json holding only error, and a reason of the form Widget <slug> computation failed (405,286) or Widget <slug> failed: Rate limit exceeded for function (285,267); they are every row of 10 widgets that never produced a result (broker-exposure, buyer-qualification, commission-optimizer, completion-discount, deal-readiness, geographic-arbitrage, presentation-roi, rerun-decay, sell-through-cliff, time-kills-deals). Real outputs come from 5 core widgets (build-progress, data-quality, identity-confidence, photo-coverage, price-position; first computed 2026-03-29) and 4 market widgets (auction-house-optimizer, comp-freshness, market-velocity, seasonal-pricing); 562,400 rows have a score. Only 443 rows (0.04%) were ever recomputed after their insert. Readers: compute_auction_readiness() counts a vehicle''s rows with severity ok or info (3 or more add 5 points to the market dimension of the auction readiness score and 6 or more add 5 more; 69,134 vehicles have 6 or more and 15,354 of them reach it only through rows without a score), so the failure rows count as signals in a live score; get_day_card_context() asks for four widget slugs written with underscores (build_progress, cost_analysis, labor_efficiency, specialty_mix) that no row has, so its signals are always empty; the edge functions api-v1-analysis (reads, acknowledge, dismiss) and mcp-connector (vehicle bundle); and the vehicle profile section AnalysisSignalsSection. RLS lets anyone read every row (policy analysis_signals_read is true; anon counted all 61,516 critical rows on 2026-10-07); writes are service_role only. Clocks: computed_at = when the widget ran, created_at = first insert, updated_at = last upsert.';

-- ── Identity and keys ───────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.analysis_signals.id IS
'Surrogate key of the signal row. Unit: none (uuid). Source: gen_random_uuid() default. Referenced by analysis_signal_history.signal_id (ON DELETE CASCADE). The working key is (vehicle_id, widget_slug), UNIQUE; the coordinator upserts on it, so the id stays the same across recomputations. api-v1-analysis acknowledge and dismiss take it as signal_id. Grain: one vehicle x one widget. Clock: n/a.';
COMMENT ON COLUMN public.analysis_signals.vehicle_id IS
'Vehicle the signal is about: a vehicles.id, foreign key ON DELETE CASCADE, NOT NULL, part of the UNIQUE key. 70,014 distinct vehicles (2026-10-07), none missing from vehicles. Rows per vehicle: 19 on 57,930 vehicles, 14 on 9,686, 1 on 602, the rest 2 .. 18. Which vehicles got rows was chosen by the coordinator sweep (new or stale vehicles), its backfill of auction-readiness-scored vehicles that have no signals and the manual script for the most-viewed vehicles, not at random. Unit: none (uuid). Grain: one vehicle x one widget. Clock: n/a.';
COMMENT ON COLUMN public.analysis_signals.widget_slug IS
'Widget that produced the row: analysis_widgets.slug, foreign key ON DELETE CASCADE, NOT NULL, part of the UNIQUE key. 19 values on 2026-10-07: the 10 failure-only widgets (67,900 .. 69,900 rows each: broker-exposure, buyer-qualification, commission-optimizer, completion-discount, deal-readiness, geographic-arbitrage, presentation-roi, rerun-decay, sell-through-cliff, time-kills-deals), the 5 core widgets (57,900 .. 58,300 rows each: build-progress, data-quality, identity-confidence, photo-coverage, price-position) and 4 market widgets (about 68,000 .. 69,000 each: auction-house-optimizer, comp-freshness, market-velocity, seasonal-pricing). Slugs use hyphens; get_day_card_context() asks for underscored spellings that no row has. Unit: none (text). Grain: one vehicle x one widget. Clock: n/a.';

-- ── Output ──────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.analysis_signals.score IS
'Widget output score, 0 .. 100 by the creating comment and the pipeline_registry row (numeric(5,2); no CHECK on the range). Filled on 562,400 rows (44.8%, 2026-10-07): the 5 core widgets and 4 market widgets; NULL on the 692,510 other rows, which include the 10 failure-only widgets. Each widget computes its own score from its own logic, so compare within one widget. pipeline_registry owner analysis-engine-coordinator, do not write directly. Read by mcp-connector and api-v1-analysis (ordered by score). Unit: score, 0 .. 100 (numeric(5,2)). Grain: one vehicle x one widget. Clock: as of computed_at.';
COMMENT ON COLUMN public.analysis_signals.label IS
'Categorical output of the widget, free text with no CHECK. Filled on 358,267 rows (28.5%, 2026-10-07): the 5 core widgets (Data Quality: Strong 43,447; Photo Coverage: Comprehensive 34,111; Price: Divergent 28,879; Identity: Verified 27,260; Build: No work tracked 57,932 of the 57,934 build-progress rows; and the other grades) and market-velocity (stable on 67,838). NULL on 896,643 rows: the failure-only widgets, auction-house-optimizer, comp-freshness, seasonal-pricing and 828 rows of others. The vehicle profile section hides a signal that has no label. Unit: none (text). Grain: one vehicle x one widget. Clock: as of computed_at.';
COMMENT ON COLUMN public.analysis_signals.severity IS
'Traffic-light state of the output, CHECK in (info, ok, warning, critical), filled on every row. Stored (2026-10-07): info 951,885, ok 189,129, warning 52,380, critical 61,516. info is both the neutral state of real widgets (market-velocity, seasonal-pricing and auction-house-optimizer are always info) and the state of every failure row, so info does not mean analyzed. 57,932 of the 57,934 build-progress rows are critical because no work is tracked. Order used when comparing runs: critical worst, then warning, info, ok best. Partial index idx_analysis_signals_severity covers warning and critical. pipeline_registry owner analysis-engine-coordinator. Unit: none (text). Grain: one vehicle x one widget. Clock: as of computed_at.';
COMMENT ON COLUMN public.analysis_signals.value_json IS
'Widget-specific structured output, a JSON object, NOT NULL, default {}, never empty on prod. Keys by widget (3% block sample of 36,508 rows, 2026-10-07): data-quality has_price, has_description, has_vin, image_count, fields_filled, fields_total, field_fill_pct, vehicle_id; identity-confidence vin, vin_confidence, has_full_vin, has_make, has_model, has_year, event_count, score; photo-coverage image_count, distinct_categories, category_breakdown, score; price-position sale_price, nuke_estimate, divergence_pct, price_status, score; build-progress session_count, work_order_count, total_hours, total_labor_cost, total_parts_cost, distinct_work_types, latest_session_date, days_since_last_session, completion_percentage, estimated_pct, score; comp-freshness comp_count, newest_comp_date, newest_comp_age_days, score; market-velocity sales_30d, sales_60d, sales_90d, label, score; seasonal-pricing vehicle, current_month, best_month, worst_month, overall_median, monthly_data, current_month_data, sample_months; auction-house-optimizer vehicle, platforms, platform_count, best_price, best_sell_through. The 10 failure-only widgets hold only the key error, which is 55.3% of the sampled rows (a few rows of real widgets also hold error). Valuation figures inside (sale price, estimate, best price) are listed by key only. Unit: none (jsonb). Grain: one vehicle x one widget. Clock: as of computed_at.';
COMMENT ON COLUMN public.analysis_signals.reasons IS
'Human-readable reasons, a text array, default {}. Non-empty on 1,251,861 rows (99.8%) and empty on 3,049 (2026-10-07). First reason by widget (3% sample): market-velocity Market velocity: <label> with listing counts and median days on market; build-progress No work sessions or work orders recorded; photo-coverage N total images; data-quality N/N fields populated (N%); auction-house-optimizer N platforms analyzed for this segment; comp-freshness N comps found, newest N days old; identity-confidence Full N-digit VIN present or Partial VIN present; price-position a sale price above or below the estimate in percent; seasonal-pricing Insufficient seasonal data for this segment; the failure-only widgets Widget <slug> computation failed (405,286 rows) or Widget <slug> failed: Rate limit exceeded for function (285,267 rows, 1 other). Matching that prefix separates failure rows from analyses. Copied to analysis_signal_history when the direction is not unchanged. The vehicle profile section hides a signal whose only reason mentions error or failure. Unit: none (text array). Grain: one vehicle x one widget. Clock: as of computed_at.';
COMMENT ON COLUMN public.analysis_signals.evidence IS
'Data points that drove the signal, a JSON object by design (creating comment). NULL on every row (2026-10-07): the coordinator copies result.evidence and no widget returns one. The vehicle profile section would hide a signal whose evidence contains error, 404 or failed. Unit: none (jsonb). Grain: one vehicle x one widget. Clock: as of computed_at.';
COMMENT ON COLUMN public.analysis_signals.confidence IS
'Widget confidence in its own output, 0 .. 1 (CHECK between 0 and 1), numeric(3,2). Filled on 562,400 rows (44.8%, 2026-10-07), the rows that have a score; NULL on the rest. One or two fixed values per widget, not a per-row probability: data-quality 0.95, photo-coverage 0.95, identity-confidence 0.90, market-velocity 0.40, and two values each for price-position (0.50, 0.85), auction-house-optimizer (0.50, 0.75), comp-freshness (0.50, 0.70), seasonal-pricing (0.40, 0.70) and build-progress (0.50, 0.80). Unit: probability, 0 .. 1 (numeric(3,2)). Grain: one vehicle x one widget. Clock: as of computed_at.';
COMMENT ON COLUMN public.analysis_signals.recommendations IS
'Suggested actions, a JSON array of objects with the keys action, priority and rationale, default []. Non-empty on 21.6% of the sampled rows (7,886 of 36,508, 2026-10-07): every sampled build-progress row and part of auction-house-optimizer, seasonal-pricing, price-position, identity-confidence, data-quality, photo-coverage and comp-freshness; never on the failure-only widgets or market-velocity. pipeline_registry owner analysis-engine-coordinator, do not write directly. Read by mcp-connector (vehicle bundle) and api-v1-analysis. Unit: none (jsonb array). Grain: one vehicle x one widget. Clock: as of computed_at.';

-- ── Input tracking and history ──────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.analysis_signals.input_hash IS
'Hash of the inputs the widget read, meant for staleness and dedup (creating comment: SHA256 of inputs). NULL on every row (2026-10-07): the coordinator selects it when it reads the existing row but never writes it, so a recomputation is never skipped for unchanged inputs. Unit: none (text). Grain: one vehicle x one widget. Clock: n/a.';
COMMENT ON COLUMN public.analysis_signals.input_summary IS
'Lightweight summary of the inputs, a JSON object by design. NULL on every row (2026-10-07); no writer sets it. Unit: none (jsonb). Grain: one vehicle x one widget. Clock: n/a.';
COMMENT ON COLUMN public.analysis_signals.previous_score IS
'Score before the last recomputation: the coordinator copies the existing score into it on each upsert. Filled on 212 rows (0.02%, 2026-10-07), the recomputed rows that had a score; NULL on a first computation (change_direction new). Unit: score, 0 .. 100 (numeric(5,2)). Grain: one vehicle x one widget. Clock: the computation before computed_at.';
COMMENT ON COLUMN public.analysis_signals.previous_severity IS
'Severity before the last recomputation, copied the same way as previous_score; the same four values as severity but no CHECK. Filled on 443 rows (0.04%, 2026-10-07), the rows recomputed after their insert; NULL on a first computation. Unit: none (text). Grain: one vehicle x one widget. Clock: the computation before computed_at.';
COMMENT ON COLUMN public.analysis_signals.changed_at IS
'When the severity last changed: the coordinator sets it to its run time on a first computation and whenever change_direction is not unchanged, and keeps the old value otherwise. Filled on every row (2026-10-07); on 1,254,467 rows it is the first-computation time because the row was never recomputed. Partial index idx_analysis_signals_changed covers improved and degraded rows. Unit: timestamptz. Grain: one vehicle x one widget. Clock: event time of the severity change as our run saw it.';
COMMENT ON COLUMN public.analysis_signals.change_direction IS
'How the severity moved at the last computation, CHECK in (improved, degraded, unchanged, new). Stored (2026-10-07): new 1,254,467, unchanged 420, degraded 13, improved 10, so only 443 rows (0.04%) were ever recomputed after insertion. Compared in the order critical, warning, info, ok (critical worst). A change other than unchanged also appends a row to analysis_signal_history. Unit: none (text). Grain: one vehicle x one widget. Clock: as of computed_at.';

-- ── Lifecycle clocks ────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.analysis_signals.computed_at IS
'When the widget ran: the coordinator clock on every upsert (default now()), NOT NULL. 2026-03-23 .. 2026-04-14 on every row (2026-10-07): 6,278 on 2026-03-23, 63,283 and 66,668 on 03-24 and 03-25, under 2,000 a day to 03-30, 33,620 on 03-31, then 51,758 .. 98,266 a day from 04-01 to 04-13 and 12,570 on 04-14. Our computation time, not an event time of the vehicle. It precedes created_at by the client-to-database gap on first computation (1,247,902 rows) and differs by more than a minute on the 443 recomputed rows. Unit: timestamptz. Grain: one vehicle x one widget. Clock: ingest time (the computation).';
COMMENT ON COLUMN public.analysis_signals.stale_at IS
'When the signal counts as stale: computed_at plus the widget stale_after_hours, written by the coordinator. 4 hours for deal-readiness and time-kills-deals, 6 for completion-discount, 24 for broker-exposure, buyer-qualification, comp-freshness, market-velocity, presentation-roi, rerun-decay and sell-through-cliff, 48 for build-progress, data-quality and photo-coverage, 72 for commission-optimizer, 168 for auction-house-optimizer, geographic-arbitrage, identity-confidence, price-position and seasonal-pricing. Filled on every row, 2026-03-23 .. 2026-04-21, so every row is stale on 2026-10-07. The coordinator sweep re-queues rows whose stale_at has passed; its job is inactive. Partial index idx_analysis_signals_stale. Unit: timestamptz. Grain: one vehicle x one widget. Clock: computed_at plus the widget window.';
COMMENT ON COLUMN public.analysis_signals.compute_time_ms IS
'How long the widget took, measured by the coordinator, in milliseconds (integer). Filled on every row (2026-10-07). Mean 20 ms on every failure-only widget (they never ran a real computation, minimum 0), 41 .. 98 ms on the five core widgets, 266 to 1,109 ms on market-velocity, comp-freshness, auction-house-optimizer and seasonal-pricing; maximum 45,235 ms. Unit: milliseconds (integer). Grain: one vehicle x one widget. Clock: n/a.';
COMMENT ON COLUMN public.analysis_signals.model_version IS
'Version stamp of the widget logic, default v1, no CHECK. v1 on every row (2026-10-07); the coordinator does not pass it, so a change of widget logic is not recorded here. Unit: none (text). Grain: one vehicle x one widget. Clock: n/a.';

-- ── User interaction ────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.analysis_signals.acknowledged_by IS
'Account that acknowledged or dismissed the signal, a user id with no foreign key. NULL on every row (2026-10-07). Written only by the coordinator actions acknowledge and dismiss (the caller id); api-v1-analysis sets acknowledged_at and dismissed_until without it. Unit: none (uuid). Grain: one vehicle x one widget. Clock: n/a.';
COMMENT ON COLUMN public.analysis_signals.acknowledged_at IS
'When a person marked the signal as seen. NULL on every row (2026-10-07). Written by the coordinator actions acknowledge and dismiss and by api-v1-analysis acknowledge; no row holds a value. Unit: timestamptz. Grain: one vehicle x one widget. Clock: event time (the acknowledgement).';
COMMENT ON COLUMN public.analysis_signals.dismissed_until IS
'End of a snooze: the coordinator action dismiss and api-v1-analysis dismiss (default 24 hours) set it. NULL on every row (2026-10-07). The vehicle profile section selects rows where it is NULL, so any value hides the signal, including a time already past. Unit: timestamptz. Grain: one vehicle x one widget. Clock: event time (the end of the snooze).';

-- ── Row clocks ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.analysis_signals.created_at IS
'When the row was first inserted: default now(), set by the database, not changed by a recomputation. 2026-03-07 .. 2026-04-14 (2026-10-07); 96,836 .. 98,228 rows a day on 2026-04-01 .. 04-03 and 90,431 on 04-13. Ingest time of the first computation. Unit: timestamptz. Grain: one vehicle x one widget. Clock: ingest time.';
COMMENT ON COLUMN public.analysis_signals.updated_at IS
'Set to now() by trigger trg_analysis_signals_updated_at (BEFORE UPDATE, update_analysis_updated_at()), so it moves only on an update. Differs from created_at on 443 rows (0.04%, 2026-10-07), the rows recomputed after their insert, 2026-03-23 .. 2026-04-14; equal to created_at on every other row. Selected by mcp-connector with each signal. Unit: timestamptz. Grain: one vehicle x one widget. Clock: ingest time of the last upsert.';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.analysis_signals'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'analysis_signals: every column has a comment';
  ELSE
    RAISE NOTICE 'analysis_signals columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
