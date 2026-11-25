-- field_evidence_rank_settle_v1: a legacy photo reading outranked by a single claim, decode or paper value is rejected
-- through correct_field_evidence, by a rule held in rows, from the field consensus sweep.
--
-- WHY. vehicle_facet_items (live from 20261124193400) shows a conflict when two values have witnesses, and ranks the
-- sides by witness class, but the rows behind it stay. Measured 2026-11-24 (anon reader, 14-car bench): 44 conflict items on
-- 10 cars. 20 of them are one claim or decode value against values held only by legacy photo readings (field_evidence
-- ai_visual rows, written by photo_land_classification / photo-pipeline-orchestrator, with no reader model recorded, so no
-- lineage), e.g. 30 different paint words from one pipeline against one listing claim. The live consensus owner,
-- apply_field_consensus_safe (cron field-consensus-sweep through run_field_consensus_sweep), only sees four fields and
-- only sets the vehicles column; build_field_consensus has no scheduled caller and writes field_evidence by raw UPDATE.
--
-- WHAT.
-- 1. evidence_class_rank (class PK, rank, is_witness, note): the witness-class order as rows. decode 0, receipt 1,
--    reading_registered 2, claim 3, reading_unregistered 4; record (the vehicles row) and record_mirror (field_evidence
--    source_type vehicle_record, a copy of the vehicles row) are not witnesses. Read by this function; the facet reader's
--    crank (20261124193400) holds the same order and moves to these rows when it is next patched.
-- 2. field_evidence_rank_settle_v1(vehicle, dry_run, run_id), service role. For each field the facet reader maps from
--    field_evidence, live rows (pending / accepted / conflicted, not system_update) are classed exactly as the reader
--    classes them (decode: mirror method vin_decode_*; receipt: quickbooks / invoice / email_receipt / receipt; reading:
--    an image id; else claim; vehicle_record: record_mirror) and grouped by the reader's normaliser
--    (vehicle_facet_norm), make through canonical_makes (canonical_name or an alias). When exactly one value holds the
--    best witness rank, that rank is better than reading_unregistered, and every other value is held only by
--    reading_unregistered rows, those rows are rejected by correct_field_evidence with the rule, the winning row ids and
--    the run id as the cited source, and one field_automation_log row (writer field_consensus_v2, action
--    outranked_rejected) per field. Nothing else is written: two values at one rank, a record-only side, or a value with
--    any better witness stay as they are (a visible conflict).
-- 3. run_field_consensus_sweep calls it per vehicle before apply_field_consensus_safe (not on a dry run, and only in the
--    first 5 s of a run). Measured dry, 150 vehicles from three cursors: 0.6 / 3.1 / 2.5 s; the sweep itself averages
--    2.5 s (119 runs in 6 h, 1 timeout at 10 s). Bench dry run (14 cars): 20 fields settle, 264 rows rejected, proof car 0.
-- Grain: field_evidence rows (8.9M); key (vehicle_id, field_name); clocks: the row's own extracted_at / created_at, the
-- correction's asserted_at. Recompute: the sweep's cursor reaches every vehicle in turn (150 per 3 minutes).
--
-- REVERT. Restore run_field_consensus_sweep from pg_get_functiondef before this migration (the call is one line); DROP
-- FUNCTION field_evidence_rank_settle_v1(uuid, boolean, uuid); DROP TABLE evidence_class_rank. Rejected rows carry the
-- correction in contradicting_signals (from_status) and the run in field_automation_log; restoring them needs a
-- sanctioned writer that accepts that run id.
-- Contract: supabase/sql/test_field_evidence_rank_settle.sql.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.evidence_class_rank (
  class text PRIMARY KEY,
  rank integer,
  is_witness boolean NOT NULL,
  note text NOT NULL,
  CHECK (is_witness = (rank IS NOT NULL))
);
ALTER TABLE public.evidence_class_rank ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.evidence_class_rank FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.evidence_class_rank TO service_role;
COMMENT ON TABLE public.evidence_class_rank IS
  'Witness-class order for a value: lower rank leads. A class with is_witness false is shown but never counts as a side. Read by field_evidence_rank_settle_v1. 20261124193600.';
