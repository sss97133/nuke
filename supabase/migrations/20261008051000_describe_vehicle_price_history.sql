-- Describe vehicle_price_history: all 18 columns (0 of 18 had a COMMENT ON COLUMN before; catalog count on prod,
-- 2026-10-07) and a corrected table comment. Comments only.
-- Describe stage of the repair loop (docs/ledger/theory/data-machine-cases.md section 12; data-machine.md
-- "the database describes itself"). Written table in the atlas: 410,327 rows on 2026-10-07 16:30Z by exact count (the
-- atlas estimate of 381,960 is a stale pg_class.reltuples); rows keep arriving (the newest created 16:23Z).
--
-- METHOD (read 2026-10-07 16:29-16:40Z UTC):
--   Columns, types, defaults, constraints (with convalidated), indexes, triggers, policies (with their role lists), RLS,
--   grants (has_table_privilege for anon and authenticated) and existing comments from pg_attribute, pg_attrdef,
--   pg_constraint, pg_indexes, pg_trigger, pg_policy, pg_class and pg_description; foreign keys in and views from
--   pg_constraint and pg_depend (none). Above the 200,000-row line, so: exact over the whole table (96 MB heap, read
--   only) only for the row count, the distinct vehicles, min and max of the clocks, the counts by source and price_type,
--   by creation month, by outlier reason, the fills of the sparse columns, the as_of = created_at comparison and the
--   repeated values per vehicle and type (one window pass); the rows written since the server start are an exact
--   filtered count; value shapes come from a 1% block sample (TABLESAMPLE SYSTEM (1) REPEATABLE (20261007), 3,233 rows).
--   What anon can read comes from a count over that sample under SET LOCAL ROLE anon in a read-only transaction (the
--   exact count exceeded the timeout). "Filled" means non-NULL.
--   Writers and readers from code at origin/main 1a9c80357 (supabase/functions, supabase/migrations, scripts,
--   nuke_frontend/src, mcp-server, apps; git history for the deleted writer): the creating file
--   nuke_frontend/supabase/sql/vehicle_price_history.sql (the first 8 columns; not in prod migration history);
--   20251101000002_create_vehicle_price_history.sql (policies, the migration_seed backfill; prod migration of that
--   version); 20251101000007_fix_vehicle_price_history_function.sql; 20260113193000_price_trend_outliers_and_baselines.sql
--   (is_outlier, outlier_reason, the ratio_vs_neighbor pass); 20261006100000_price_history_sale_clock.sql (the sale clock);
--   20261006113000_merge_writer_reparent_children.sql; 20261006073000_table_purpose_live_tables.sql (the former table
--   comment); 20261007002507_declare_table_owners_1.sql (the pipeline_registry row); scripts/backfill-sold-prices.ts and
--   scripts/cleanup-video-thumbnail-vehicles.js; the web files DealerTransactionInput.tsx, PriceHistoryModal.tsx,
--   PriceAnalysisPanel.tsx and VehicleROISummaryCard.tsx (nuke_frontend/src/components/vehicle),
--   nuke_frontend/src/pages/admin/BulkPriceEditor.tsx and PriceCsvImport.tsx,
--   nuke_frontend/src/services/vehiclePriceTrackingService.ts and vehicleDeduplicationService.ts, and
--   nuke_frontend/src/pages/vehicle-profile/hooks/useVehicleHeaderData.ts; the deleted edge function vehicle-expert-agent
--   (read at 7f7ce3ea7; removed by 276a6e9cc on 2026-03-29). Bodies read with pg_get_functiondef: the 8 live functions
--   whose body names the table (log_vehicle_price_history, get_vehicle_price_trend, get_vehicle_roi_summary,
--   market_segment_stats, set_vehicle_price_baseline, merge_vehicle_into_primary_by_url, rehydrate_profile_merge,
--   auto_merge_duplicates_with_notification), with their EXECUTE grants; pg_trigger (trg_log_vehicle_price_history on
--   vehicles); cron.job (none names the table); write_receipts (no rows); pg_stat_user_tables; pipeline_registry (1 row;
--   none is added or changed here); the deployed function list read through the management API (328 functions,
--   2026-10-07; none named vehicle-expert-agent).
-- LIMITS:
--   The db_trigger rows do not record which writer changed the vehicles column; the writer of the 28 backfill_vehicles
--   rows of 2025-10-05 and the migration that added the columns is_estimate through notes are not recorded. The anon
--   share is from a 1% block sample. Rows arrive while this is read, so counts read minutes apart differ by a few rows.
--   pg_stat_user_tables counters began at the last server start (2026-09-29 09:20Z). The rows hold prices of vehicles:
--   quoted values are price_type, source, proof and outlier codes, column and function names and counts only; no price,
--   no vehicle id, no user id and no note text.
-- CHANGED EXISTING COMMENTS:
--   Table: it said "Price history of vehicles: one row per price of one type (sale, ask, bid, estimate) as of a date
--   (grain: vehicle x price_type x as_of), with proof and outlier flags. Event time = as_of (2020 .. 2026 in a 1% sample).
--   Ingest time = created_at. Writers: SQL log_vehicle_price_history and the vehicle merge functions
--   (merge_vehicle_into_primary_by_url, rehydrate_profile_merge); scripts/backfill-sold-prices.ts." Corrected: the types
--   are msrp, purchase, current, asking and sale (bid and estimate cannot occur); a row is one change of one price column
--   of vehicles, not a price as of a date; as_of is the write time on 99.9% of rows, not an event time; it spans
--   2018-04-30 .. 2026-10-07; the merge functions repoint rows and write no price; scripts/backfill-sold-prices.ts wrote
--   20 rows on 2025-12-21 and is not a live writer. Added: the other writers, the liveness, the readers and the access.
--   There were no column comments.

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

