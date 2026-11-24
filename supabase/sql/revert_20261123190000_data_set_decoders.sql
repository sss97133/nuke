-- Revert of 20261123190000_data_set_decoders.sql, 20261123191000_text_code_decode_window_fix.sql, 20261123192000_data_set_labels.sql,
-- 20261123193000_text_code_review_fixes.sql, 20261123194000_text_code_rescore_members.sql.
-- Order: labels, membership runs, reading runs, then objects.
--   select public.data_set_label_backfill_revert_v1('5d1a7c2e-0f3b-4c8e-9a61-20261123c001');
--   select public.data_set_membership_revert_v1('5d1a7c2e-0f3b-4c8e-9a61-20261123a006');
--   select public.text_code_decode_revert_v1('5d1a7c2e-0f3b-4c8e-9a61-20261123b001');   -- backs rows up, then deletes
-- Then restore data_set_candidates_v1 / data_set_basis_live / data_set_scope_vehicles / vehicle_data_sets from
-- 20261123181000, 20261123185000, 20261123180000 and 20261123182000, and run the block below.
begin;
DROP FUNCTION IF EXISTS public.data_set_label_backfill_v1(uuid);
DROP FUNCTION IF EXISTS public.data_set_label_backfill_revert_v1(uuid);
DROP FUNCTION IF EXISTS public.data_set_key_label_v1(text, text);
DROP FUNCTION IF EXISTS public.text_code_decode_v1(uuid, text, uuid, integer, integer, integer);
DROP FUNCTION IF EXISTS public.text_code_decode_revert_v1(uuid);
DROP FUNCTION IF EXISTS public.text_code_matches_v1(text);
DROP FUNCTION IF EXISTS public.text_code_rescore_v1(uuid[]);
-- vehicle_code_readings_backup is kept on purpose.
DROP TABLE IF EXISTS public.vehicle_code_readings;
DROP TABLE IF EXISTS public.vehicle_code_reading_runs;
UPDATE public.vehicle_decode_rules SET superseded_at = now()
 WHERE citation_url = 'http://www.drivinithome.com/firebird-vin-decoding/' AND superseded_at IS NULL AND cited_on = '2026-11-23';
ALTER TABLE public.data_set_members DROP CONSTRAINT IF EXISTS data_set_members_basis_type_check;
ALTER TABLE public.data_set_members ADD CONSTRAINT data_set_members_basis_type_check CHECK (basis_type IN ('observation',
  'field_evidence','vehicle_vin','vehicle_flag','comment_rubric'));
ALTER TABLE public.data_sets DROP CONSTRAINT IF EXISTS data_sets_set_kind_check;
ALTER TABLE public.data_sets ADD CONSTRAINT data_sets_set_kind_check CHECK (set_kind IN ('vin_cohort','vin_series','vin_engine',
  'plant_year','cowl_style','engine_block_casting','engine_code','trans_case_casting','trans_tail_casting','paint_code',
  'replica_cohort','comment_theme'));
commit;