INSERT INTO public.evidence_class_rank (class, rank, is_witness, note) VALUES
  ('decode', 0, true, 'a VIN or code decoded by a cited rule'),
  ('receipt', 1, true, 'paper: a receipt, invoice or cited document page'),
  ('reading_registered', 2, true, 'a photo reading by a reader whose model is registered (model_registry), so its lineage is known'),
  ('claim', 3, true, 'a seller, listing or person stating it'),
  ('reading_unregistered', 4, true, 'a photo reading with no registered reader model (legacy ai_visual pipelines)'),
  ('record', NULL, false, 'the vehicles row itself: what the profile shows, not evidence of it'),
  ('record_mirror', NULL, false, 'field_evidence source_type vehicle_record: a copy of the vehicles row')
ON CONFLICT (class) DO UPDATE SET rank = excluded.rank, is_witness = excluded.is_witness, note = excluded.note;

CREATE OR REPLACE FUNCTION public.field_evidence_rank_settle_v1(p_vehicle_id uuid, p_dry_run boolean DEFAULT true,
                                                               p_run_id uuid DEFAULT gen_random_uuid())
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  r record;
  low integer := (SELECT k.rank FROM public.evidence_class_rank k WHERE k.class = 'reading_unregistered');
  n_fields int := 0; n_rows int := 0; detail jsonb := '[]'::jsonb; res jsonb;
BEGIN
  IF p_vehicle_id IS NULL OR low IS NULL THEN RETURN jsonb_build_object('skipped', 'no vehicle or no rank rows'); END IF;
  FOR r IN
    WITH m(field, nk) AS (VALUES
      ('year', 'year'), ('make', 'text'), ('model', 'text'), ('body_style', 'text'), ('trim', 'text'), ('color', 'text'),
      ('engine_size', 'displacement'), ('engine_code', 'text'), ('transmission', 'transmission_type'),
      ('transmission_model', 'text'), ('rear_axle_ratio', 'ratio'), ('drivetrain', 'layout')),
    fe AS (
      SELECT f.id, f.field_name, f.proposed_value, m.nk,
             CASE WHEN f.source_type = 'vehicle_record' THEN 'record_mirror'
                  WHEN f.extraction_context LIKE '% via observation-writer%'
                       AND split_part(f.extraction_context, ' via ', 1) LIKE 'vin\_decode\_%' THEN 'decode'
                  WHEN f.source_type IN ('quickbooks', 'invoice', 'email_receipt', 'receipt') THEN 'receipt'
                  WHEN f.raw_extraction_data->>'image_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       THEN 'reading_unregistered'
                  ELSE 'claim' END AS cls
        FROM public.field_evidence f
        JOIN m ON m.field = f.field_name
       WHERE f.vehicle_id = p_vehicle_id AND f.status IN ('accepted', 'conflicted', 'pending')
         AND nullif(btrim(f.proposed_value), '') IS NOT NULL AND coalesce(f.source_type, '') <> 'system_update'),
    w AS (
      SELECT fe.id, fe.field_name, k.rank,
             CASE WHEN fe.field_name = 'make' THEN coalesce(
                    (SELECT lower(c.canonical_name) FROM public.canonical_makes c
                      WHERE lower(c.canonical_name) = lower(btrim(fe.proposed_value))
                         OR lower(btrim(fe.proposed_value)) = ANY (SELECT lower(a) FROM unnest(c.aliases) a)
                      ORDER BY c.is_active DESC NULLS LAST, c.canonical_name LIMIT 1),
                    public.vehicle_facet_norm('text', fe.proposed_value))
                  ELSE public.vehicle_facet_norm(fe.nk, fe.proposed_value) END AS norm
        FROM fe JOIN public.evidence_class_rank k ON k.class = fe.cls AND k.is_witness),
    vals AS (
      SELECT field_name, norm, min(rank) AS best, array_agg(id ORDER BY id) AS ids
        FROM w WHERE norm IS NOT NULL GROUP BY field_name, norm),
    fld AS (
      SELECT field_name, min(best) AS top FROM vals GROUP BY field_name HAVING count(*) > 1)
    SELECT f.field_name, f.top,
           (SELECT array_agg(i) FROM vals v, unnest(v.ids) i WHERE v.field_name = f.field_name AND v.best = f.top) AS winner_ids,
           (SELECT array_agg(i) FROM vals v, unnest(v.ids) i WHERE v.field_name = f.field_name AND v.best <> f.top) AS loser_ids,
           (SELECT count(*) FROM vals v WHERE v.field_name = f.field_name AND v.best = f.top) AS n_top,
           (SELECT bool_and(v.best = low) FROM vals v WHERE v.field_name = f.field_name AND v.best <> f.top) AS losers_low
      FROM fld f
  LOOP
    CONTINUE WHEN r.n_top <> 1 OR r.top >= low OR NOT coalesce(r.losers_low, false) OR r.loser_ids IS NULL;
    n_fields := n_fields + 1; n_rows := n_rows + cardinality(r.loser_ids);
    detail := detail || jsonb_build_object('field', r.field_name, 'rejected', cardinality(r.loser_ids), 'winner_rank', r.top,
                                           'winner_ids', to_jsonb(r.winner_ids));
    IF NOT p_dry_run THEN
      res := public.correct_field_evidence(r.loser_ids, 'rejected',
        jsonb_build_object('reason', 'outranked: one value holds a better witness class and every other value is held only by unregistered photo readings',
                           'rule', 'evidence_class_rank', 'winner_ids', to_jsonb(r.winner_ids), 'run_id', p_run_id),
        'field_consensus_v2');
      INSERT INTO public.field_automation_log (run_id, writer, vehicle_id, field_name, action, prior, new, evidence)
      VALUES (p_run_id, 'field_consensus_v2', p_vehicle_id, r.field_name, 'outranked_rejected', to_jsonb(r.loser_ids),
              to_jsonb(r.winner_ids), jsonb_build_object('winner_rank', r.top, 'correction', res));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('vehicle_id', p_vehicle_id, 'dry_run', p_dry_run, 'run_id', p_run_id,
                            'fields', n_fields, 'rows_rejected', n_rows, 'detail', detail);