COMMENT ON TABLE public.vehicle_price_history IS
'Change log of the five price columns of vehicles: one row each time msrp, purchase_price, current_value, asking_price or sale_price of a vehicle changed to a non-NULL value (grain: one change of one price column of one vehicle), plus 135 rows that older writers inserted directly. 410,327 rows on 2026-10-07 16:30Z (the atlas estimate of 381,960 is a stale reltuples) for 282,678 vehicles. By price_type: sale 259,811, msrp 87,935, current 47,067, asking 15,461, purchase 53. Writer: the trigger trg_log_vehicle_price_history (AFTER UPDATE OF those five columns on vehicles, FOR EACH ROW, enabled) and its function log_vehicle_price_history (SECURITY DEFINER) wrote 410,192 rows (99.97%, source db_trigger); it flags a value more than 20 times above or below the previous value of the same type as an outlier and never skips a row. The rows record when the copy in vehicles changed, not when the market set the price: as_of equals created_at on 409,950 rows (99.9%), and 230,458 rows (56.2%) carry a created_at in 2026-02. Since 20261006100000_price_history_sale_clock.sql (first such row 2026-10-06 00:30Z) a sale row takes the sale date of the vehicle when one is set (240 rows by 2026-10-07); older rows were not replayed. Other writers, none active: the edge function vehicle-expert-agent (55 rows, 2025-11-01 .. 2025-12-13; removed by commit 276a6e9cc on 2026-03-29, not deployed), the backfill in 20251101000002_create_vehicle_price_history.sql (29 rows), a backfill whose writer is not recorded (28 rows, 2025-10-05), scripts/backfill-sold-prices.ts (20 rows, 2025-12-21) and the web form DealerTransactionInput.tsx (3 rows, 2025-11-02). The form writers BulkPriceEditor.tsx, PriceCsvImport.tsx and vehiclePriceTrackingService.ts never landed a row (no row carries admin_bulk_editor, admin_csv_import or manual_entry). Row moves: merge_vehicle_into_primary_by_url and auto_merge_duplicates_with_notification repoint the rows of a duplicate vehicle to the primary, rehydrate_profile_merge moves rows older than a primary vehicle to a new vehicle, scripts/cleanup-video-thumbnail-vehicles.js repoints or deletes rows, and deleting a vehicle deletes its rows (ON DELETE CASCADE). Liveness: pg_stat_user_tables counts 1,288 inserts (exactly the rows created since: sale 1,249, msrp 23, asking 16), 4 updates and 0 deletes since the server last started (2026-09-29 09:20Z; read 16:29Z); the newest row was created 2026-10-07 16:23Z. Readers: get_vehicle_price_trend (SECURITY DEFINER, EXECUTE for anon; answers only for a public vehicle or a caller with access; called by the vehicle header, useVehicleHeaderData.ts), get_vehicle_roi_summary (SECURITY INVOKER; VehicleROISummaryCard.tsx), market_segment_stats (SECURITY DEFINER, EXECUTE for anon; segment averages only), set_vehicle_price_baseline (EXECUTE for authenticated; it writes vehicle_price_baselines, which does not exist on prod, so it fails; called by PriceHistoryModal.tsx), and in the browser PriceHistoryModal.tsx, PriceAnalysisPanel.tsx, DealerTransactionInput.tsx and vehiclePriceTrackingService.ts. pipeline_registry holds one table-level row (2026-10-07: owner log_vehicle_price_history, do_not_write_directly true). No views, cron jobs, write receipts or foreign keys in. Access: RLS is on. SELECT for every role on rows whose vehicle has is_public true (anon reads 2,466 of 3,233 rows, 76.3%, of a 1% block sample on 2026-10-07) and for owners on every row of their vehicles. INSERT for any signed-in account (WITH CHECK auth.uid() IS NOT NULL), on any vehicle and with any value, source and as_of; UPDATE and DELETE of the rows whose logged_by is the caller. anon and authenticated hold SELECT, INSERT, UPDATE, DELETE and TRUNCATE. seller_name, buyer_name and proof_url are never filled. Clocks: as_of is the write time of the vehicles update, except sale rows since 2026-10-06 whose vehicle has a sale date (that day at 00:00 UTC) and the 135 directly inserted rows (the date their writer gave); created_at is the insert time.';

