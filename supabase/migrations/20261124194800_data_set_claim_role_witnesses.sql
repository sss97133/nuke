-- data_set_candidates_v1 admits photo readings by their claim role, through the same rule rows vehicle_facet_items reads
-- (vehicle_facet_claim_roles, 20261124194700), so a data-set membership and a fact item take the same readings (G3b step 2).
--
-- WHY. Measured 2026-11-25 on the proof vehicle: the fact item transmission.current.type is 'established' (manual), read
-- from photos by two reader families (anthropic trans_id_stamp_decode_v1 on 3 photos; openai interactive review, claim
-- role identified_transmission_housing, on 1). The data-set membership trans_type manual is only 'supported': its
-- candidates take photo observations by three extraction methods alone, so the openai reading never becomes a member and
-- the grade sees one family. Two readers of the same photos gave two answers about the same fact.
--
-- WHAT.
-- 1. data_set_item_kinds (item_key PK -> set_kind, note): which fact item is which data-set kind. One row:
--    transmission.current.type -> trans_type (keyed '<make>:<normalised type>', as data_set_trans_from_decode_v1 keys it).
-- 2. data_set_candidates_v1 gains role_out: observations of other extraction methods (the three decode methods keep their
--    own path, so no observation is a member twice) whose claim_role has a vehicle_facet_claim_roles row for an item in
--    data_set_item_kinds; the value is vehicle_facet_norm(nk, structured_data->>field), exactly the fact item's comparison.
--    Members: the vehicle, and the photo the observation witnesses (observation_witnesses, image on the same vehicle).
--    Basis 'observation', so the grade fold classes it by reader_lineage(agent_model) as it does every observation.
-- 3. model_fold_logic_key also hashes the rows of both rule tables, so editing a rule row re-folds like editing code.
-- Prediction (posted on the board before ship): proof car trans_type manual supported -> established (families anthropic +
-- openai, 3 photos); no other proof-car grade changes.
--
-- REVERT: re-run data_set_candidates_v1 and model_fold_logic_key without the marked changes (markers
-- data_set_claim_role_witnesses_v1), DROP TABLE data_set_item_kinds. Contract: supabase/sql/test_data_set_claim_role_witnesses.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.data_set_item_kinds (
  item_key text PRIMARY KEY,
  set_kind text NOT NULL,
  note text NOT NULL
);
ALTER TABLE public.data_set_item_kinds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS data_set_item_kinds_read ON public.data_set_item_kinds;
CREATE POLICY data_set_item_kinds_read ON public.data_set_item_kinds FOR SELECT USING (true);
REVOKE ALL ON public.data_set_item_kinds FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.data_set_item_kinds TO anon, authenticated, service_role;
COMMENT ON TABLE public.data_set_item_kinds IS
  'Rule rows: the data-set kind a fact item (vehicle_facet_claim_roles.item_key) feeds. Read by data_set_candidates_v1. 20261124194800.';
INSERT INTO public.data_set_item_kinds (item_key, set_kind, note) VALUES
  ('transmission.current.type', 'trans_type', 'keyed <make>:<vehicle_facet_norm transmission_type>, as the decode path keys it')
ON CONFLICT (item_key) DO UPDATE SET set_kind = excluded.set_kind, note = excluded.note;

DO $patch$
DECLARE d text;
  a1 text := '  -- Text code readings (vehicle_code_readings';
  a2 text := '  UNION ALL SELECT * FROM obs_out';
  cte text := $cte$  -- data_set_claim_role_witnesses_v1: photo readings of other methods, by claim role, through the fact items' rule rows.
  role_obs AS (
    SELECT DISTINCT ON (o.id, ik.set_kind)
           o.id, o.vehicle_id, o.extraction_method AS m, o.structured_data->>'claim_role' AS role, cr.item_key, ik.set_kind,
           public.vehicle_facet_norm(cr.nk, o.structured_data->>cr.field) AS code, v.mk,
           least(greatest(coalesce(o.confidence_score, 0.5), 0.01), 1) AS conf,
           (SELECT ow.image_id FROM public.observation_witnesses ow JOIN public.vehicle_images vi ON vi.id = ow.image_id
             WHERE ow.observation_id = o.id AND vi.vehicle_id = o.vehicle_id ORDER BY ow.image_id LIMIT 1) AS image_id
      FROM public.vehicle_observations o JOIN v ON v.id = o.vehicle_id
      JOIN public.vehicle_facet_claim_roles cr ON cr.role = o.structured_data->>'claim_role'
      JOIN public.data_set_item_kinds ik ON ik.item_key = cr.item_key
     WHERE o.extraction_method NOT IN ('cowl_tag_decode_v1','engine_block_decode_v1','trans_id_stamp_decode_v1')
       AND NOT coalesce(o.is_superseded, false) AND v.mk IS NOT NULL
       AND public.vehicle_facet_norm(cr.nk, o.structured_data->>cr.field) IS NOT NULL
     ORDER BY o.id, ik.set_kind, cr.field),
  role_out AS (
    SELECT k.set_kind, lower(format('%s:%s', k.mk, k.code)), l.lbl->>'label',
           jsonb_build_object('decode_rule', k.m, 'rules', l.lbl, 'claim_role', k.role, 'item_key', k.item_key),
           mt.member_type, mt.member_id, k.vehicle_id, 'observation'::text, k.id,
           jsonb_build_object('claim_role', k.role, 'code', k.code, 'item_key', k.item_key), k.conf, k.m
      FROM role_obs k
     CROSS JOIN LATERAL (SELECT public.data_set_rule_label(NULL::text, k.mk, k.code, NULL::integer) AS lbl) l
     CROSS JOIN LATERAL (VALUES ('vehicle', k.vehicle_id), ('image', k.image_id)) mt(member_type, member_id)
     WHERE mt.member_id IS NOT NULL),
$cte$;
BEGIN
  d := pg_get_functiondef('public.data_set_candidates_v1(uuid[])'::regprocedure);
  IF position('data_set_claim_role_witnesses_v1' IN d) = 0 THEN
    IF (length(d) - length(replace(d, a1, ''))) / length(a1) <> 1 THEN RAISE EXCEPTION 'data_set_candidates_v1: CTE anchor not found exactly once'; END IF;
    IF (length(d) - length(replace(d, a2, ''))) / length(a2) <> 1 THEN RAISE EXCEPTION 'data_set_candidates_v1: union anchor not found exactly once'; END IF;
    d := replace(d, a1, cte || a1);
    d := replace(d, a2, a2 || chr(10) || '  UNION ALL SELECT * FROM role_out');
    EXECUTE d;
  END IF;

  d := pg_get_functiondef('public.model_fold_logic_key()'::regprocedure);
  IF position('data_set_claim_role_witnesses_v1' IN d) = 0 THEN
    IF position($q$from public.vehicle_decode_rules r), ''))$q$ IN d) = 0 THEN RAISE EXCEPTION 'model_fold_logic_key: anchor not found'; END IF;
    d := replace(d, $q$from public.vehicle_decode_rules r), ''))$q$,
      $q$from public.vehicle_decode_rules r), '')
          -- data_set_claim_role_witnesses_v1: the claim-role and item-kind rule rows
          || '|' || coalesce((select md5(string_agg(row(c.*)::text, ',' order by c.role, c.field, c.item_key)) from public.vehicle_facet_claim_roles c), '')
          || '|' || coalesce((select md5(string_agg(row(k.*)::text, ',' order by k.item_key)) from public.data_set_item_kinds k), ''))$q$);
    EXECUTE d;
  END IF;
END $patch$;
