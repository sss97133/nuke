-- Contract for 20261124193600_field_evidence_rank_settle (empty disposable PG17; dependencies stubbed, fixtures synthetic).
-- Asserts: one claim value over values held only by unregistered photo readings rejects those readings through
-- correct_field_evidence and logs one row per field; a vehicle_record mirror is not a witness; two values at the same
-- rank, or a reading value with any claim behind it, stay; make aliases fold through canonical_makes; a dry run writes
-- nothing; the sweep calls the settle before apply; only the service role runs it.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE TABLE public.vehicles (id uuid PRIMARY KEY);
CREATE TABLE public.field_evidence (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid, field_name text, proposed_value text,
  source_type text, source_confidence integer, extraction_context text, extracted_at timestamptz DEFAULT now(),
  contradicting_signals jsonb, status text, raw_extraction_data jsonb);
CREATE TABLE public.field_automation_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid, writer text, vehicle_id uuid,
  field_name text, action text, prior jsonb, new jsonb, evidence jsonb, created_at timestamptz DEFAULT now(), rolled_back_at timestamptz);
CREATE TABLE public.canonical_makes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_name text, aliases text[], is_active boolean);
INSERT INTO public.canonical_makes (canonical_name, aliases, is_active) VALUES ('CHEVROLET', ARRAY['chevy', 'Chev'], true), ('GMC', ARRAY['G.M.C.'], true);
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- the reader's normaliser, as far as these fixtures need it
CREATE FUNCTION public.vehicle_facet_norm(p_kind text, p_value text) RETURNS text LANGUAGE sql IMMUTABLE AS $f$
  SELECT CASE WHEN s IS NULL OR s = '' THEN NULL
              WHEN p_kind = 'year' THEN substring(s FROM '((?:18|19|20)[0-9]{2})')
              ELSE s END
  FROM (SELECT lower(regexp_replace(btrim(p_value), '\s+', ' ', 'g'))) t(s) $f$;
-- correct_field_evidence as live (20261108 writer), unchanged
CREATE FUNCTION public.correct_field_evidence(p_ids uuid[], p_status text, p_source jsonb, p_asserted_by text DEFAULT 'agent')
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $f$
DECLARE v_changed int;
BEGIN
  IF p_status NOT IN ('superseded', 'rejected') THEN RAISE EXCEPTION 'status'; END IF;
  IF coalesce(p_source->>'ref', p_source->>'reason', '') = '' THEN RAISE EXCEPTION 'source required'; END IF;
  UPDATE field_evidence fe SET status = p_status,
    contradicting_signals = coalesce(fe.contradicting_signals, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
      'correction', jsonb_build_object('from_status', fe.status, 'to_status', p_status), 'source', p_source, 'asserted_by', p_asserted_by))
   WHERE fe.id = ANY (p_ids) AND fe.status IS DISTINCT FROM p_status;
  GET DIAGNOSTICS v_changed = ROW_COUNT;
  RETURN jsonb_build_object('ok', true, 'changed', v_changed);
