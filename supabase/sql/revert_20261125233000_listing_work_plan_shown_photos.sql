-- Revert of 20261125233000_listing_work_plan_shown_photos.sql: the live body of 2026-11-25 (20261019191500), which
-- re-opens image-derived claims on photos the gallery hides. Run by hand only if the migration must be undone.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';
CREATE OR REPLACE FUNCTION public.listing_work_plan_read(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $fn$
DECLARE
  kw jsonb := public.listing_plan_keyword_table();
  v record;
  descr text;
  listing_url text;
  listing_host text;
  import_sources text[];
  dec record;
  dec_usable boolean := false;
  ext record;
  recent_token text;
  family jsonb;
  vals jsonb := '{}'::jsonb;
  fields jsonb := '{}'::jsonb;
  f text;
  claims jsonb := '[]'::jsonb;
  excl jsonb := jsonb_build_object('description_discovery_failure_rows', 0, 'description_discovery_unrecognized_shape_rows', 0,
    'description_discovery_oversized_rows', 0, 'condition_observations_oversized', 0, 'image_claims_excluded_unattributed', 0,
    'image_claims_excluded_image_row_missing', 0, 'image_claims_excluded_sensitive', 0,
    'image_observations_attributed_without_damage_statement', 0, 'keyword_matches_excluded_by_rule', 0);
  r record;
  item jsonb;
  ops jsonb := '[]'::jsonb;
  op_index jsonb := '{}'::jsonb;
  entry jsonb;
  cl jsonb;
  parts jsonb := '[]'::jsonb;
  checklist jsonb := '[]'::jsonb;
  rate jsonb;
  disc_rows integer := 0;
  cond_rows integer := 0;
  identity_blocks boolean;
  tokens text[];
  vyear integer;
  terms text[];
  t text;
  prows jsonb;
  gaps jsonb := '[]'::jsonb;
  pat text;
  cnt integer;
  i integer;
  pos integer;
  whole text;
  g1 text;
  nv jsonb;
  sentence record;
  distinct_vals jsonb;
  statuses jsonb;
  qtext text;
  sys text;
  ids jsonb;
  key text;
  groups jsonb := '[]'::jsonb;
  group_keys text[] := '{}';
BEGIN
  SELECT x.id, x.year, x.make, x.model, x.trim, x.vin, x.engine_size, x.engine_liters, x.engine_displacement, x.displacement,
    x.transmission, x.drivetrain, x.listing_url, x.bat_auction_url, x.discovery_url,
    CASE WHEN octet_length(x.description) <= 32000 THEN x.description END AS description, octet_length(x.description) AS description_bytes
    INTO v FROM public.vehicles x
    WHERE x.id = p_vehicle_id AND x.is_public IS TRUE AND x.deleted_at IS NULL AND x.listing_kind IS DISTINCT FROM 'non_vehicle_item';
  IF v.id IS NULL THEN RAISE EXCEPTION 'Vehicle unavailable'; END IF;
  descr := v.description;
  listing_url := NULLIF(regexp_replace(regexp_replace(COALESCE(v.listing_url, v.bat_auction_url, v.discovery_url, ''), '#.*$', ''), '/+$', ''), '');
  IF listing_url !~* '^https?://' THEN listing_url := NULL; END IF;
  listing_host := lower(regexp_replace(substring(listing_url FROM '^https?://([^/?#]+)'), '^www\.', ''));
  import_sources := ARRAY(SELECT jsonb_array_elements_text(kw->'listing_image_sources'->listing_host));
  vyear := CASE WHEN v.year BETWEEN 1886 AND 2100 THEN v.year END;

  -- Identity values.
  SELECT d.provider, d.decoded_at, d.year, d.make, d.model, d.engine_displacement_liters, d.transmission, d.drivetrain,
    d.raw_response->>'ErrorCode' AS error_code INTO dec
    FROM public.vin_decoded_data d WHERE v.vin ~* '^[A-HJ-NPR-Z0-9]{17}$' AND d.vin = upper(v.vin) ORDER BY d.decoded_at DESC NULLS LAST LIMIT 1;
  dec_usable := (dec.provider IS NOT NULL OR dec.decoded_at IS NOT NULL) AND COALESCE(dec.error_code, '') ~ '^0(\D|$)';
  SELECT d.id, d.raw_extraction, d.discovered_at INTO ext FROM public.description_discoveries d
    WHERE d.vehicle_id = v.id AND NOT (d.raw_extraction ? 'error') AND octet_length(d.raw_extraction::text) <= 64000
      AND jsonb_typeof(d.raw_extraction) = 'object'
      AND EXISTS (SELECT 1 FROM unnest(ARRAY['flags','work','mods','docs','cond','cond_note','title','miles']) k
        WHERE d.raw_extraction->k IS NOT NULL AND d.raw_extraction->k <> 'null'::jsonb)
    ORDER BY d.discovered_at DESC NULLS LAST, d.id DESC LIMIT 1;

  vals := jsonb_build_object('year','[]'::jsonb,'make','[]'::jsonb,'model','[]'::jsonb,'vin','[]'::jsonb,'engine_displacement_l','[]'::jsonb,
    'transmission','[]'::jsonb,'drivetrain','[]'::jsonb,'induction','[]'::jsonb);
  FOR r IN
    SELECT * FROM (VALUES
      ('year','record','vehicles.year', v.year::text), ('make','record','vehicles.make', v.make), ('model','record','vehicles.model', v.model),
      ('vin','record','vehicles.vin', v.vin), ('engine_displacement_l','record','vehicles.engine_liters', v.engine_liters::text),
      ('engine_displacement_l','record','vehicles.engine_displacement', v.engine_displacement),
      ('engine_displacement_l','record','vehicles.displacement', v.displacement), ('engine_displacement_l','record','vehicles.engine_size', v.engine_size),
      ('transmission','record','vehicles.transmission', v.transmission), ('drivetrain','record','vehicles.drivetrain', v.drivetrain),
      ('year','vin_decode','vin_decoded_data.year', CASE WHEN dec_usable THEN dec.year::text END),
      ('make','vin_decode','vin_decoded_data.make', CASE WHEN dec_usable THEN dec.make END),
      ('model','vin_decode','vin_decoded_data.model', CASE WHEN dec_usable THEN dec.model END),
      ('engine_displacement_l','vin_decode','vin_decoded_data.engine_displacement_liters', CASE WHEN dec_usable THEN dec.engine_displacement_liters END),
      ('transmission','vin_decode','vin_decoded_data.transmission', CASE WHEN dec_usable THEN dec.transmission END),
      ('drivetrain','vin_decode','vin_decoded_data.drivetrain', CASE WHEN dec_usable THEN dec.drivetrain END),
      ('vin','listing_text_extraction','description_discoveries:' || ext.id || '/raw_extraction/vin', ext.raw_extraction->>'vin'),
      ('engine_displacement_l','listing_text_extraction','description_discoveries:' || ext.id || '/raw_extraction/e_liters', ext.raw_extraction->>'e_liters'),
      ('transmission','listing_text_extraction','description_discoveries:' || ext.id || '/raw_extraction/t_type', ext.raw_extraction->>'t_type'),
      ('drivetrain','listing_text_extraction','description_discoveries:' || ext.id || '/raw_extraction/drive', ext.raw_extraction->>'drive'),
      ('induction','listing_text_extraction','description_discoveries:' || ext.id || '/raw_extraction/e_fuel', ext.raw_extraction->>'e_fuel')
    ) s(field, source, path, raw)
  LOOP
    nv := public.listing_plan_normalize(r.field, r.raw);
    IF nv IS NOT NULL THEN
      vals := jsonb_set(vals, ARRAY[r.field], (vals->r.field) || jsonb_build_array(jsonb_build_object('source', r.source, 'field_path', r.path, 'raw', r.raw, 'value', nv)));
    END IF;
  END LOOP;
  IF ext.id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(vals->'engine_displacement_l') e WHERE e->>'source' = 'listing_text_extraction')
      AND ext.raw_extraction->'e_ci' IS NOT NULL AND ext.raw_extraction->'e_ci' <> 'null'::jsonb THEN
    nv := public.listing_plan_normalize('engine_displacement_l', (ext.raw_extraction->>'e_ci') || ' ci');
    IF nv IS NOT NULL THEN
      vals := jsonb_set(vals, '{engine_displacement_l}', (vals->'engine_displacement_l') || jsonb_build_array(jsonb_build_object('source', 'listing_text_extraction',
        'field_path', 'description_discoveries:' || ext.id || '/raw_extraction/e_ci', 'raw', (ext.raw_extraction->>'e_ci') || ' ci', 'value', nv)));
    END IF;
  END IF;
  FOR family IN SELECT * FROM jsonb_array_elements(COALESCE(kw->'identity_series_families', '[]'::jsonb)) LOOP
    IF recent_token IS NOT NULL THEN EXIT; END IF;
    SELECT lower(tk) INTO recent_token FROM jsonb_array_elements_text(family->'tokens') WITH ORDINALITY x(tk, o)
      WHERE COALESCE(v.model, '') ~* ('\y' || tk || '\y') ORDER BY o LIMIT 1;
    IF recent_token IS NOT NULL THEN
      vals := jsonb_set(vals, '{model}', (vals->'model') || public.listing_plan_text_values(descr,
        '\y(' || (SELECT string_agg(tk, '|') FROM jsonb_array_elements_text(family->'tokens') tk) || ')\y', 'series_token', family->>'family'));
    END IF;
  END LOOP;
  IF lower(btrim(COALESCE(v.make, ''))) <> '' THEN
    vals := jsonb_set(vals, '{year}', (vals->'year') || public.listing_plan_text_values(descr, '\y(1[89]\d{2}|20\d{2})\s+' ||
      regexp_replace(lower(btrim(v.make)), '([.*+?^${}()|\[\]\\])', '\\\1', 'g') || '\y', 'year', NULL));
  END IF;
  vals := jsonb_set(vals, '{vin}', (vals->'vin') || public.listing_plan_text_values(descr, '\y([A-HJ-NPR-Z0-9]{17})\y', 'vin17', NULL));
  IF v.vin ~* '^[A-HJ-NPR-Z0-9]{11,16}$' THEN
    vals := jsonb_set(vals, '{vin}', (vals->'vin') || public.listing_plan_text_values(descr, '\y(' || upper(btrim(v.vin)) || ')\y', 'vin_upper', NULL));
  END IF;
  vals := jsonb_set(vals, '{engine_displacement_l}', (vals->'engine_displacement_l')
    || public.listing_plan_text_values(descr, '\y(\d\.\d)[- ]?(?:liter|litre|l)\y', 'engine_displacement_l', NULL)
    || public.listing_plan_text_values(descr, '\y(\d{3}[- ]?(?:ci|cid|cubic[- ]inch(?:es)?))\y', 'engine_displacement_l', NULL));
  vals := jsonb_set(vals, '{transmission}', (vals->'transmission') || public.listing_plan_text_values(descr,
    '\y(?:\d|three|four|five|six)[- ]speed (manual|automatic)\y|\y(manual|automatic) (?:transmission|gearbox)\y', 'transmission', NULL));
  vals := jsonb_set(vals, '{drivetrain}', (vals->'drivetrain') || public.listing_plan_text_values(descr,
    '\y(4x4|4×4|4wd|four-wheel drive|2wd|rwd|rear-wheel drive|awd|all-wheel drive)\y', 'drivetrain', NULL));
  vals := jsonb_set(vals, '{induction}', (vals->'induction') || public.listing_plan_text_values(descr,
    '\y(carbureted|carburetor|carburettor|[24]-barrel|four-barrel|two-barrel|quadrajet|fuel[- ]injected|fuel injection|efi|tbi|throttle[- ]body injection)\y', 'induction', NULL));
  FOR f IN SELECT jsonb_object_keys(vals) LOOP
    fields := fields || jsonb_build_object(f, jsonb_build_object('status', public.listing_plan_field_status(f, vals->f, recent_token), 'values', vals->f));
  END LOOP;

  -- Claims: listing statements.
  IF descr IS NOT NULL THEN
    FOR sentence IN SELECT * FROM public.listing_plan_sentences(descr) LOOP
      IF sentence.quote ~* public.listing_plan_re('\b(?:rust\w*|corro\w*|rot|undercoat\w*|undercarriage|frame|wear|worn|crack\w*|dent\w*|scratch\w*|repaint\w*|paint|damage\w*|accident|collision)\b')
         OR sentence.quote ~* public.listing_plan_re('\b(?:needs?|due|overdue|inoperative|doesn[''’]t\s+work|not\s+working|bypass\w*|leak\w*|misfir\w*|overheat\w*|smok\w*|noise|vibrat\w*|check\s+engine|warning\s+light|defrost|a\/c)\b') THEN
        qtext := regexp_replace(sentence.quote, '^\s+|\s+$', '', 'g');
        claims := public.listing_plan_push(claims, jsonb_build_object('kind', 'listing_statement', 'text', qtext,
          'verbatim_excerpt', jsonb_build_object('quote', sentence.quote, 'start', sentence.start_cp, 'end', sentence.end_cp, 'offset_unit', 'unicode_code_points'),
          'excerpt_status', 'exact_excerpt_in_listing_text', 'review_flags', public.listing_plan_review_flags(sentence.quote),
          'facets', public.listing_plan_facets(sentence.quote),
          'source', jsonb_build_object('table', 'vehicles', 'ref', 'vehicles:' || v.id, 'path', '/description', 'source_url', listing_url,
            'method', 'lexical_candidate', 'listing_episode', 'current_record_listing_url'),
          'clocks', jsonb_build_object('event_at', NULL, 'event_clock_basis', 'listing_publication_clock_not_read', 'recorded_at', NULL),
          'confidence', jsonb_build_object('value', NULL, 'basis', 'lexical_candidate_unscored')));
      END IF;
    END LOOP;
  END IF;

  -- Claims: description_discoveries (v3 keys), at most 500 rows by id.
  FOR r IN SELECT d.id, d.discovered_at, d.model_used, d.prompt_version, (d.raw_extraction ? 'error') AS is_failure,
      CASE WHEN NOT (d.raw_extraction ? 'error') AND octet_length(d.raw_extraction::text) <= 64000 THEN d.raw_extraction END AS raw,
      octet_length(d.raw_extraction::text) AS bytes
    FROM public.description_discoveries d WHERE d.vehicle_id = v.id ORDER BY d.id LIMIT 500
  LOOP
    disc_rows := disc_rows + 1;
    IF r.is_failure IS TRUE THEN excl := jsonb_set(excl, '{description_discovery_failure_rows}', to_jsonb((excl->>'description_discovery_failure_rows')::int + 1)); CONTINUE; END IF;
    IF r.raw IS NULL OR jsonb_typeof(r.raw) <> 'object' THEN
      IF r.bytes > 64000 THEN excl := jsonb_set(excl, '{description_discovery_oversized_rows}', to_jsonb((excl->>'description_discovery_oversized_rows')::int + 1));
      ELSE excl := jsonb_set(excl, '{description_discovery_unrecognized_shape_rows}', to_jsonb((excl->>'description_discovery_unrecognized_shape_rows')::int + 1)); END IF;
      CONTINUE;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM unnest(ARRAY['flags','work','mods','docs','cond','cond_note','title','miles']) k WHERE r.raw->k IS NOT NULL AND r.raw->k <> 'null'::jsonb) THEN
      excl := jsonb_set(excl, '{description_discovery_unrecognized_shape_rows}', to_jsonb((excl->>'description_discovery_unrecognized_shape_rows')::int + 1)); CONTINUE;
    END IF;
    FOR item IN SELECT * FROM public.listing_plan_discovery_items(r.raw) LOOP
      claims := public.listing_plan_push(claims, (item - 'extra') || public.listing_plan_locate(descr, item->>'text') || jsonb_build_object('review_flags', '[]'::jsonb,
        'source', jsonb_build_object('table', 'description_discoveries', 'ref', 'description_discoveries:' || r.id, 'path', item->>'path', 'source_url', listing_url,
          'method', 'llm_extraction_over_listing_text', 'model', r.model_used, 'prompt_version', r.prompt_version, 'listing_episode', 'vehicle_scoped_not_episode_scoped'),
        'clocks', jsonb_build_object('event_at', NULL, 'event_clock_basis', 'listing_publication_clock_not_read', 'extracted_at', r.discovered_at),
        'confidence', jsonb_build_object('value', NULL, 'basis', 'llm_extraction_unscored',
          'extraction_self_reported_auth', CASE WHEN jsonb_typeof(r.raw->'auth') = 'number' THEN r.raw->'auth' END)) || COALESCE(item->'extra', '{}'::jsonb));
    END LOOP;
  END LOOP;

  -- Claims: condition observations, at most 500 rows by id.
  FOR r IN SELECT o.id, o.source_url, o.observed_at, o.ingested_at, o.extraction_method, o.confidence_score,
      CASE WHEN octet_length(o.content_text) <= 32000 THEN o.content_text END AS content_text, octet_length(o.content_text) AS text_bytes,
      CASE WHEN octet_length(o.structured_data::text) <= 64000 THEN o.structured_data END AS data, octet_length(o.structured_data::text) AS data_bytes,
      w.image_id, vi.vehicle_id AS image_vehicle_id, vi.source AS image_source, vi.is_sensitive AS image_is_sensitive
    FROM public.vehicle_observations o
    LEFT JOIN LATERAL (SELECT CASE WHEN x ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN x::uuid END AS image_id
      FROM (SELECT COALESCE(o.structured_data->>'witness_image_id', o.structured_data->>'image_id') AS x) s) w ON true
    LEFT JOIN public.vehicle_images vi ON vi.id = w.image_id
    WHERE o.vehicle_id = v.id AND o.subject_type = 'vehicle' AND o.kind::text = 'condition' AND o.is_superseded IS NOT TRUE
      AND public.observation_is_public(o.kind, o.structured_data)
    ORDER BY o.id LIMIT 500
  LOOP
    cond_rows := cond_rows + 1;
    IF (r.data_bytes > 64000 AND r.data IS NULL) OR (r.text_bytes > 32000 AND r.content_text IS NULL) THEN
      excl := jsonb_set(excl, '{condition_observations_oversized}', to_jsonb((excl->>'condition_observations_oversized')::int + 1)); CONTINUE;
    END IF;
    FOR item IN SELECT * FROM public.listing_plan_condition_items(r.data, r.content_text, r.image_id) LOOP
      IF item->>'exclusion' IS NOT NULL THEN
        excl := jsonb_set(excl, ARRAY[item->>'exclusion'], to_jsonb((excl->>(item->>'exclusion'))::int + 1)); CONTINUE;
      END IF;
      IF item->>'image_derived' = 'true' THEN
        IF r.image_id IS NULL OR r.image_vehicle_id IS NULL THEN excl := jsonb_set(excl, '{image_claims_excluded_image_row_missing}', to_jsonb((excl->>'image_claims_excluded_image_row_missing')::int + 1)); EXIT; END IF;
        IF r.image_is_sensitive IS DISTINCT FROM false THEN excl := jsonb_set(excl, '{image_claims_excluded_sensitive}', to_jsonb((excl->>'image_claims_excluded_sensitive')::int + 1)); EXIT; END IF;
        IF r.image_vehicle_id <> v.id OR NOT (r.image_source = ANY (import_sources)) THEN
          excl := jsonb_set(excl, '{image_claims_excluded_unattributed}', to_jsonb((excl->>'image_claims_excluded_unattributed')::int + 1)); EXIT;
        END IF;
        IF item->>'kind' IS NULL THEN excl := jsonb_set(excl, '{image_observations_attributed_without_damage_statement}',
          to_jsonb((excl->>'image_observations_attributed_without_damage_statement')::int + 1)); EXIT; END IF;
      END IF;
      claims := public.listing_plan_push(claims, jsonb_build_object('kind', item->>'kind', 'text', item->>'text') || public.listing_plan_locate(descr, item->>'text')
        || jsonb_build_object('review_flags', '[]'::jsonb,
          'source', jsonb_build_object('table', 'vehicle_observations', 'ref', 'vehicle_observations:' || r.id, 'path', item->>'path',
            'source_url', r.source_url, 'method', CASE WHEN item->>'image_derived' = 'true' THEN COALESCE(r.extraction_method, 'unknown') || ':image_inference_unverified' ELSE r.extraction_method END,
            'listing_episode', CASE WHEN r.source_url IS NULL THEN 'unknown'
              WHEN regexp_replace(regexp_replace(r.source_url, '#.*$', ''), '/+$', '') = listing_url THEN 'same_url' ELSE 'different_url' END)
            || CASE WHEN item->>'image_derived' = 'true' THEN jsonb_build_object('image_id', r.image_id, 'image_source', r.image_source) ELSE '{}'::jsonb END,
          'clocks', jsonb_build_object('event_at', r.observed_at, 'event_clock_basis', 'observation_observed_at', 'recorded_at', r.ingested_at),
          'confidence', jsonb_build_object('value', r.confidence_score, 'basis', 'recorded_observation_confidence_score_unaudited')));
    END LOOP;
  END LOOP;

  -- Candidate operations from the keyword table.
  FOR cl IN SELECT * FROM jsonb_array_elements(claims) LOOP
    IF cl->>'kind' NOT IN ('defect_or_condition', 'condition_summary', 'listing_statement') THEN CONTINUE; END IF;
    FOR entry IN SELECT * FROM jsonb_array_elements(kw->'entries') LOOP
      IF NOT (cl->>'text' ~* public.listing_plan_re(entry->>'pattern')) THEN CONTINUE; END IF;
      IF entry ? 'requires' AND NOT (cl->>'text' ~* public.listing_plan_re(entry->>'requires')) THEN CONTINUE; END IF;
      IF entry ? 'exclude' AND cl->>'text' ~* public.listing_plan_re(entry->>'exclude') THEN
        excl := jsonb_set(excl, '{keyword_matches_excluded_by_rule}', to_jsonb((excl->>'keyword_matches_excluded_by_rule')::int + 1)); CONTINUE;
      END IF;
      IF NOT (op_index ? (entry->>'id')) THEN
        op_index := op_index || jsonb_build_object(entry->>'id', jsonb_array_length(ops));
        ops := ops || jsonb_build_array(jsonb_build_object('operation_id', 'op:' || (entry->>'id'), 'keyword_entry_id', entry->>'id',
          'system', entry->>'system', 'target_choice', entry->>'target_choice', 'claim_ids', '[]'::jsonb, 'review_flags', '[]'::jsonb,
          'parts_terms', entry->'parts_terms',
          'targets', (SELECT jsonb_agg(public.listing_plan_resolve_target(tg, vyear) ORDER BY o) FROM jsonb_array_elements(entry->'targets') WITH ORDINALITY x(tg, o)),
          'stage', 'candidate_for_inspection', 'basis', 'reviewed_keyword_table_match'));
      END IF;
      i := (op_index->>(entry->>'id'))::int;
      ops := jsonb_set(ops, ARRAY[i::text, 'claim_ids'], (ops->i->'claim_ids') || to_jsonb(cl->>'claim_id'));
      ops := jsonb_set(ops, ARRAY[i::text, 'review_flags'], (SELECT COALESCE(jsonb_agg(DISTINCT x ORDER BY x), '[]'::jsonb) FROM (
        SELECT jsonb_array_elements_text(ops->i->'review_flags') x UNION SELECT jsonb_array_elements_text(COALESCE(cl->'review_flags', '[]'::jsonb))
        UNION SELECT 'negation_present_review_scope' WHERE cl->>'text' ~* '\y(no|not|never|without)\y'
        UNION SELECT 'matched_summary_prose' WHERE cl->>'kind' = 'condition_summary') y));
    END LOOP;
  END LOOP;

  -- Parts with priced text fitment (unverified).
  identity_blocks := EXISTS (SELECT 1 FROM unnest(ARRAY['year','make','model']) k WHERE fields->k->>'status' = 'conflict');
  tokens := ARRAY(SELECT DISTINCT ON (o) tk FROM (SELECT tk, min(o) o FROM regexp_split_to_table(upper(COALESCE(v.model, '')), '[^A-Z0-9-]+') WITH ORDINALITY x(tk, o)
    WHERE tk ~ '^[A-Z0-9-]{1,20}$' GROUP BY tk) y ORDER BY o LIMIT 6);
  terms := ARRAY(SELECT term FROM jsonb_array_elements(ops) WITH ORDINALITY z(op, o),
      jsonb_array_elements_text(op->'parts_terms') WITH ORDINALITY y(term, k) GROUP BY term ORDER BY min(o * 1000 + k));
  i := 0;
  FOREACH t IN ARRAY terms LOOP
    i := i + 1;
    IF i > 10 OR cardinality(tokens) = 0 OR vyear IS NULL THEN
      parts := parts || jsonb_build_array(jsonb_build_object('term', t, 'state', 'not_read',
        'reason', CASE WHEN i > 10 THEN 'term_budget' ELSE 'record_year_or_model_tokens_missing' END, 'rows', '[]'::jsonb));
      CONTINUE;
    END IF;
    SELECT COALESCE(jsonb_agg(jsonb_build_object('catalog_part_id', cp.id, 'part_number', cp.part_number, 'name', cp.name,
        'price_current', cp.price_current, 'currency', cp.currency, 'fits_models', cp.fits_models, 'year_start', cp.year_start,
        'year_end', cp.year_end, 'manufacturer', cp.manufacturer) ORDER BY cp.price_current, cp.id), '[]'::jsonb) INTO prows
      FROM (SELECT * FROM public.catalog_parts c WHERE c.price_current > 0 AND c.name ILIKE '%' || t || '%'
        AND c.fits_models IS NOT NULL AND c.year_start IS NOT NULL AND c.year_end IS NOT NULL AND vyear BETWEEN c.year_start AND c.year_end
        AND EXISTS (SELECT 1 FROM unnest(c.fits_models) fm WHERE upper(fm) = ANY (tokens)) ORDER BY c.price_current, c.id LIMIT 5) cp;
    parts := parts || jsonb_build_array(jsonb_build_object('term', t, 'state', CASE WHEN jsonb_array_length(prows) > 0 THEN 'priced_text_fitment_match' ELSE 'no_priced_text_fitment_match' END,
      'match_rule', jsonb_build_object('model_tokens', to_jsonb(tokens), 'year', vyear, 'rule', 'name ILIKE term AND fits_models token AND year in [year_start, year_end] AND price_current > 0'),
      'rows', prows));
  END LOOP;
  parts := COALESCE((SELECT jsonb_agg(p || jsonb_build_object(
      'operation_ids', (SELECT jsonb_agg(op->'operation_id') FROM jsonb_array_elements(ops) op WHERE op->'parts_terms' ? (p->>'term')),
      'fitment', 'text_match_unverified', 'price_basis', 'catalog_parts.price_current_as_recorded',
      'identity_dependency', CASE WHEN identity_blocks THEN 'identity_conflict_unresolved_fitment_unusable' ELSE 'record_identity_unverified' END) ORDER BY o)
    FROM jsonb_array_elements(parts) WITH ORDINALITY x(p, o)), '[]'::jsonb);

  -- PPI checklist: identity first, then one item per distinct claim text.
  FOR f IN SELECT k FROM unnest(ARRAY['year','make','model','vin','engine_displacement_l','transmission','drivetrain','induction']) k LOOP
    IF fields->f->>'status' IN ('conflict', 'unresolved_specificity') THEN
      checklist := checklist || jsonb_build_array(jsonb_build_object('item_id', 'ppi:identity:' || f, 'order', 0,
        'basis', CASE WHEN fields->f->>'status' = 'conflict' THEN 'identity_conflict' ELSE 'identity_specificity' END, 'field', f,
        'question', 'Confirm ' || replace(f, '_', ' ') || ' from the VIN plate, build documents and the vehicle itself. Sources: '
          || (SELECT string_agg(sv, '; ' ORDER BY o) FROM (SELECT sv, min(o) o FROM (SELECT (e->>'source') || '=' || (e->>'value') sv, o
            FROM jsonb_array_elements(fields->f->'values') WITH ORDINALITY y(e, o)) z GROUP BY sv) w),
        'finding', public.listing_plan_empty_finding(CASE WHEN f IN ('engine_displacement_l','induction') THEN 'engine_bay'
          WHEN f IN ('transmission','drivetrain') THEN 'drivetrain' ELSE 'other' END)));
    END IF;
  END LOOP;
  FOR cl IN SELECT * FROM jsonb_array_elements(claims) LOOP
    key := (cl->>'kind') || E'\n' || lower(regexp_replace(btrim(cl->>'text'), '\s+', ' ', 'g'));
    i := array_position(group_keys, key);
    IF i IS NULL THEN
      group_keys := group_keys || key;
      groups := groups || jsonb_build_array(jsonb_build_object('kind', cl->>'kind', 'text', cl->>'text', 'ids', jsonb_build_array(cl->>'claim_id')));
    ELSE
      groups := jsonb_set(groups, ARRAY[(i - 1)::text, 'ids'], (groups->(i - 1)->'ids') || to_jsonb(cl->>'claim_id'));
    END IF;
  END LOOP;
  FOR item IN SELECT * FROM jsonb_array_elements(groups) LOOP
    ids := item->'ids';
    SELECT op->>'system' INTO sys FROM jsonb_array_elements(ids) cid, jsonb_array_elements(ops) WITH ORDINALITY z(op, o)
      WHERE op->'claim_ids' ? (cid#>>'{}') ORDER BY o LIMIT 1;
    checklist := checklist || jsonb_build_array(jsonb_build_object('item_id', 'ppi:' || (ids->>0), 'order', 1, 'basis', 'claim', 'claim_ids', ids,
      'claim_kind', item->>'kind',
      'linked_operation_ids', COALESCE((SELECT jsonb_agg(op->'operation_id' ORDER BY o) FROM jsonb_array_elements(ops) WITH ORDINALITY z(op, o)
        WHERE EXISTS (SELECT 1 FROM jsonb_array_elements_text(ids) cid WHERE op->'claim_ids' ? cid)), '[]'::jsonb),
      'question', public.listing_plan_question(item->>'kind', btrim(item->>'text')),
      'finding', public.listing_plan_empty_finding(sys)));
    sys := NULL;
  END LOOP;

  rate := public.resolve_labor_rate();
  IF v.description_bytes > 32000 THEN gaps := gaps || jsonb_build_array(jsonb_build_object('family', 'parent', 'reason', 'description_budget')); END IF;
  IF descr IS NULL THEN gaps := gaps || jsonb_build_array(jsonb_build_object('family', 'parent', 'reason', 'listing_text_absent')); END IF;
  IF disc_rows >= 500 THEN gaps := gaps || jsonb_build_array(jsonb_build_object('family', 'discoveries', 'reason', 'row_budget')); END IF;
  IF cond_rows >= 500 THEN gaps := gaps || jsonb_build_array(jsonb_build_object('family', 'condition', 'reason', 'row_budget')); END IF;

  RETURN jsonb_build_object('schema_version', 'buying_plan_v1', 'as_of', statement_timestamp(), 'vehicle_id', v.id, 'state', 'public_current_parent',
    'viewer', public.job_reader_viewer(CASE WHEN auth.uid() IS NULL THEN 'visitor' ELSE 'self' END, '{}', public.viewer_identity_bridge(auth.uid()), false),
    'record_label', concat_ws(' ', v.year, v.make, v.model), 'listing_url', listing_url,
    'vehicle_label', jsonb_build_object('year', v.year, 'make', v.make, 'model', v.model, 'trim', v.trim, 'text', NULLIF(concat_ws(' ', v.year, v.make, v.model, v.trim), '')),
    'identity', jsonb_build_object('fields', fields,
      'conflicts', COALESCE((SELECT jsonb_agg(k ORDER BY o) FROM unnest(ARRAY['year','make','model','vin','engine_displacement_l','transmission','drivetrain','induction']) WITH ORDINALITY x(k, o) WHERE fields->k->>'status' = 'conflict'), '[]'::jsonb),
      'unresolved_specificity', COALESCE((SELECT jsonb_agg(k ORDER BY o) FROM unnest(ARRAY['year','make','model','vin','engine_displacement_l','transmission','drivetrain','induction']) WITH ORDINALITY x(k, o) WHERE fields->k->>'status' = 'unresolved_specificity'), '[]'::jsonb),
      'vin_decode', CASE WHEN dec.provider IS NULL AND dec.decoded_at IS NULL
        THEN jsonb_build_object('state', CASE WHEN v.vin ~* '^[A-HJ-NPR-Z0-9]{17}$' THEN 'no_cached_decode' ELSE 'not_applicable_vin_absent_or_not_17' END)
        ELSE jsonb_build_object('state', CASE WHEN dec_usable THEN 'usable' ELSE 'error_code_not_success' END, 'provider', dec.provider,
          'error_code', dec.error_code, 'decoded_at', dec.decoded_at) END,
      'method', 'deterministic_field_comparison; text values are regex matches with verbatim sentence excerpts; units normalized to liters (ci x 0.0163871)',
      'interpretation', 'A conflict means the records disagree. It does not decide which record is right; the inspection does.'),
    'claims', claims, 'exclusions', excl,
    'candidate_operations', COALESCE((SELECT jsonb_agg(op - 'parts_terms' ORDER BY o) FROM jsonb_array_elements(ops) WITH ORDINALITY z(op, o)), '[]'::jsonb),
    'parts', parts, 'ppi_checklist', checklist,
    'inspection_scope', jsonb_build_object('inspection_type', 'pre_purchase', 'listing_url', listing_url,
      'ppi_checklist', COALESCE((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('item_id', c->>'item_id',
          'question', CASE WHEN char_length(c->>'question') > 500 THEN left(c->>'question', 497) || '...' ELSE c->>'question' END,
          'system', c#>>'{finding,system}', 'basis', c->>'basis')) ORDER BY o) FROM jsonb_array_elements(checklist) WITH ORDINALITY x(c, o)), '[]'::jsonb),
      'reader', 'request_inspection(p_vehicle_id, NULL, inspection_scope)'),
    'operation_coverage', jsonb_build_object(
      'eligible_claims', (SELECT count(*) FROM jsonb_array_elements(claims) c WHERE c->>'kind' IN ('listing_statement','defect_or_condition','condition_summary')),
      'matched_claims', (SELECT count(*) FROM jsonb_array_elements(claims) c WHERE c->>'kind' IN ('listing_statement','defect_or_condition','condition_summary')
        AND EXISTS (SELECT 1 FROM jsonb_array_elements(ops) op WHERE op->'claim_ids' ? (c->>'claim_id'))),
      'claims_without_reference_operation', COALESCE((SELECT jsonb_agg(c->'claim_id') FROM jsonb_array_elements(claims) c
        WHERE c->>'kind' IN ('listing_statement','defect_or_condition','condition_summary')
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ops) op WHERE op->'claim_ids' ? (c->>'claim_id'))), '[]'::jsonb),
      'basis', 'eligible = listing_statement, defect_or_condition and condition_summary claims; matched = at least one keyword-table entry'),
    'counts', jsonb_build_object('claims', jsonb_array_length(claims),
      'identity_conflicts', (SELECT count(*) FROM unnest(ARRAY['year','make','model','vin','engine_displacement_l','transmission','drivetrain','induction']) k WHERE fields->k->>'status' = 'conflict'),
      'identity_unresolved_specificity', (SELECT count(*) FROM unnest(ARRAY['year','make','model','vin','engine_displacement_l','transmission','drivetrain','induction']) k WHERE fields->k->>'status' = 'unresolved_specificity'),
      'candidate_operations', jsonb_array_length(ops), 'ppi_items', jsonb_array_length(checklist),
      'claims_by_kind', COALESCE((SELECT jsonb_object_agg(k, n) FROM (SELECT c->>'kind' k, count(*) n FROM jsonb_array_elements(claims) c GROUP BY 1) x), '{}'::jsonb)),
    'rate', jsonb_build_object('state', 'as_returned', 'value', rate, 'call', 'public.resolve_labor_rate() with no arguments',
      'contract_branch', 'not_executed_requires_client_and_organization',
      'interpretation', 'Shown exactly as returned. A placeholder unless source is contract, user or organization; never a provider rate. Not multiplied into hours here.'),
    'keyword_table', jsonb_build_object('schema_version', kw->>'schema_version', 'reviewed_at', kw->>'reviewed_at', 'review_state', kw->>'review_state',
      'sha256_base64', 'xT6BV9h9HQdgnwZijC2xX00yVTn1stSTSYnfNWmwh+E=', 'entries', jsonb_array_length(kw->'entries')),
    'collections', jsonb_build_object('discoveries', jsonb_build_object('fetched_rows', disc_rows, 'cap', 500),
      'condition', jsonb_build_object('fetched_rows', cond_rows, 'cap', 500), 'parts_terms', jsonb_build_object('read', LEAST(cardinality(terms), 10), 'cap', 10)),
    'gaps', gaps,
    'finding_slot_contract', jsonb_build_object('inspection_type', 'pre_purchase', 'verdict', jsonb_build_array('supports', 'contradicts', 'unknown'),
      'severity', jsonb_build_array('info', 'monitor', 'concern', 'critical')),
    'retrieval_boundary', jsonb_build_object('not_read', jsonb_build_array('comment_discoveries', 'auction_comments', 'component_identifications',
      'image_condition_observations', 'vehicle_condition_scores', 'listing_page_snapshots'), 'raw_image_pixels', 'not_interpreted', 'seller_identity', 'not_returned'),
    'model_calls', 0, 'database_writes', 0,
    'interpretation', 'An estimate to inspect, not an estimate to restore. Claims are listing testimony; operations are keyword-table candidates with seed_uncalibrated reference hours; parts are unverified text-fitment matches; the rate is shown as returned. The pre-purchase inspection turns each item into an observation.');
END $fn$;
DO $v$ BEGIN
  IF md5((SELECT prosrc FROM pg_proc WHERE oid = 'public.listing_work_plan_read(uuid)'::regprocedure)) <> '5795c6f78ba7845c20a1666935930844' THEN
    RAISE EXCEPTION 'revert body differs from the 2026-11-25 live body';
  END IF;
END $v$;
-- The migration's rule row and policy-copy row go with its body (config rows, not testimony).
DELETE FROM public.platform_config WHERE config_key = 'listing_work_plan_read';
DO $r$ BEGIN
  IF to_regclass('public.private_row_policy_copies') IS NOT NULL THEN
    EXECUTE $d$DELETE FROM public.private_row_policy_copies WHERE reader = 'listing_work_plan_read(uuid)' AND relation = 'vehicle_images'$d$;
  END IF;
END $r$;
COMMIT;
