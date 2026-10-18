-- vin_trim_corroboration (2026-10-18): record_vin_trim_evidence fills a trim only when the listing corroborates it.
-- The first version filled any empty trim from its decode. On a 100-vehicle pilot the decode sometimes named a body
-- or bed style ("Styleside" on an F-150 SVT Raptor, "Cabriolet" on a 911 Turbo Cabriolet) or a less specific trim
-- than the listing ("Carrera" on a 911 Speedster).
--   * A decode that is only a body or cab word is not a trim and is skipped.
--   * An empty trim is filled only when the decoded trim appears as words in the model or title, or the model is a
--     single bare word ("911", "Tacoma") so the decode cannot contradict it. Otherwise the evidence stays pending.
--   * Fills the first version made that fail this rule are undone: trim back to empty, prior value recorded in
--     superseded_rows, evidence returned to pending.
BEGIN;
SET LOCAL statement_timeout = '60s';
SET LOCAL lock_timeout = '10s';

CREATE OR REPLACE FUNCTION public.vin_decode_single_trim(p_trim text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT CASE
    WHEN s.v IS NULL THEN NULL
    WHEN s.v ~ '[,/+]' THEN NULL
    WHEN s.stripped ~ '[()]' THEN NULL
    WHEN lower(s.stripped) ~ '^(coupe|cabriolet|convertible|roadster|spyder|spider|targa|sedan|wagon|estate|hatchback|styleside|fleetside|stepside|flareside|sportside|pickup|van|suv|crew cab|supercab|supercrew|regular cab|extended cab|double cab|quad cab|crewmax|access cab|king cab)$' THEN NULL
    ELSE nullif(s.stripped, '')
  END
  FROM (
    SELECT v, btrim(regexp_replace(v, '\s*\((2WD|4WD|AWD|RWD|FWD|4x4|4x2)\)\s*$', '', 'i')) AS stripped
    FROM (SELECT nullif(btrim(p_trim), '') AS v) raw
  ) s
$function$;

CREATE OR REPLACE FUNCTION public.vin_trim_corroborated(p_trim text, p_model text, p_title text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT p_trim IS NOT NULL AND (
    position(
      ' ' || btrim(lower(regexp_replace(p_trim, '[^A-Za-z0-9]+', ' ', 'g'))) || ' '
      IN ' ' || lower(regexp_replace(coalesce(p_model, '') || ' ' || coalesce(p_title, ''), '[^A-Za-z0-9]+', ' ', 'g')) || ' '
    ) > 0
    OR coalesce(array_length(regexp_split_to_array(nullif(btrim(p_model), ''), '\s+'), 1), 0) = 1
  )
$function$;

CREATE OR REPLACE FUNCTION public.record_vin_trim_evidence(p_after uuid, p_limit integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  c_writer     CONSTANT text := 'record_vin_trim_evidence';
  v_timeout_ms bigint := (SELECT setting::bigint FROM pg_settings WHERE name = 'statement_timeout');
  v_last       uuid;
  v_scanned    integer;
  v_single     integer;
  v_accepted   integer;
  v_pending    integer;
  v_filled     integer;
BEGIN
  IF v_timeout_ms < 1 OR v_timeout_ms > 60000 THEN
    RAISE EXCEPTION '%: caller must set statement_timeout between 1 ms and 60 s (now % ms)', c_writer, v_timeout_ms;
  END IF;
  IF p_limit IS NULL OR p_limit < 1 OR p_limit > 5000 THEN
    RAISE EXCEPTION '%: p_limit must be between 1 and 5000', c_writer;
  END IF;
  PERFORM set_config('lock_timeout', '3s', true);

  CREATE TEMP TABLE IF NOT EXISTS vin_trim_batch (
    vehicle_id uuid PRIMARY KEY, vin text, live_trim text, decoded_trim text, trim_value text, corroborated boolean
  ) ON COMMIT DROP;
  TRUNCATE vin_trim_batch;

  INSERT INTO vin_trim_batch
  SELECT b.id, b.vin, b.live_trim, b.decoded_trim, b.trim_value,
         public.vin_trim_corroborated(b.trim_value, b.model, b.title)
  FROM (
    SELECT v.id, v.vin, v.model, v.title, nullif(btrim(v.trim), '') AS live_trim, d.trim AS decoded_trim,
           public.vin_decode_single_trim(d.trim) AS trim_value
    FROM public.vehicles v
    JOIN public.vin_decoded_data d ON d.vin = upper(v.vin)
    WHERE v.id > coalesce(p_after, '00000000-0000-0000-0000-000000000000'::uuid)
      AND v.deleted_at IS NULL
      AND nullif(btrim(d.trim), '') IS NOT NULL
    ORDER BY v.id
    LIMIT p_limit
  ) b;

  SELECT max(vehicle_id::text)::uuid, count(*), count(*) FILTER (WHERE trim_value IS NOT NULL)
    INTO v_last, v_scanned, v_single
  FROM vin_trim_batch;

  WITH ins AS (
    INSERT INTO public.field_evidence (
      vehicle_id, field_name, proposed_value, source_type, source_confidence,
      extraction_context, status, assigned_at, assigned_by, raw_extraction_data
    )
    SELECT b.vehicle_id, 'trim', b.trim_value, 'nhtsa_vin_decode', 85,
           'VIN: ' || b.vin,
           CASE WHEN (b.live_trim IS NULL AND b.corroborated) OR lower(b.live_trim) = lower(b.trim_value)
                THEN 'accepted' ELSE 'pending' END,
           CASE WHEN (b.live_trim IS NULL AND b.corroborated) OR lower(b.live_trim) = lower(b.trim_value)
                THEN now() END,
           c_writer,
           jsonb_build_object('decoded_trim', b.decoded_trim, 'live_trim', b.live_trim, 'corroborated', b.corroborated)
    FROM vin_trim_batch b
    WHERE b.trim_value IS NOT NULL
    ON CONFLICT (vehicle_id, field_name, source_type, proposed_value) DO NOTHING
    RETURNING status
  )
  SELECT count(*) FILTER (WHERE status = 'accepted'), count(*) FILTER (WHERE status = 'pending')
    INTO v_accepted, v_pending
  FROM ins;

  PERFORM set_config('app.writer', c_writer, true);
  UPDATE public.vehicles v
     SET trim = b.trim_value
    FROM vin_trim_batch b
   WHERE v.id = b.vehicle_id
     AND b.trim_value IS NOT NULL
     AND b.corroborated
     AND b.live_trim IS NULL
     AND nullif(btrim(v.trim), '') IS NULL;
  GET DIAGNOSTICS v_filled = ROW_COUNT;

  RETURN jsonb_build_object(
    'last_vehicle_id', v_last, 'scanned', v_scanned, 'single_trim', v_single,
    'evidence_accepted', v_accepted, 'evidence_pending', v_pending, 'trim_filled', v_filled
  );
END;
$function$;

-- Re-check fills the first version made (accepted evidence whose live trim was empty) against the new rule.
CREATE TEMP TABLE vin_trim_undo ON COMMIT DROP AS
SELECT e.id AS evidence_id, v.id AS vehicle_id, v.trim AS filled_trim, e.raw_extraction_data ->> 'decoded_trim' AS decoded_trim
FROM public.field_evidence e
JOIN public.vehicles v ON v.id = e.vehicle_id
WHERE e.assigned_by = 'record_vin_trim_evidence'
  AND e.field_name = 'trim'
  AND e.status = 'accepted'
  AND e.raw_extraction_data ->> 'live_trim' IS NULL
  AND NOT (e.raw_extraction_data ? 'corroborated')
  AND v.trim = e.proposed_value
  AND (public.vin_decode_single_trim(e.raw_extraction_data ->> 'decoded_trim') IS NULL
       OR NOT public.vin_trim_corroborated(e.proposed_value, v.model, v.title));

INSERT INTO public.superseded_rows (source_table, row_id, row_data, asserted_by, source, reason)
SELECT 'vehicles', u.vehicle_id,
       jsonb_build_object('field', 'trim', 'value', u.filled_trim, 'replacement', NULL),
       'record_vin_trim_evidence',
       jsonb_build_object('type', 'vin_decode', 'decoded_trim', u.decoded_trim, 'evidence_id', u.evidence_id),
       'VIN-decoded trim filled without corroboration from the model or title; undone by vin_trim_corroboration'
FROM vin_trim_undo u;

SELECT set_config('app.writer', 'record_vin_trim_evidence', true);
UPDATE public.vehicles v SET trim = NULL FROM vin_trim_undo u WHERE v.id = u.vehicle_id AND v.trim = u.filled_trim;
UPDATE public.field_evidence e
   SET status = 'pending', assigned_at = NULL,
       raw_extraction_data = e.raw_extraction_data || jsonb_build_object('corroborated', false, 'undone_fill', true)
  FROM vin_trim_undo u
 WHERE e.id = u.evidence_id;

REVOKE ALL ON FUNCTION public.vin_trim_corroborated(text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.vin_trim_corroborated(text, text, text) TO service_role;
REVOKE ALL ON FUNCTION public.record_vin_trim_evidence(uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_vin_trim_evidence(uuid, integer) TO service_role;

COMMIT;
