-- reported_labor_hours_v1, SQL half: the allowed qualifier values and the one check every reported labor statement
-- passes before it lands.
--
-- WHY. Lead ruling 1 (2026-11-25): between gate A (the 8 labor keys, ratified live 00:58 PT by
-- schema_proposal_key_gate) and gate B (thresholds per baseline cell), "the 138 statements land through
-- ingest-observation with their source keys". The writer mode (ingest-observation reported_labor_hours_v1) calls
-- reported_labor_statement_check and refuses on any reason, so the edge function holds no copy of the rules.
--
-- ROWS.
--   labor_statement_values (property_key FK observation_properties, value, proposal_id FK schema_proposals): the
--     allowed values of the 5 enum keys, each a whole token in its ratified key's own 'Allowed values:' text
--     (guarded below; 31 rows: labor_scope 2, labor_speaker_role 4, labor_statement_kind 3, labor_time_basis 4,
--     labor_system_key 18). labor_system_key's text names receipt_line_systems as its vocabulary, but live
--     receipt_line_systems (18 rows) has hardware and supplies and lacks tires and unplaced: the ratified text is
--     the authority here; 16 keys join receipt_line_systems, tires and unplaced do not.
--   reported_labor_statement_check(source_table, source_row_id, quote, low, high, qualifiers) -> jsonb
--     {ok, reasons[], quote_hash, text_md5, source_vehicle_id, contract}. Same source rules as gate A
--     (schema_proposal_witness_sources: allowed table, row exists, not generated) and the same quote rule row
--     (schema_proposal_quote_rules 'labor': min_quote_chars, term_pattern, figure_required, whole-token verbatim),
--     plus: quote <= 300 chars; low > 0 and printed in the quote; high >= low and printed; qualifiers only the 6
--     labor keys; scope, speaker_role, statement_kind and time_basis required and in labor_statement_values;
--     system_key required for task, refused for whole_build; stated_subject <= 80 chars and inside the quote.
--     Thousands separators are read as printed ('1,000' is 1000).
--     source_vehicle_id is the car the source row is about (auction_comments.vehicle_id; build_posts ->
--     build_threads.vehicle_id; vehicles.id). The writer puts it in structured_data and lands the observation
--     with vehicle_id NULL: proj_disposition marks a car in_progress on any work_record row and
--     vehicle_build_log_public prints every work_record on a public car, so a commenter's hours about another car
--     must not sit on this car's row (board 01:24 PT). The baseline fold reaches the car through the source key.
-- Test: supabase/sql/test_reported_labor_statement_check.sql (PG17, chained after the gate A test).

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE TABLE IF NOT EXISTS public.labor_statement_values (
  property_key text NOT NULL REFERENCES public.observation_properties(property_key),
  value text NOT NULL CHECK (value ~ '^[a-z][a-z_]*$'),
  proposal_id uuid NOT NULL REFERENCES public.schema_proposals(id),
  PRIMARY KEY (property_key, value)
);
COMMENT ON TABLE public.labor_statement_values IS
  'reported_labor_hours_v1: allowed values of the ratified labor enum keys (grain: key x value). Each value is a whole token of its key''s ratified Allowed values text; proposal_id is the ratifying schema_proposals row.';
ALTER TABLE public.labor_statement_values ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.labor_statement_values FROM anon, authenticated;
GRANT SELECT ON public.labor_statement_values TO service_role;

INSERT INTO public.labor_statement_values (property_key, value, proposal_id)
SELECT o.property_key, v.value, o.proposed_by_proposal_id
  FROM (VALUES
    ('labor_scope', 'whole_build'), ('labor_scope', 'task'),
    ('labor_speaker_role', 'owner_seller'), ('labor_speaker_role', 'shop_builder'),
    ('labor_speaker_role', 'commenter_other_car'), ('labor_speaker_role', 'third_party'),
    ('labor_statement_kind', 'actual'), ('labor_statement_kind', 'estimate'), ('labor_statement_kind', 'hearsay'),
    ('labor_time_basis', 'own'), ('labor_time_basis', 'paid_shop'), ('labor_time_basis', 'book_quote'),
    ('labor_time_basis', 'unknown'),
    ('labor_system_key', 'engine'), ('labor_system_key', 'machining'), ('labor_system_key', 'fuel'),
    ('labor_system_key', 'cooling'), ('labor_system_key', 'exhaust'), ('labor_system_key', 'electrical'),
    ('labor_system_key', 'brakes'), ('labor_system_key', 'steering'), ('labor_system_key', 'suspension'),
    ('labor_system_key', 'axle'), ('labor_system_key', 'transmission'), ('labor_system_key', 'body'),
    ('labor_system_key', 'paint'), ('labor_system_key', 'glass'), ('labor_system_key', 'interior'),
    ('labor_system_key', 'trim'), ('labor_system_key', 'tires'), ('labor_system_key', 'unplaced')
  ) v(property_key, value)
  JOIN public.observation_properties o ON o.property_key = v.property_key
 WHERE o.proposed_by_proposal_id IS NOT NULL AND o.data_type = 'enum'