-- ── Identity ───────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_price_history.id IS
'Surrogate key of the price row, uuid NOT NULL, gen_random_uuid() default, the PRIMARY KEY. 410,327 values (2026-10-07). No foreign key points at it on prod (vehicle_price_baselines of 20260113193000 would, but that table does not exist). Unit: none (uuid). Source: column default. Grain: one change of one price column. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_price_history.vehicle_id IS
'Vehicle whose price changed: a vehicles.id, uuid NOT NULL, foreign key ON DELETE CASCADE (validated), so deleting a vehicle deletes its price rows. 282,678 distinct vehicles (2026-10-07). Indexed alone (idx_vehicle_price_history_vehicle), with as_of (idx_vph_vehicle_as_of) and with price_type and as_of (idx_vph_vehicle_type_asof). The merge functions merge_vehicle_into_primary_by_url, auto_merge_duplicates_with_notification and rehydrate_profile_merge rewrite it to move rows between vehicles; vehicleDeduplicationService.ts deletes the rows of a merged vehicle in the browser (RLS lets it delete only the rows the caller logged). RLS reads are decided through vehicles.is_public, user_id and owner_id of this vehicle. Unit: none (uuid). Source: the writer (NEW.id of the vehicles update). Grain: one change of one price column. Clock: n/a.';

