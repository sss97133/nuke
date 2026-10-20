-- listing_work_plan_read: the read-only logic of scripts/discovery/buying-evidence.mjs --plan as a SQL reader
-- (R4 reader #16), anon + authenticated. An estimate to inspect, not to restore.
--   identity   record / cached VIN decode / latest listing-text extraction / listing-text regex values per field;
--              conflict and unresolved_specificity first (the script's buildIdentity)
--   claims     lexical condition/unresolved-work sentences of the description, description_discoveries v3 keys
--              (failure rows counted and excluded), condition observations (rubric, text, listing-attributed image
--              inference; unattributed, missing and sensitive image claims counted and excluded); excerpt, source,
--              clocks and confidence per claim; claim_id = first 16 hex of sha256(ref, path, text) as the script
--   operations the reviewed keyword table (embedded verbatim from scripts/discovery/buying-evidence-plan-keywords.json,
--              sha256 (base64) xT6BV9h9HQdgnwZijC2xX00yVTn1stSTSYnfNWmwh+E=), targets resolved from labor_operations and stage_transition_labor_map, every
--              hour value labelled seed_uncalibrated
--   rate       exactly what resolve_labor_rate() returns with no arguments, labelled; never applied to hours
--   parts      catalog_parts with priced text fitment (name ILIKE term, fits_models token, year in range), unverified
--   checklist  ppi items with inspection_type pre_purchase, also returned as inspection_scope, the p_scope shape
--              request_inspection accepts ({inspection_type, listing_url, ppi_checklist[{item_id, question, system,
--              basis}]})
-- Bounded: description up to 32,000 bytes, 500 discovery rows, 500 condition rows, 10 parts terms x 5 rows.
-- Open data: no seller identity, no PII; public, current, non-item vehicles only. No writes, no model calls.
-- JavaScript regex sources are adapted for PostgreSQL (\b becomes \y); offsets are code points as in the script.
-- Contract: supabase/sql/test_listing_work_plan_read.sql (PG17).
BEGIN;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '1s';

CREATE FUNCTION public.listing_plan_keyword_table() RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS
$kw$ SELECT $json${"schema_version":"buying_plan_keywords_v1","reviewed_at":"2026-10-19","review_state":"operator_reviewed_pending_owner_review","note":"Search vocabulary from claim text to seed reference rows. A match proposes a candidate operation for inspection; it is not a diagnosis, a repair decision or a price. Hours come from labor_operations / stage_transition_labor_map as read live and stay seed_uncalibrated. Extend only from reviewed misses.","listing_image_sources":{"bringatrailer.com":["bat_import"]},"identity_series_families":[{"family":"gm_ck_truck","tokens":["C10","C20","C30","K5","K10","K20","K30","C1500","C2500","C3500","K1500","K2500","K3500"]},{"family":"lexus_lx","tokens":["LX450","LX470","LX570"]}],"entries":[{"id":"dent","system":"body","pattern":"\\bdent(s|ed|ing)?\\b","exclude":"\\b(no|without)\\s+dents?\\b|paintless dent repair","targets":[{"type":"labor_operation","code":"BODY-DENT-SMALL"},{"type":"labor_operation","code":"BODY-DENT-MED"},{"type":"labor_operation","code":"BODY-DENT-LARGE"}],"target_choice":"alternatives_size_unknown","parts_terms":[]},{"id":"rust_body","system":"body","pattern":"\\b(rust|rusted|rusty|corrosion|corroded|rot|rotted|bubbl\\w*)\\b","exclude":"\\brust[- ]free\\b|\\bno (visible )?rust\\b|\\bwithout rust\\b","targets":[{"type":"labor_operation","code":"BODY-RUST-SPOT"},{"type":"labor_operation","code":"BODY-RUST-PANEL"},{"type":"stage_row","category":"body","from_stage":"stripped","to_stage":"fabricated","zone_pattern":"panel_*"}],"target_choice":"alternatives_extent_unknown","parts_terms":[]},{"id":"paint_refinish","system":"body","pattern":"\\b(fad\\w*|touch[- ]?up|scratch\\w*|blemish\\w*|chip(s|ped)?|clear ?coat (failure|peel\\w*)|peel\\w*|oxidi[sz]\\w*|paint imperfection\\w*|imperfections)\\b","targets":[{"type":"labor_operation","code":"PAINT-COMPLETE-PANEL"},{"type":"stage_chain","rows":[{"category":"body","from_stage":"fabricated","to_stage":"primed","zone_pattern":"panel_*"},{"category":"body","from_stage":"primed","to_stage":"blocked","zone_pattern":"panel_*"},{"category":"body","from_stage":"blocked","to_stage":"basecoated","zone_pattern":"panel_*"},{"category":"body","from_stage":"basecoated","to_stage":"clearcoated","zone_pattern":"panel_*"}]}],"target_choice":"per_panel_panel_count_unknown","parts_terms":[]},{"id":"bumper","system":"body","pattern":"\\bbumpers?\\b","requires":"\\b(cut|dent\\w*|damag\\w*|bent|crack\\w*|rust\\w*|scratch\\w*|missing)\\b","targets":[{"type":"labor_operation","code":"TRIM-BUMPERS-FRONT"},{"type":"labor_operation","code":"TRIM-BUMPERS-REAR"}],"target_choice":"alternatives_position_unknown","parts_terms":["bumper"]},{"id":"exhaust","system":"other","pattern":"\\b(muffler|exhaust)\\b","requires":"\\b(leak\\w*|rust\\w*|loud|hole\\w*|damag\\w*|broken|rattl\\w*)\\b","targets":[{"type":"labor_operation","code":"EXH-MUFFLER-RR"}],"target_choice":"single","parts_terms":["muffler"]},{"id":"brakes","system":"brakes","pattern":"\\bbrakes?\\b","requires":"\\b(inadequate|worn|squeal\\w*|grind\\w*|pull\\w*|soft|spongy|leak\\w*|need\\w*|due|seized|rust\\w*|drums?)\\b","targets":[{"type":"labor_operation","code":"MECH-BRAKES-FRONT"},{"type":"labor_operation","code":"MECH-BRAKES-REAR"},{"type":"labor_operation","code":"MECH-BRAKES-ALL"},{"type":"stage_row","category":"chassis","from_stage":"stock","to_stage":"refreshed","zone_pattern":"*"}],"target_choice":"alternatives_scope_unknown","parts_terms":["brake"]},{"id":"parking_brake","system":"brakes","pattern":"\\b(parking brake|e-?brake|emergency brake)\\b","targets":[{"type":"labor_operation","code":"MECH-EBRAKE-REBUILD"}],"target_choice":"single","parts_terms":[]},{"id":"seat_upholstery","system":"interior","pattern":"\\b(bolster|seat (tear|torn|split|crack\\w*|wear)|torn|split seam|upholster\\w*|seat cover\\w*)\\b","exclude":"\\breupholster(ed|y)\\b","targets":[{"type":"labor_operation","code":"INT-SEATS-RR"},{"type":"stage_row","category":"interior","from_stage":"needs_work","to_stage":"recovered","zone_pattern":"*"}],"target_choice":"alternatives_scope_unknown","parts_terms":["seat cover"]},{"id":"carpet","system":"interior","pattern":"\\bcarpet\\w*\\b","requires":"\\b(worn|stain\\w*|torn|faded|wear|damag\\w*)\\b","targets":[{"type":"labor_operation","code":"INT-CARPET-RR"}],"target_choice":"single","parts_terms":["carpet"]},{"id":"headliner","system":"interior","pattern":"\\bheadliner\\b","requires":"\\b(sag\\w*|torn|stain\\w*|droop\\w*|damag\\w*)\\b","targets":[{"type":"labor_operation","code":"INT-HEADLINER-RR"}],"target_choice":"single","parts_terms":["headliner"]},{"id":"dash","system":"interior","pattern":"\\b(dash|dashboard|dash pad)\\b","requires":"\\b(crack\\w*|warp\\w*|damag\\w*|split)\\b","targets":[{"type":"labor_operation","code":"INT-DASH-RR"}],"target_choice":"single","parts_terms":["dash pad"]},{"id":"windshield","system":"body","pattern":"\\bwindshield\\b","requires":"\\b(crack\\w*|chip\\w*|pit\\w*|delaminat\\w*)\\b","targets":[{"type":"labor_operation","code":"GLASS-WINDSHIELD"}],"target_choice":"single","parts_terms":["windshield"]},{"id":"cooling","system":"cooling","pattern":"\\b(radiator|overheat\\w*|coolant leak\\w*)\\b","requires":"\\b(leak\\w*|overheat\\w*|clog\\w*|damag\\w*|need\\w*)\\b","targets":[{"type":"labor_operation","code":"MECH-RADIATOR-RR"}],"target_choice":"single","parts_terms":["radiator"]},{"id":"gauges","system":"electrical","pattern":"\\b(gauges?|instrument cluster|speedometer|odometer)\\b","requires":"\\b(non-?functional|inoperative|not working|doesn['’]t work|broken|intermittent)\\b","targets":[{"type":"labor_operation","code":"ELEC-GAUGES"}],"target_choice":"single","parts_terms":["gauge"]},{"id":"wiring_repair","system":"electrical","pattern":"\\b(wiring|electrical (issue|gremlin|fault)\\w*)\\b","requires":"\\b(issue\\w*|fault\\w*|gremlin\\w*|damag\\w*|need\\w*|intermittent|non-?functional|inoperative)\\b","targets":[{"type":"stage_row","category":"electrical","from_stage":"partial","to_stage":"complete","zone_pattern":"*"}],"target_choice":"single","parts_terms":[]},{"id":"transmission","system":"drivetrain","pattern":"\\b(transmission|gearbox)\\b","requires":"\\b(slip\\w*|leak\\w*|grind\\w*|hard shift\\w*|need\\w*|rebuild)\\b","targets":[{"type":"stage_row","category":"powertrain","from_stage":"needs_work","to_stage":"trans_rebuilt","zone_pattern":"*"}],"target_choice":"single","parts_terms":[]},{"id":"tailshaft_seal","system":"drivetrain","pattern":"\\b(tail ?shaft|rear main) seal\\b","targets":[{"type":"labor_operation","code":"TRANS-TAILSHAFT-SEAL"}],"target_choice":"single","parts_terms":[]},{"id":"engine_health","system":"engine_bay","pattern":"\\b(smok\\w*|misfir\\w*|knock\\w*|blow-?by|low compression|burn\\w* oil)\\b","targets":[{"type":"stage_row","category":"powertrain","from_stage":"needs_work","to_stage":"rebuilt","zone_pattern":"*"}],"target_choice":"single","parts_terms":[]},{"id":"front_suspension","system":"suspension","pattern":"\\b(ball joints?|tie rods?|front end|steering play|wander\\w*|bushings?)\\b","requires":"\\b(worn|loose|play|need\\w*|wander\\w*|crack\\w*)\\b","targets":[{"type":"labor_operation","code":"MECH-SUSPENSION-FRONT"}],"target_choice":"single","parts_terms":["ball joint"]},{"id":"lights","system":"electrical","pattern":"\\b(headlights?|taillights?|tail lights?)\\b","requires":"\\b(crack\\w*|broken|inoperative|non-?functional|haz\\w*|out)\\b","targets":[{"type":"labor_operation","code":"ELEC-HEADLIGHTS"},{"type":"labor_operation","code":"ELEC-TAILLIGHTS"}],"target_choice":"alternatives_position_unknown","parts_terms":["headlight","taillight"]},{"id":"trim_exterior","system":"body","pattern":"\\b(grille|mirrors?|moldings?|mouldings?)\\b","requires":"\\b(crack\\w*|broken|missing|damag\\w*|pitt\\w*|dent\\w*)\\b","targets":[{"type":"labor_operation","code":"TRIM-GRILLE"},{"type":"labor_operation","code":"TRIM-MIRRORS"},{"type":"labor_operation","code":"TRIM-MOLDINGS-SIDE"}],"target_choice":"alternatives_part_unknown","parts_terms":["grille","molding"]}]}$json$::jsonb $kw$;

CREATE FUNCTION public.listing_plan_re(p_js text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT replace(p_js, '\b', '\y')
$$;

-- buying-evidence-plan.mjs liters(): text or number to liters, one decimal; ci x 0.0163871.
CREATE FUNCTION public.listing_plan_liters(p_raw text) RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE m text[]; n numeric;
BEGIN
  IF p_raw IS NULL OR p_raw = '' THEN RETURN NULL; END IF;
  m := regexp_match(p_raw, '(\d+(?:\.\d+)?)\s*-?\s*(?:l|liter|litre)s?\y', 'i');
  IF m IS NOT NULL THEN RETURN round(m[1]::numeric, 1); END IF;
  m := regexp_match(p_raw, '(\d{3})\s*-?\s*(?:ci|cid|cubic)', 'i');
  IF m IS NOT NULL THEN RETURN round(m[1]::numeric * 0.0163871, 1); END IF;
  m := regexp_match(btrim(p_raw), '^(\d+(?:\.\d+)?)$');
  IF m IS NULL THEN RETURN NULL; END IF;
  n := m[1]::numeric;
  IF n > 0 AND n <= 10 THEN RETURN round(n, 1); END IF;
  IF n >= 60 AND n < 1000 THEN RETURN round(n * 0.0163871, 1); END IF;
  IF n >= 1000 AND n < 10000 THEN RETURN round(n / 100) / 10; END IF;
  RETURN NULL;
END $$;

-- The script's sentence pieces: [\s\S]+?(?:[.!?]+(?=\s|$)|\n|$), with code-point offsets.
CREATE FUNCTION public.listing_plan_sentences(p_text text)
RETURNS TABLE(ord integer, quote text, start_cp integer, end_cp integer) LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE len integer := char_length(COALESCE(p_text, '')); s integer := 1; p integer; k integer; e integer; n integer := 0; ch text;
BEGIN
  WHILE s <= len LOOP
    p := s + 1; e := NULL;
    WHILE e IS NULL LOOP
      IF p > len THEN e := len + 1; EXIT; END IF;
      ch := substr(p_text, p, 1);
      IF ch IN ('.', '!', '?') THEN
        k := p;
        WHILE k <= len AND substr(p_text, k, 1) IN ('.', '!', '?') LOOP k := k + 1; END LOOP;
        IF k > len OR substr(p_text, k, 1) ~ '\s' THEN e := k; EXIT; END IF;
      ELSIF ch = E'\n' THEN e := p + 1; EXIT;
      END IF;
      p := p + 1;
    END LOOP;
    n := n + 1;
    ord := n; quote := substr(p_text, s, e - s); start_cp := s - 1; end_cp := e - 1;
    RETURN NEXT;
    s := e;
  END LOOP;
END $$;

-- The script's field normalizers (plus the three listing-text value forms).
CREATE FUNCTION public.listing_plan_normalize(p_field text, p_raw text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE s text := p_raw; n numeric;
BEGIN
  IF s IS NULL THEN RETURN NULL; END IF;
  CASE p_field
    WHEN 'year' THEN
      IF btrim(s) ~ '^\d+(\.0+)?$' THEN n := btrim(s)::numeric; IF n = trunc(n) AND n > 1885 AND n < 2101 THEN RETURN to_jsonb(n::int); END IF; END IF;
      RETURN NULL;
    WHEN 'make' THEN RETURN CASE WHEN btrim(s) <> '' THEN to_jsonb(lower(btrim(s))) END;
    WHEN 'model' THEN RETURN to_jsonb(NULLIF(btrim(regexp_replace(lower(s), '[^a-z0-9]+', ' ', 'g')), ''));
    WHEN 'vin' THEN RETURN CASE WHEN btrim(s) ~* '^[A-HJ-NPR-Z0-9]{11,17}$' THEN to_jsonb(upper(btrim(s))) END;
    WHEN 'engine_displacement_l' THEN RETURN to_jsonb(public.listing_plan_liters(s));
    WHEN 'transmission' THEN RETURN CASE WHEN s ~* 'manual|stick' THEN '"manual"'::jsonb WHEN s ~* 'auto' THEN '"automatic"'::jsonb END;
    WHEN 'drivetrain' THEN RETURN CASE WHEN s ~* '4x4|4×4|4wd|four[- ]wheel|4-wheel' THEN '"4wd"'::jsonb WHEN s ~* 'awd|all[- ]wheel' THEN '"awd"'::jsonb
      WHEN s ~* 'fwd|front[- ]wheel' THEN '"fwd"'::jsonb WHEN s ~* 'rwd|2wd|rear[- ]wheel|4x2' THEN '"2wd_rwd"'::jsonb END;
    WHEN 'induction' THEN RETURN CASE WHEN s ~* 'inject|\yefi\y|\ytbi\y' THEN '"fuel_injected"'::jsonb WHEN s ~* 'carb|barrel|quadrajet' THEN '"carbureted"'::jsonb END;
    WHEN 'series_token' THEN RETURN to_jsonb(lower(s));
    WHEN 'vin17' THEN RETURN CASE WHEN s ~ '\d' AND s ~* '[A-Z]' THEN to_jsonb(upper(s)) END;
    WHEN 'vin_upper' THEN RETURN to_jsonb(upper(s));
    ELSE RETURN NULL;
  END CASE;
END $$;

-- Listing-text values: every match with its verbatim sentence excerpt (the script's textValues).
CREATE FUNCTION public.listing_plan_text_values(p_text text, p_pattern text, p_normalizer text, p_family text) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public AS $$
DECLARE out jsonb := '[]'::jsonb; n integer; i integer; pos integer; whole text; g1 text; nv jsonb; se record;
BEGIN
  IF p_text IS NULL THEN RETURN out; END IF;
  n := regexp_count(p_text, p_pattern, 1, 'i');
  FOR i IN 1..n LOOP
    pos := regexp_instr(p_text, p_pattern, 1, i, 0, 'i');
    whole := regexp_substr(p_text, p_pattern, 1, i, 'i');
    g1 := regexp_substr(p_text, p_pattern, 1, i, 'i', 1);
    nv := public.listing_plan_normalize(p_normalizer, COALESCE(g1, whole));
    IF nv IS NULL OR nv = 'null'::jsonb THEN CONTINUE; END IF;
    SELECT * INTO se FROM public.listing_plan_sentences(p_text) x WHERE x.start_cp <= pos - 1 AND pos - 1 < x.end_cp LIMIT 1;
    out := out || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('source', 'listing_text', 'field_path', 'vehicles.description',
      'raw', whole, 'value', nv, 'series_family', p_family)) || jsonb_build_object('excerpt',
      CASE WHEN se.quote IS NULL THEN NULL ELSE jsonb_build_object('quote', se.quote, 'start', se.start_cp, 'end', se.end_cp, 'offset_unit', 'unicode_code_points') END));
  END LOOP;
  RETURN out;
END $$;

-- The script's fieldStatus / modelStatus.
CREATE FUNCTION public.listing_plan_field_status(p_field text, p_values jsonb, p_record_token text) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE status text; d jsonb := '[]'::jsonb; x jsonb; a text; b text; sa text[]; la text[]; t text; rel text; i integer; j integer; ok boolean;
BEGIN
  IF jsonb_array_length(COALESCE(p_values, '[]'::jsonb)) = 0 THEN RETURN 'no_source'; END IF;
  IF p_field = 'model' THEN
    IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_values) e WHERE e->>'source' = 'listing_text' AND e->>'value' IS DISTINCT FROM p_record_token) THEN RETURN 'conflict'; END IF;
    status := CASE WHEN (SELECT count(DISTINCT e->>'source') FROM jsonb_array_elements(p_values) e) > 1 THEN 'agree' ELSE 'single_source' END;
    SELECT COALESCE(jsonb_agg(val ORDER BY o), '[]'::jsonb) INTO d FROM (SELECT e->>'value' val, min(o) o FROM jsonb_array_elements(p_values) WITH ORDINALITY y(e, o)
      WHERE e->>'source' <> 'listing_text' GROUP BY 1) z;
    FOR i IN 0..jsonb_array_length(d) - 1 LOOP
      FOR j IN i + 1..jsonb_array_length(d) - 1 LOOP
        a := d->>i; b := d->>j;
        IF a = b THEN CONTINUE; END IF;
        IF array_length(string_to_array(a, ' '), 1) <= array_length(string_to_array(b, ' '), 1) THEN sa := string_to_array(a, ' '); la := string_to_array(b, ' ');
        ELSE sa := string_to_array(b, ' '); la := string_to_array(a, ' '); END IF;
        ok := true;
        FOREACH t IN ARRAY sa LOOP
          IF NOT EXISTS (SELECT 1 FROM unnest(la) l WHERE l = t OR starts_with(l, t) OR starts_with(t, l)) THEN ok := false; END IF;
        END LOOP;
        IF NOT ok THEN RETURN 'conflict'; END IF;
        status := 'unresolved_specificity';
      END LOOP;
    END LOOP;
    RETURN status;
  END IF;
  FOR x IN SELECT e->'value' FROM jsonb_array_elements(p_values) e LOOP
    IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(d) y WHERE CASE WHEN p_field = 'engine_displacement_l'
        THEN abs((y#>>'{}')::numeric - (x#>>'{}')::numeric) <= 0.1 ELSE y = x END) THEN d := d || jsonb_build_array(x); END IF;
  END LOOP;
  IF jsonb_array_length(d) > 1 THEN RETURN 'conflict'; END IF;
  RETURN CASE WHEN (SELECT count(DISTINCT e->>'source') FROM jsonb_array_elements(p_values) e) > 1 THEN 'agree' ELSE 'single_source' END;
END $$;

-- Claim id and de-duplication as the script: first 16 hex of sha256(ref \n path \n text).
CREATE FUNCTION public.listing_plan_push(p_claims jsonb, p_claim jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE cid text := left(encode(sha256(convert_to((p_claim#>>'{source,ref}') || E'\n' || (p_claim#>>'{source,path}') || E'\n' || (p_claim->>'text'), 'UTF8')), 'hex'), 16);
BEGIN
  IF EXISTS (SELECT 1 FROM jsonb_array_elements(p_claims) c WHERE c->>'claim_id' = cid) THEN RETURN p_claims; END IF;
  RETURN p_claims || jsonb_build_array(jsonb_build_object('claim_id', cid) || p_claim);
END $$;

CREATE FUNCTION public.listing_plan_review_flags(p_quote text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT to_jsonb(array_remove(ARRAY[
    CASE WHEN position('?' IN p_quote) > 0 THEN 'question_present' END,
    CASE WHEN p_quote ~* '\y(?:if|would|could|should|might|assuming)\y' THEN 'conditional_or_uncertain_language' END,
    CASE WHEN p_quote ~* '\y(?:no|not|never|without|unknown|unsure|don[''’]t)\y' THEN 'negation_or_unknown_language' END,
    CASE WHEN p_quote ~* '\y(?:these|those|all\s+of|million[- ]mile|run\s+forever|my\s+other)\y' THEN 'subject_scope_needs_review' END], NULL))
$$;

-- buying-evidence.mjs FACETS (search vocabulary), in its order.
CREATE FUNCTION public.listing_plan_facets(p_quote text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT COALESCE(jsonb_agg(name ORDER BY o), '[]'::jsonb) FROM (VALUES
    (1, 'maintenance', '\b(?:maint(?:enance|ained)?|servic\w*|receipts?|records?|oil\s+chang\w*|replac\w*|rebuil\w*|repair\w*|timing\s+(?:belt|chain)|water\s+pump|heater\s+core|brakes?|tires?|tyres?|clutch)\b'),
    (2, 'unresolved_work', '\b(?:needs?|due|overdue|inoperative|doesn[''’]t\s+work|not\s+working|bypass\w*|leak\w*|misfir\w*|overheat\w*|smok\w*|noise|vibrat\w*|check\s+engine|warning\s+light|defrost|a\/c)\b'),
    (3, 'mileage', '\b(?:odometer|mileage|miles?|kilomet(?:er|re)s?|\d+(?:[,.]\d+)?\s*k\s*(?:mi|mile|km)|tmu|actual\s+miles?|rolled\s+over)\b'),
    (4, 'usage', '\b(?:tow\w*|haul\w*|commut\w*|daily\s+driv\w*|highway|short\s+trips?|off[- ]road|idle\w*|fleet|commercial|work\s+truck|farm|plow\w*|raced?|track\s+use)\b'),
    (5, 'storage', '\b(?:stor(?:ed|age)|garage\w*|carport|sitting|sat\s+(?:for|since)|parked|covered|indoors?|outdoors?)\b'),
    (6, 'exposure', '\b(?:salt\w*|coast\w*|snow|winter|humid\w*|flood\w*|desert|climate|weather|sun\s+damage|road\s+salt|dry\s+state)\b'),
    (7, 'condition', '\b(?:rust\w*|corro\w*|rot|undercoat\w*|undercarriage|frame|wear|worn|crack\w*|dent\w*|scratch\w*|repaint\w*|paint|damage\w*|accident|collision)\b'),
    (8, 'ownership', '\b(?:own(?:er|ers|ed|ership)?|bought|purchased|acquir\w*|sold|title|previous|since\s+\d{4})\b')) f(o, name, re)
  WHERE p_quote ~* public.listing_plan_re(re)
$$;

-- The script's locate(): exact case-insensitive excerpt of a claim text in the description.
CREATE FUNCTION public.listing_plan_locate(p_descr text, p_text text) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE t text := regexp_replace(COALESCE(p_text, ''), '^\s+|\s+$', '', 'g'); idx integer;
BEGIN
  IF p_descr IS NULL OR p_text IS NULL OR char_length(t) < 8 THEN
    RETURN jsonb_build_object('verbatim_excerpt', NULL, 'excerpt_status', 'no_exact_excerpt_in_listing_text');
  END IF;
  idx := position(lower(t) IN lower(p_descr));
  IF idx = 0 THEN RETURN jsonb_build_object('verbatim_excerpt', NULL, 'excerpt_status', 'extraction_paraphrase_no_exact_excerpt'); END IF;
  RETURN jsonb_build_object('verbatim_excerpt', jsonb_build_object('quote', substr(p_descr, idx, char_length(t)), 'start', idx - 1,
    'end', idx - 1 + char_length(t), 'offset_unit', 'unicode_code_points'), 'excerpt_status', 'exact_excerpt_in_listing_text');
END $$;

-- Claims from one description_discoveries v3 extraction, in the script's order.
CREATE FUNCTION public.listing_plan_discovery_items(p_raw jsonb) RETURNS SETOF jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT item FROM (
    SELECT 1 AS g, o AS o, jsonb_build_object('path', '/raw_extraction/flags/' || (o - 1) || '/f', 'kind', 'defect_or_condition', 'text', e->>'f',
        'extra', jsonb_build_object('extraction_reported_severity', CASE WHEN jsonb_typeof(e->'sev') = 'string' THEN e->>'sev' END)) AS item
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_raw->'flags') = 'array' THEN p_raw->'flags' ELSE '[]'::jsonb END) WITH ORDINALITY x(e, o)
      WHERE jsonb_typeof(e->'f') = 'string' AND btrim(e->>'f') <> ''
    UNION ALL SELECT 2, 1, jsonb_build_object('path', '/raw_extraction/cond_note', 'kind', 'condition_summary', 'text', p_raw->>'cond_note')
      WHERE jsonb_typeof(p_raw->'cond_note') = 'string' AND btrim(p_raw->>'cond_note') <> ''
    UNION ALL SELECT 3, 1, jsonb_build_object('path', '/raw_extraction/cond', 'kind', 'condition_summary', 'text', 'condition label: ' || (p_raw->>'cond'))
      WHERE jsonb_typeof(p_raw->'cond') = 'string' AND btrim(p_raw->>'cond') <> ''
    UNION ALL SELECT 4, o, jsonb_build_object('path', '/raw_extraction/work/' || (o - 1) || '/w', 'kind', 'reported_completed_work', 'text', e->>'w',
        'extra', jsonb_build_object('reported_work_date', e->'d', 'reported_work_by', e->'s'))
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_raw->'work') = 'array' THEN p_raw->'work' ELSE '[]'::jsonb END) WITH ORDINALITY x(e, o)
      WHERE jsonb_typeof(e->'w') = 'string' AND btrim(e->>'w') <> ''
    UNION ALL SELECT 5, o, jsonb_build_object('path', '/raw_extraction/mods/' || (o - 1), 'kind', 'modification', 'text', e#>>'{}')
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_raw->'mods') = 'array' THEN p_raw->'mods' ELSE '[]'::jsonb END) WITH ORDINALITY x(e, o)
      WHERE jsonb_typeof(e) = 'string' AND btrim(e#>>'{}') <> ''
    UNION ALL SELECT 6, o, jsonb_build_object('path', '/raw_extraction/docs/' || (o - 1), 'kind', 'document_or_title', 'text', e#>>'{}')
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_raw->'docs') = 'array' THEN p_raw->'docs' ELSE '[]'::jsonb END) WITH ORDINALITY x(e, o)
      WHERE jsonb_typeof(e) = 'string' AND btrim(e#>>'{}') <> ''
    UNION ALL SELECT 7, 1, jsonb_build_object('path', '/raw_extraction/title', 'kind', 'document_or_title', 'text', 'title status: ' || (p_raw->>'title')
        || CASE WHEN jsonb_typeof(p_raw->'title_st') = 'string' THEN ' (' || (p_raw->>'title_st') || ')' ELSE '' END)
      WHERE jsonb_typeof(p_raw->'title') = 'string' AND btrim(p_raw->>'title') <> ''
    UNION ALL SELECT 8, 1, jsonb_build_object('path', '/raw_extraction/miles', 'kind', 'odometer', 'text', 'reported mileage: ' || (p_raw->>'miles') || ' '
        || CASE WHEN jsonb_typeof(p_raw->'mi_unit') = 'string' THEN p_raw->>'mi_unit' ELSE 'unit unstated' END)
      WHERE p_raw->'miles' IS NOT NULL AND p_raw->'miles' <> 'null'::jsonb) q
  ORDER BY g, o
$$;

-- Claims from one condition observation; image-derived rows mark image_derived so the caller applies attribution.
CREATE FUNCTION public.listing_plan_condition_items(p_data jsonb, p_text text, p_image_id uuid) RETURNS SETOF jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE image_derived boolean := p_image_id IS NOT NULL OR p_data->>'image_id' IS NOT NULL OR p_data->>'witness_image_id' IS NOT NULL
  OR COALESCE(p_data->>'analysis_kind', '') LIKE 'image%';
  st jsonb := COALESCE(p_data->'state_observations', '{}'::jsonb); e jsonb; o bigint; any_statement boolean := false;
BEGIN
  IF image_derived THEN
    FOR e, o IN SELECT x, n FROM jsonb_array_elements(CASE WHEN jsonb_typeof(st->'damage_callouts') = 'array' THEN st->'damage_callouts' ELSE '[]'::jsonb END) WITH ORDINALITY z(x, n) LOOP
      IF jsonb_typeof(e) = 'string' AND btrim(e#>>'{}') <> '' THEN any_statement := true;
        RETURN NEXT jsonb_build_object('image_derived', true, 'kind', 'defect_or_condition', 'path', '/structured_data/state_observations/damage_callouts/' || (o - 1), 'text', e#>>'{}'); END IF;
    END LOOP;
    FOR e, o IN SELECT x, n FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_data->'damage_localized') = 'array' THEN p_data->'damage_localized' ELSE '[]'::jsonb END) WITH ORDINALITY z(x, n) LOOP
      IF jsonb_typeof(e) = 'string' AND btrim(e#>>'{}') <> '' THEN any_statement := true;
        RETURN NEXT jsonb_build_object('image_derived', true, 'kind', 'defect_or_condition', 'path', '/structured_data/damage_localized/' || (o - 1), 'text', e#>>'{}');
      ELSIF jsonb_typeof(e->'label') = 'string' AND btrim(e->>'label') <> '' THEN any_statement := true;
        RETURN NEXT jsonb_build_object('image_derived', true, 'kind', 'defect_or_condition', 'path', '/structured_data/damage_localized/' || (o - 1), 'text', e->>'label');
      END IF;
    END LOOP;
    IF jsonb_typeof(st->'rust_severity') = 'string' AND btrim(st->>'rust_severity') <> '' AND st->>'rust_severity' !~* '^(none|unknown)$' THEN any_statement := true;
      RETURN NEXT jsonb_build_object('image_derived', true, 'kind', 'defect_or_condition', 'path', '/structured_data/state_observations/rust_severity',
        'text', 'rust severity: ' || (st->>'rust_severity'));
    END IF;
    IF NOT any_statement THEN RETURN NEXT jsonb_build_object('image_derived', true, 'kind', NULL); END IF;
    RETURN;
  END IF;
  IF p_data->'rubric' IS NOT NULL AND p_data->'rubric' NOT IN ('null'::jsonb, 'false'::jsonb, '""'::jsonb, '0'::jsonb) THEN
    IF jsonb_typeof(p_data->'paint_note') = 'string' AND btrim(p_data->>'paint_note') <> '' THEN
      RETURN NEXT jsonb_build_object('kind', 'defect_or_condition', 'path', '/structured_data/paint_note', 'text', p_data->>'paint_note'); END IF;
    FOR e, o IN SELECT x, n FROM jsonb_array_elements(CASE WHEN jsonb_typeof(p_data->'known_issues') = 'array' THEN p_data->'known_issues' ELSE '[]'::jsonb END) WITH ORDINALITY z(x, n) LOOP
      IF jsonb_typeof(e) = 'string' AND btrim(e#>>'{}') <> '' THEN
        RETURN NEXT jsonb_build_object('kind', 'defect_or_condition', 'path', '/structured_data/known_issues/' || (o - 1), 'text', e#>>'{}'); END IF;
    END LOOP;
    IF jsonb_typeof(p_data->'title_flag') = 'string' AND btrim(p_data->>'title_flag') <> '' AND p_data->>'title_flag' !~* '^(none|clean)$' THEN
      RETURN NEXT jsonb_build_object('kind', 'document_or_title', 'path', '/structured_data/title_flag', 'text', 'title flag: ' || (p_data->>'title_flag')); END IF;
    IF jsonb_typeof(p_data->'emissions_note') = 'string' AND btrim(p_data->>'emissions_note') <> '' THEN
      RETURN NEXT jsonb_build_object('kind', 'defect_or_condition', 'path', '/structured_data/emissions_note', 'text', p_data->>'emissions_note'); END IF;
  END IF;
  IF p_text IS NOT NULL AND btrim(p_text) <> '' THEN
    RETURN NEXT jsonb_build_object('kind', 'condition_summary', 'path', '/content_text', 'text', p_text);
  END IF;
END $$;

-- The script's resolveTarget over labor_operations and stage_transition_labor_map; hours stay seed_uncalibrated.
CREATE FUNCTION public.listing_plan_resolve_target(p_target jsonb, p_year integer) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE lo record; rows jsonb := '[]'::jsonb; missing jsonb := '[]'::jsonb; rw jsonb; sr record; k jsonb;
BEGIN
  IF p_target->>'type' = 'labor_operation' THEN
    SELECT * INTO lo FROM public.labor_operations WHERE code = p_target->>'code';
    IF lo.code IS NULL THEN RETURN jsonb_build_object('type', 'labor_operation', 'code', p_target->>'code', 'state', 'code_absent_from_reference'); END IF;
    RETURN jsonb_build_object('type', 'labor_operation', 'code', lo.code, 'name', lo.name, 'system', lo.system, 'state', 'resolved',
      'hours', jsonb_build_object('min', NULL, 'typical', lo.base_hours, 'max', NULL), 'range_basis', 'single_book_value_no_range',
      'materials', NULL, 'method', 'labor_operations.base_hours', 'label', 'seed_uncalibrated',
      'year_applicability', CASE WHEN lo.model_year_min IS NULL AND lo.model_year_max IS NULL THEN 'unstated' WHEN p_year IS NULL THEN 'vehicle_year_unknown'
        WHEN (lo.model_year_min IS NULL OR p_year >= lo.model_year_min) AND (lo.model_year_max IS NULL OR p_year <= lo.model_year_max) THEN 'in_range' ELSE 'out_of_range' END);
  END IF;
  FOR rw IN SELECT x FROM jsonb_array_elements(CASE WHEN p_target->>'type' = 'stage_chain' THEN p_target->'rows' ELSE jsonb_build_array(p_target) END) WITH ORDINALITY z(x, n) ORDER BY n LOOP
    k := jsonb_build_object('category', rw->>'category', 'from_stage', rw->>'from_stage', 'to_stage', rw->>'to_stage', 'zone_pattern', rw->>'zone_pattern');
    SELECT * INTO sr FROM public.stage_transition_labor_map m WHERE m.category = rw->>'category' AND m.from_stage = rw->>'from_stage'
      AND m.to_stage = rw->>'to_stage' AND m.zone_pattern = rw->>'zone_pattern' ORDER BY m.id LIMIT 1;
    IF sr.id IS NULL THEN missing := missing || jsonb_build_array(k);
    ELSE rows := rows || jsonb_build_array(jsonb_build_object('key', k, 'stage_map_id', sr.id, 'description', sr.description,
      'hours', jsonb_build_object('min', sr.estimated_hours_min, 'typical', sr.estimated_hours_typical, 'max', sr.estimated_hours_max),
      'materials', jsonb_build_object('min', sr.materials_cost_min, 'max', sr.materials_cost_max, 'currency', 'unstated_in_reference'),
      'author_declared_confidence', sr.confidence)); END IF;
    sr := NULL;
  END LOOP;
  IF p_target->>'type' = 'stage_row' THEN
    IF jsonb_array_length(rows) = 0 THEN RETURN jsonb_build_object('type', 'stage_row', 'key', missing->0, 'state', 'row_absent_from_reference'); END IF;
    RETURN jsonb_build_object('type', 'stage_row', 'state', 'resolved', 'range_basis', 'author_declared_min_typical_max',
      'method', 'stage_transition_labor_map', 'label', 'seed_uncalibrated') || (rows->0);
  END IF;
  IF jsonb_array_length(missing) > 0 THEN RETURN jsonb_build_object('type', 'stage_chain', 'state', 'incomplete_chain', 'missing', missing); END IF;
  RETURN jsonb_build_object('type', 'stage_chain', 'state', 'resolved', 'rows', rows,
    'hours', jsonb_build_object('min', (SELECT round(sum((r#>>'{hours,min}')::numeric), 2) FROM jsonb_array_elements(rows) r),
      'typical', (SELECT round(sum((r#>>'{hours,typical}')::numeric), 2) FROM jsonb_array_elements(rows) r),
      'max', (SELECT round(sum((r#>>'{hours,max}')::numeric), 2) FROM jsonb_array_elements(rows) r)),
    'materials', jsonb_build_object('min', (SELECT round(sum((r#>>'{materials,min}')::numeric), 2) FROM jsonb_array_elements(rows) r),
      'max', (SELECT round(sum((r#>>'{materials,max}')::numeric), 2) FROM jsonb_array_elements(rows) r), 'currency', 'unstated_in_reference'),
    'range_basis', 'sum_of_author_declared_rows', 'method', 'sum_of_stage_transition_labor_map_rows', 'label', 'seed_uncalibrated');
END $$;

CREATE FUNCTION public.listing_plan_empty_finding(p_system text) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT jsonb_build_object('inspection_type', 'pre_purchase', 'system', p_system, 'verdict', NULL, 'finding', NULL, 'severity', NULL,
    'evidence_photo_ref', NULL, 'inspector_actor_id', NULL, 'observed_at', NULL)
$$;

CREATE FUNCTION public.listing_plan_question(p_kind text, p_text text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE p_kind
    WHEN 'listing_statement' THEN 'Review this listing statement and inspect what it describes: '
    WHEN 'defect_or_condition' THEN 'Inspect and record whether this holds: '
    WHEN 'condition_summary' THEN 'Assess the stated condition summary against the vehicle: '
    WHEN 'reported_completed_work' THEN 'Verify the reported work (parts present, receipts, workmanship): '
    WHEN 'modification' THEN 'Verify the modification is present and record its installation quality: '
    WHEN 'document_or_title' THEN 'Sight the document or record and note what it shows: '
    WHEN 'odometer' THEN 'Record the odometer reading and check supporting documentation: '
    ELSE 'Inspect: ' END || p_text
$$;

CREATE FUNCTION public.listing_work_plan_read(p_vehicle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = pg_catalog, public SET TimeZone = 'UTC' AS $$
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
END $$;

DO $$
DECLARE f text;
BEGIN
  FOREACH f IN ARRAY ARRAY['listing_plan_keyword_table()','listing_plan_re(text)','listing_plan_liters(text)','listing_plan_sentences(text)',
      'listing_plan_normalize(text,text)','listing_plan_text_values(text,text,text,text)','listing_plan_field_status(text,jsonb,text)',
      'listing_plan_push(jsonb,jsonb)','listing_plan_review_flags(text)','listing_plan_facets(text)','listing_plan_locate(text,text)',
      'listing_plan_discovery_items(jsonb)','listing_plan_condition_items(jsonb,text,uuid)','listing_plan_resolve_target(jsonb,integer)',
      'listing_plan_empty_finding(text)','listing_plan_question(text,text)'] LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION public.%s FROM PUBLIC, anon, authenticated', f);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO service_role', f);
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION public.listing_work_plan_read(uuid) FROM PUBLIC, service_role;
GRANT EXECUTE ON FUNCTION public.listing_work_plan_read(uuid) TO anon, authenticated;
COMMENT ON FUNCTION public.listing_work_plan_read(uuid) IS 'Open listing inspection plan (port of buying-evidence.mjs --plan): identity conflicts first, attributed claims with exclusions counted, keyword-table candidate operations with seed_uncalibrated hours, the resolve_labor_rate() value as returned, unverified priced text-fitment parts and a pre_purchase checklist shaped for request_inspection. No PII, no writes.';
NOTIFY pgrst, 'reload schema';
COMMIT;