ON CONFLICT (property_key, value) DO NOTHING;

DO $guard$
DECLARE n int; bad text;
BEGIN
  SELECT count(*) INTO n FROM public.labor_statement_values;
  IF n <> 31 THEN
    RAISE EXCEPTION 'reported_labor_hours_v1: expected 31 labor_statement_values rows, found % (are the 8 keys ratified?)', n;
  END IF;
  SELECT string_agg(l.property_key || '.' || l.value, ', ') INTO bad
    FROM public.labor_statement_values l
    JOIN public.observation_properties o ON o.property_key = l.property_key
   WHERE coalesce(substring(o.description FROM 'Allowed values:(.*)$'), '') !~ ('\m' || l.value || '\M')
      OR o.proposed_by_proposal_id IS DISTINCT FROM l.proposal_id;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'reported_labor_hours_v1: values not in their ratified key''s Allowed values text: %', bad;
  END IF;
END $guard$;

CREATE OR REPLACE FUNCTION public.reported_labor_statement_check(
  p_source_table text, p_source_row_id uuid, p_quote text, p_low numeric, p_high numeric, p_qualifiers jsonb)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $fn$
DECLARE
  src public.schema_proposal_witness_sources%ROWTYPE;
  qr public.schema_proposal_quote_rules%ROWTYPE;
  reasons text[] := '{}';
  txt text;
  generated boolean;
  pos int;
  figs numeric[];
  q jsonb := coalesce(p_qualifiers, '{}'::jsonb);
  k text;
  veh uuid;