END;
$$;
REVOKE ALL ON FUNCTION public.field_evidence_rank_settle_v1(uuid, boolean, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.field_evidence_rank_settle_v1(uuid, boolean, uuid) TO service_role;
COMMENT ON FUNCTION public.field_evidence_rank_settle_v1(uuid, boolean, uuid) IS
  'Per vehicle and field: when one value holds the best witness class (evidence_class_rank) and every other value is held only by unregistered photo readings, those readings are rejected through correct_field_evidence (writer field_consensus_v2, logged in field_automation_log). Called by run_field_consensus_sweep. 20261124193600.';

-- 3. the sweep settles before it applies
DO $sweep$
DECLARE d text; anchor text := 'r := public.apply_field_consensus_safe(vid, null, p_dry_run, interval ''1 day'', 10, run);';
BEGIN
  d := pg_get_functiondef('public.run_field_consensus_sweep(integer, boolean)'::regprocedure);
  IF position('field_evidence_rank_settle_v1' IN d) > 0 THEN RETURN; END IF;
  IF (length(d) - length(replace(d, anchor, ''))) / length(anchor) <> 1 THEN
    RAISE EXCEPTION 'run_field_consensus_sweep: apply anchor not found exactly once';
  END IF;
  -- the settle runs only in the first 5 s of a run, so the job stays inside its 10 s timeout (a timeout would roll back
  -- the cursor and repeat the batch); vehicles passed over are settled on the next lap
  d := replace(d, anchor, 'if not p_dry_run and clock_timestamp() - statement_timestamp() < interval ''5 seconds'' then perform public.field_evidence_rank_settle_v1(vid, false, run); end if;' || chr(10) || '  ' || anchor);
  EXECUTE d;
END $sweep$;