END $f$;
-- the sweep and apply as live, reduced to the line the migration anchors on
CREATE FUNCTION public.apply_field_consensus_safe(p_vehicle_id uuid, p_field text, p_dry_run boolean, p_since interval, p_limit integer, p_run_id uuid)
RETURNS jsonb LANGUAGE sql AS $f$ SELECT jsonb_build_object('would_set', 0, 'held', 0, 'detail', '[]'::jsonb) $f$;
CREATE FUNCTION public.run_field_consensus_sweep(p_batch integer DEFAULT NULL, p_dry_run boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
declare vid uuid; r jsonb; run uuid := gen_random_uuid();
begin
 for vid in select id from vehicles order by id loop
  r := public.apply_field_consensus_safe(vid, null, p_dry_run, interval '1 day', 10, run);
 end loop;
 return jsonb_build_object('run_id', run);
end $f$;

INSERT INTO public.vehicles VALUES ('10000000-0000-0000-0000-000000000001'), ('10000000-0000-0000-0000-000000000002');
INSERT INTO public.field_evidence (id, vehicle_id, field_name, proposed_value, source_type, extraction_context, status, raw_extraction_data)
SELECT x.id::uuid, '10000000-0000-0000-0000-000000000001', x.f, x.v, x.st, x.ctx, x.status,
       CASE WHEN x.img THEN jsonb_build_object('image_id', gen_random_uuid()) END
FROM (VALUES
  -- color: one listing claim; three different unregistered readings -> the three are rejected
  ('c0000000-0000-0000-0000-000000000001', 'color', 'Red', 'bat', NULL, 'accepted', false),
  ('c0000000-0000-0000-0000-000000000002', 'color', 'burgundy', 'ai_visual', NULL, 'accepted', true),
  ('c0000000-0000-0000-0000-000000000003', 'color', 'dark red', 'ai_visual', NULL, 'pending', true),
  ('c0000000-0000-0000-0000-000000000004', 'color', 'RED', 'ai_visual', NULL, 'accepted', true),
  -- year: only the vehicle_record mirror against a reading -> not a witness, nothing changes
  ('c0000000-0000-0000-0000-000000000011', 'year', '1977', 'vehicle_record', 'Vehicle record: vehicle_record', 'pending', false),
  ('c0000000-0000-0000-0000-000000000012', 'year', '1978', 'ai_visual', NULL, 'accepted', true),
  -- model: two claims disagree -> stays
  ('c0000000-0000-0000-0000-000000000021', 'model', 'Blazer', 'bat', NULL, 'accepted', false),
  ('c0000000-0000-0000-0000-000000000022', 'model', 'K5', 'bat_listing', NULL, 'accepted', false),
  ('c0000000-0000-0000-0000-000000000023', 'model', 'Silverado', 'ai_visual', NULL, 'accepted', true),
  -- make: 'chevy' claim and 'Chevrolet' reading are one value; a 'GMC' reading also has a claim behind it -> stays
  ('c0000000-0000-0000-0000-000000000031', 'make', 'chevy', 'bat', NULL, 'accepted', false),
  ('c0000000-0000-0000-0000-000000000032', 'make', 'Chevrolet', 'ai_visual', NULL, 'accepted', true),
  ('c0000000-0000-0000-0000-000000000033', 'make', 'G.M.C.', 'ai_visual', NULL, 'accepted', true),
  ('c0000000-0000-0000-0000-000000000034', 'make', 'gmc', 'user-submission_listing', NULL, 'accepted', false),
  -- drivetrain: a decode mirror beats a reading; a rejected row and a system_update row are not read
  ('c0000000-0000-0000-0000-000000000041', 'drivetrain', '4wd', 'nhtsa_vin_decode', 'vin_decode_nhtsa_v1 via observation-writer', 'accepted', false),
  ('c0000000-0000-0000-0000-000000000042', 'drivetrain', 'rwd', 'ai_visual', NULL, 'accepted', true),
  ('c0000000-0000-0000-0000-000000000043', 'drivetrain', 'fwd', 'ai_visual', NULL, 'rejected', true),
  ('c0000000-0000-0000-0000-000000000044', 'drivetrain', 'awd', 'system_update', NULL, 'accepted', false)
) x(id, f, v, st, ctx, status, img);

\ir ../migrations/20261124193600_field_evidence_rank_settle.sql
\ir ../migrations/20261124193600_field_evidence_rank_settle.sql

DO $$
DECLARE r jsonb; d text;
BEGIN
  r := public.field_evidence_rank_settle_v1('10000000-0000-0000-0000-000000000001', true);
  ASSERT (r->>'fields')::int = 2 AND (r->>'rows_rejected')::int = 3, 'dry run: color (2 readings; RED folds into the claim) and drivetrain (1); got ' || r::text;
  ASSERT NOT EXISTS (SELECT 1 FROM public.field_evidence WHERE status = 'rejected' AND id <> 'c0000000-0000-0000-0000-000000000043'), 'a dry run writes nothing';
  ASSERT NOT EXISTS (SELECT 1 FROM public.field_automation_log), 'a dry run logs nothing';

  PERFORM public.run_field_consensus_sweep(150, false);
  ASSERT (SELECT array_agg(id ORDER BY id)::text[] FROM public.field_evidence WHERE status = 'rejected')
       = ARRAY['c0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000003',
               'c0000000-0000-0000-0000-000000000042', 'c0000000-0000-0000-0000-000000000043'],
    'the sweep rejected the outranked readings only';
  ASSERT (SELECT status FROM public.field_evidence WHERE id = 'c0000000-0000-0000-0000-000000000004') = 'accepted', 'a reading that agrees with the claim stays';
  ASSERT (SELECT contradicting_signals->0->'source'->>'rule' FROM public.field_evidence WHERE id = 'c0000000-0000-0000-0000-000000000002') = 'evidence_class_rank',
    'the correction cites the rule';
  ASSERT (SELECT contradicting_signals->0->'correction'->>'from_status' FROM public.field_evidence WHERE id = 'c0000000-0000-0000-0000-000000000003') = 'pending',
    'the prior status is kept';
  ASSERT (SELECT count(*) FROM public.field_automation_log WHERE writer = 'field_consensus_v2' AND action = 'outranked_rejected') = 2, 'one log row per field';
  ASSERT (SELECT count(*) FROM public.field_evidence WHERE field_name IN ('year', 'model', 'make') AND status = 'rejected') = 0,
    'record-only, same-rank and claim-backed values stay';

  r := public.field_evidence_rank_settle_v1('10000000-0000-0000-0000-000000000001', false);
  ASSERT (r->>'rows_rejected')::int = 0, 'a second run finds nothing; got ' || r::text;
  d := pg_get_functiondef('public.run_field_consensus_sweep(integer, boolean)'::regprocedure);
  ASSERT position('field_evidence_rank_settle_v1' IN d) < position('apply_field_consensus_safe' IN d), 'the sweep settles before it applies';
END $$;

SET ROLE anon;
DO $$ BEGIN
  PERFORM public.field_evidence_rank_settle_v1('10000000-0000-0000-0000-000000000001', true);
  RAISE EXCEPTION 'FAIL: anon ran the settle';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
DO $$ BEGIN
  PERFORM 1 FROM public.evidence_class_rank;
  RAISE EXCEPTION 'FAIL: anon read the rank rows';
EXCEPTION WHEN insufficient_privilege THEN NULL;
END $$;
RESET ROLE;
\echo field_evidence_rank_settle: ok