BEGIN
  SELECT * INTO qr FROM public.schema_proposal_quote_rules WHERE category = 'labor';
  IF NOT FOUND THEN reasons := reasons || 'no_quote_rule'::text; END IF;
  SELECT * INTO src FROM public.schema_proposal_witness_sources WHERE source_table = p_source_table;
  IF NOT FOUND THEN
    reasons := reasons || 'source_not_allowed'::text;
  ELSIF p_source_row_id IS NULL THEN
    reasons := reasons || 'row_missing'::text;
  ELSE
    EXECUTE format('SELECT %I::text FROM public.%I WHERE id = $1', src.text_column, src.source_table)
       INTO txt USING p_source_row_id;
    IF txt IS NULL THEN
      reasons := reasons || 'row_missing'::text;
    ELSIF src.generated_marker_column IS NOT NULL THEN
      EXECUTE format('SELECT %I IS NOT NULL FROM public.%I WHERE id = $1', src.generated_marker_column, src.source_table)
         INTO generated USING p_source_row_id;
      IF generated THEN reasons := reasons || 'row_generated'::text; END IF;
    END IF;
  END IF;

  IF p_quote IS NULL OR length(btrim(p_quote)) < coalesce(qr.min_quote_chars, 1) THEN
    reasons := reasons || 'quote_too_short'::text;
  ELSE
    IF length(p_quote) > 300 THEN reasons := reasons || 'quote_too_long'::text; END IF;
    IF qr.category IS NOT NULL AND p_quote !~* qr.term_pattern THEN reasons := reasons || 'quote_no_term'::text; END IF;
    IF qr.figure_required AND p_quote !~ '[0-9]' THEN reasons := reasons || 'quote_no_figure'::text; END IF;
    IF txt IS NOT NULL THEN
      pos := position(p_quote IN txt);
      IF pos = 0 OR substr(txt, pos - 1, 1) ~ '[[:alnum:]]' OR substr(txt, pos + length(p_quote), 1) ~ '[[:alnum:]]' THEN
        reasons := reasons || 'quote_not_in_row'::text;
      END IF;
    END IF;
  END IF;

  figs := ARRAY(SELECT replace(m[1], ',', '')::numeric
                  FROM regexp_matches(coalesce(p_quote, ''), '([0-9]{1,3}(?:,[0-9]{3})+(?:\.[0-9]+)?|[0-9]+(?:\.[0-9]+)?)', 'g') m);
  IF p_low IS NULL OR p_low <= 0 THEN
    reasons := reasons || 'low_missing'::text;
  ELSIF NOT (p_low = ANY (figs)) THEN
    reasons := reasons || 'low_not_in_quote'::text;
  END IF;
  IF p_high IS NOT NULL THEN
    IF p_high < coalesce(p_low, 0) THEN reasons := reasons || 'high_below_low'::text; END IF;
    IF NOT (p_high = ANY (figs)) THEN reasons := reasons || 'high_not_in_quote'::text; END IF;
  END IF;

  IF jsonb_typeof(q) <> 'object' THEN
    reasons := reasons || 'qualifiers_not_object'::text;
    q := '{}'::jsonb;
  END IF;
  FOR k IN SELECT jsonb_object_keys(q) LOOP
    IF k NOT IN ('labor_scope', 'labor_system_key', 'labor_speaker_role', 'labor_statement_kind', 'labor_time_basis',
                 'labor_stated_subject') THEN
      reasons := reasons || ('qualifier_unknown:' || k);
    ELSIF k <> 'labor_stated_subject' AND (jsonb_typeof(q -> k) <> 'string' OR NOT EXISTS (
            SELECT 1 FROM public.labor_statement_values l WHERE l.property_key = k AND l.value = q ->> k)) THEN
      reasons := reasons || ('qualifier_value_unknown:' || k);
    END IF;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['labor_scope', 'labor_speaker_role', 'labor_statement_kind', 'labor_time_basis'] LOOP
    IF NOT q ? k THEN reasons := reasons || ('qualifier_missing:' || k); END IF;
  END LOOP;
  IF q ->> 'labor_scope' = 'task' AND NOT q ? 'labor_system_key' THEN
    reasons := reasons || 'system_key_missing'::text;
  ELSIF q ->> 'labor_scope' = 'whole_build' AND q ? 'labor_system_key' THEN
    reasons := reasons || 'system_key_on_whole_build'::text;
  END IF;
  IF q ? 'labor_stated_subject' AND (jsonb_typeof(q -> 'labor_stated_subject') <> 'string'
       OR length(btrim(q ->> 'labor_stated_subject')) = 0 OR length(q ->> 'labor_stated_subject') > 80
       OR position(q ->> 'labor_stated_subject' IN coalesce(p_quote, '')) = 0) THEN
    reasons := reasons || 'stated_subject_not_in_quote'::text;
  END IF;

  IF txt IS NOT NULL THEN
    IF p_source_table = 'auction_comments' THEN
      SELECT c.vehicle_id INTO veh FROM public.auction_comments c WHERE c.id = p_source_row_id;
    ELSIF p_source_table = 'build_posts' THEN
      SELECT t.vehicle_id INTO veh FROM public.build_posts b JOIN public.build_threads t ON t.id = b.build_thread_id
       WHERE b.id = p_source_row_id;
    ELSIF p_source_table = 'vehicles' THEN
      veh := p_source_row_id;
    END IF;
  END IF;

  RETURN jsonb_build_object('ok', cardinality(reasons) = 0, 'reasons', to_jsonb(reasons),
    'contract', 'reported_labor_hours_v1', 'quote_hash', md5(coalesce(p_quote, '')), 'text_md5', md5(txt),
    'source_vehicle_id', veh);
END $fn$;
COMMENT ON FUNCTION public.reported_labor_statement_check(text, uuid, text, numeric, numeric, jsonb) IS
  'reported_labor_hours_v1: the one check a reported labor statement passes before ingest-observation lands it. Reads schema_proposal_witness_sources, schema_proposal_quote_rules (labor) and labor_statement_values; ok false with reasons otherwise.';
REVOKE ALL ON FUNCTION public.reported_labor_statement_check(text, uuid, text, numeric, numeric, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reported_labor_statement_check(text, uuid, text, numeric, numeric, jsonb) TO service_role;
