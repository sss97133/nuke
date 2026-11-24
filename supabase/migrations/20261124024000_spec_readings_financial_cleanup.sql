-- Spec readings: remove readings from sources the reader no longer takes (20261124024000), follow-up to 20261124023000.
-- 20261124023000 stopped reading financial field_evidence (invoices, receipts, statements, QuickBooks) and non-public
-- observations, but cleaned up only the observation readings. This backs up and removes both kinds that are still active
-- (including any a slice in flight wrote while 20261124023000 was applied), then rescores. It refuses to run if any of them are
-- already folded into sets. In production it found 0 financial readings at the time of writing.
-- Revert: none needed (removed rows stay in vehicle_code_readings_backup).

begin;
set local lock_timeout = '5s';
set local statement_timeout = '58s';

DO $do$
DECLARE v_veh uuid[]; n_bk int;
BEGIN
  CREATE TEMP TABLE spec_unreadable_readings ON COMMIT DROP AS
  SELECT r.id, r.vehicle_id FROM public.vehicle_code_readings r JOIN public.field_evidence f ON f.id = r.origin_id
   WHERE r.origin_table = 'field_evidence' AND r.rule_version = 'text_code_decode_v2'
     AND coalesce(f.source_type, '') = ANY (ARRAY['quickbooks','invoice','email_receipt','receipt','bank_statement','card_statement'])
  UNION
  SELECT r.id, r.vehicle_id FROM public.vehicle_code_readings r JOIN public.vehicle_observations o ON o.id = r.origin_id
   WHERE r.origin_table = 'vehicle_observations' AND r.rule_version = 'text_code_decode_v2'
     AND (NOT public.observation_is_public(o.kind, o.structured_data)
          OR coalesce(o.extraction_method, '') = ANY (ARRAY['garage_owner_correction_v1','owner_statement_v1',
               'owner_statement_org_link_v1','vehicle_statement_v1','work_order_payment_witness_sign_v1']));
  IF EXISTS (SELECT 1 FROM public.data_set_members m JOIN spec_unreadable_readings p ON p.id = m.basis_id
              WHERE m.basis_type = 'code_reading' AND m.state = 'active') THEN
    RAISE EXCEPTION 'spec_readings_financial_cleanup: these readings are already folded; revert that membership run first';
  END IF;
  INSERT INTO public.vehicle_code_readings_backup (id, vehicle_id, kind, code, model_year, origin_table, origin_id, origin_column, match_text, match_offset, pattern_key, confidence, rule_version, run_id, state, created_at, reverted_at, base_confidence, backed_up_at)
  SELECT r.id, r.vehicle_id, r.kind, r.code, r.model_year, r.origin_table, r.origin_id, r.origin_column, r.match_text, r.match_offset, r.pattern_key, r.confidence, r.rule_version, r.run_id, r.state, r.created_at, r.reverted_at, r.base_confidence, now()
    FROM public.vehicle_code_readings r JOIN spec_unreadable_readings p ON p.id = r.id;
  GET DIAGNOSTICS n_bk = ROW_COUNT;
  SELECT array_agg(DISTINCT vehicle_id) INTO v_veh FROM spec_unreadable_readings;
  DELETE FROM public.vehicle_code_readings r USING spec_unreadable_readings p WHERE r.id = p.id;
  PERFORM public.text_code_rescore_v1(coalesce(v_veh, '{}'));
  RAISE NOTICE 'spec_readings_financial_cleanup: backed up and removed % readings on % vehicles', n_bk, coalesce(cardinality(v_veh), 0);
END
$do$;

commit;