-- ── The price ──────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_price_history.price_type IS
'Which price of the vehicle the row records, text NOT NULL, CHECK msrp, purchase, current, asking or sale (two identical CHECK constraints, vehicle_price_history_price_type_check and vph_price_type_check), indexed (idx_vehicle_price_history_type). Each type is one column of vehicles: msrp, purchase_price, current_value (the internal value signal of Nuke, not a market observation), asking_price, sale_price. Exact counts (2026-10-07): sale 259,811, msrp 87,935, current 47,067, asking 15,461, purchase 53; the last purchase row was created 2026-05-24 and the last current row 2026-07-26, so since then only sale, msrp and asking rows arrive. Readers filter on it (get_vehicle_price_trend defaults to current). Unit: none (text code). Source: the writer (the vehicles column that changed). Grain: one change of one price column. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_price_history.value IS
'The new value of the vehicles price column, numeric NOT NULL. Not checked or cleaned: in a 1% block sample of 3,233 rows 17 values are 0 or less and 54 are under 100 (2026-10-07); the outlier flag marks only 20-fold jumps. The trigger logs only a change to a non-NULL value, so a value that repeats the previous value of the same vehicle and type (5,339 sale, 60 current, 13 asking and 1 purchase rows, exact) means the column was NULL in between, a second writer logged the same change, or a merge brought in the rows of a duplicate vehicle. No value is quoted here. Unit: currency amount of the vehicles column (USD by convention; no currency column). Source: vehicles.msrp, purchase_price, current_value, asking_price or sale_price (older writers: their own value). Grain: one change of one price column. Clock: as of as_of.';
COMMENT ON COLUMN public.vehicle_price_history.source IS
'Code of the writer, text NOT NULL, default vehicles (no row carries the default). Exact counts (2026-10-07): db_trigger 410,192 (log_vehicle_price_history), expert_agent 55 (the deleted edge function vehicle-expert-agent, 2025-11-01 .. 2025-12-13), migration_seed 29 (the backfill of 20251101000002_create_vehicle_price_history.sql), backfill_vehicles 28 (writer not recorded, 2025-10-05), bat_scraped 16, estimated_from_value 2 and estimated_from_asking 2 (scripts/backfill-sold-prices.ts, 2025-12-21), dealer_input 3 (DealerTransactionInput.tsx, 2025-11-02). It names the writer of the row, not where the price came from: a db_trigger row does not say which writer changed the vehicles column. Unit: none (text code). Source: the writer. Grain: one change of one price column. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_price_history.confidence IS
'Writer-assigned confidence in the price, integer NOT NULL, default 80, no CHECK. 80 on every row but 78 (2026-10-07): the trigger never sets it, so all db_trigger rows carry the default; vehicle-expert-agent wrote its valuation confidence (60, 70 or 85 on 55 rows), scripts/backfill-sold-prices.ts 70 (20 rows) and DealerTransactionInput.tsx 70 (3 rows, approximate). get_vehicle_price_trend does not read it. Unit: points (0 to 100, by convention). Source: column default (older writers: their own value). Grain: one change of one price column. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_price_history.is_estimate IS
'Whether the writer marked the price as an estimate, boolean, nullable, default false. true on 20 rows, all from scripts/backfill-sold-prices.ts (bat_scraped 16, estimated_from_value 2, estimated_from_asking 2; 2025-12-21); false on every other row, the trigger never sets it (2026-10-07). Unit: none (boolean). Source: the writer. Grain: one change of one price column. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_price_history.is_approximate IS
'Whether the writer marked the price as approximate, boolean, nullable, default false. true on the 3 dealer_input rows of DealerTransactionInput.tsx (2025-11-02); false on every other row (2026-10-07). Unit: none (boolean). Source: the writer. Grain: one change of one price column. Clock: n/a.';

-- ── Who and proof ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_price_history.logged_by IS
'Account that made the change: an auth.users.id, uuid, nullable, foreign key (validated, no ON DELETE action). The trigger writes coalesce(auth.uid(), vehicles.user_id, owner_id, uploaded_by), so it is NULL when a service-role writer updates a vehicle without an owner; filled on 443 rows, by 2 distinct accounts (2026-10-07). The RLS UPDATE and DELETE policies admit the rows whose logged_by is the caller. anon reads it on rows of public vehicles. No user id is quoted here. Unit: none (uuid). Source: log_vehicle_price_history (older writers: the signed-in user or the seeded uploader). Grain: one change of one price column. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_price_history.proof_type IS
'Kind of proof for the price, text, nullable, no CHECK. verbal on the 3 dealer_input rows; NULL on every other row (2026-10-07). DealerTransactionInput.tsx writes bat_listing, url or verbal by the proof URL it is given. Unit: none (text code). Source: DealerTransactionInput.tsx. Grain: one change of one price column. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_price_history.proof_url IS
'Link to the proof of the price, text, nullable. NULL on all 410,327 rows (2026-10-07): DealerTransactionInput.tsx and vehiclePriceTrackingService.ts would write it and have landed no row with one. Unit: none (URL). Source: none (never written). Grain: one change of one price column. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_price_history.seller_name IS
'Name of the seller of a recorded sale, text, nullable. NULL on all 410,327 rows (2026-10-07): only vehiclePriceTrackingService.ts writes it (a manual sale entry) and it has landed no row. A person name if ever filled, and the public SELECT policy would show it to anon on public vehicles. Unit: none (text). Source: none (never written). Grain: one change of one price column. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_price_history.buyer_name IS
'Name of the buyer of a recorded sale, text, nullable. NULL on all 410,327 rows (2026-10-07): only vehiclePriceTrackingService.ts writes it (a manual sale entry) and it has landed no row. A person name if ever filled, and the public SELECT policy would show it to anon on public vehicles. Unit: none (text). Source: none (never written). Grain: one change of one price column. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_price_history.notes IS
'Free text from the writer, text, nullable. Filled on 50 rows (2026-10-07): the 29 migration_seed rows (a fixed text naming the seeded field), the 20 rows of scripts/backfill-sold-prices.ts (Backfilled from and the source code) and 1 dealer_input row (free text, not quoted). The trigger never writes it. Unit: none (text). Source: the writer. Grain: one change of one price column. Clock: n/a.';

-- ── Outlier flags ──────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_price_history.is_outlier IS
'Whether the value is flagged as implausible, boolean NOT NULL, default false. true on 4,638 rows (1.1%, 2026-10-07): log_vehicle_price_history flags a value more than 20 times above or below the latest earlier value of the same vehicle and type at insert (ratio_vs_previous), and 20260113193000_price_trend_outliers_and_baselines.sql flagged once the rows more than 20 times off either neighbor (ratio_vs_neighbor). A flagged row is kept, not removed. get_vehicle_price_trend skips flagged rows for the latest and baseline values and counts them as outlier_count; get_vehicle_roi_summary and market_segment_stats do not skip them. Unit: none (boolean). Source: log_vehicle_price_history and the 2026-01-13 pass. Grain: one change of one price column. Clock: n/a.';
COMMENT ON COLUMN public.vehicle_price_history.outlier_reason IS
'Rule that flagged the row, text, nullable, set exactly when is_outlier is true. ratio_vs_previous on 3,650 rows (sale 3,643, current 3, asking 2, purchase 2; created 2026-01-20 .. 2026-10-02), from the trigger; ratio_vs_neighbor on 988 rows (asking 841, sale 109, current 38; created 2025-10-05 .. 2026-01-13), from the one-time pass of 20260113193000 (2026-10-07). Unit: none (text code). Source: log_vehicle_price_history and the 2026-01-13 pass. Grain: one change of one price column. Clock: n/a.';

-- ── Clocks ─────────────────────────────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN public.vehicle_price_history.as_of IS
'Meant as the moment the price held; on almost every row it is the write time. timestamptz NOT NULL, default now(), indexed with vehicle_id (idx_vph_vehicle_as_of, idx_vph_vehicle_type_asof). log_vehicle_price_history writes coalesce(vehicles.updated_at, now()) of the update for every type, which equals created_at: 409,950 of 410,327 rows (99.9%, 2026-10-07). Since 20261006100000_price_history_sale_clock.sql (first such row 2026-10-06 00:30Z) a sale row takes vehicles.sale_date at 00:00 UTC when it is set (240 rows by 2026-10-07 16:30Z) and the write time otherwise; earlier rows were not replayed. The 135 directly inserted rows carry the date their writer gave. Range 2018-04-30 .. 2026-10-07. Readers order by it to take the latest or baseline value (get_vehicle_price_trend, get_vehicle_roi_summary, market_segment_stats), so a series follows the order in which the vehicles copy changed, not market time. Unit: timestamptz. Source: vehicles.updated_at or vehicles.sale_date (older writers: their own date). Grain: one change of one price column. Clock: write time (event time only for sale rows with a sale date since 2026-10-06 and for the directly inserted rows).';
COMMENT ON COLUMN public.vehicle_price_history.created_at IS
'When the row was inserted, timestamptz NOT NULL, default now(), not indexed (20251101000002 declared idx_vehicle_price_history_date on it; prod lacks it). 2025-10-05 05:17Z .. 2026-10-07 16:23Z; by month (2026-10-07): 2026-02 230,458, 2026-07 58,651, 2026-04 37,283, 2026-03 31,910, 2026-09 17,644, 2026-08 13,901, 2026-01 9,117, 2025-12 6,420, 2026-05 3,033, 2025-11 609, 2026-10 731, 2026-06 524, 2025-10 46. Unit: timestamptz. Source: column default (the inserting transaction). Grain: one change of one price column. Clock: ingest time (equal to as_of on 99.9% of rows).';

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(a.attname, ', ' ORDER BY a.attnum) INTO missing
  FROM pg_attribute a
  WHERE a.attrelid = 'public.vehicle_price_history'::regclass
    AND a.attnum > 0
    AND NOT a.attisdropped
    AND col_description(a.attrelid, a.attnum) IS NULL;
  IF missing IS NULL THEN
    RAISE NOTICE 'vehicle_price_history: every column has a comment';
  ELSE
    RAISE NOTICE 'vehicle_price_history columns still without a comment: %', missing;
  END IF;
END
$$;

COMMIT;
