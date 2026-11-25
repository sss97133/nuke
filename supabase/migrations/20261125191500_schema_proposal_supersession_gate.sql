-- schema_proposal_supersession_gate_v1: gate A's extension to one shape of modify_property, ratified by measure.
--
-- WHY. Lead ruling 2026-11-25: a ruling is not a ratification, so a key whose allowed values move from prose to a key
-- table (labor_system_key: 'Allowed values: engine, ... unplaced' -> receipt_line_systems.system_key) admits nothing
-- until its superseding proposal is ratified. Gate A (schema_proposal_key_gate_v1) ratifies add_property only.
-- Extend it "for exactly one shape: a description-only supersession whose new text names a key table and removes an
-- enumerated value list". Anything else stays unratifiable by rule.
--
-- WHAT IT MEASURES (one proposal per call; every check stored in gate_measure; all or nothing, no person):
--   SHAPE      status open; proposal_type modify_property; an agent proposer and no user proposer; payload field =
--              'description'; payload keys only property_key, field, values_from, stored_in, null_reasons_from,
--              qualifier_of (required, non-empty), dropped_values, description (so no data_type, namespace, label,
--              cardinality, unit, scope or adds_values).
--   SUPERSEDES the property's ratifying proposal (observation_properties.proposed_by_proposal_id), status approved;
--              no other approved supersession of it; payload property_key = that property's key.
--   TEXT       the superseded text holds an 'Allowed values:' list (parsed: the first word of each comma item to the
--              sentence end, parentheses removed) and the new text holds none in any wording (allowed value(s)); the new
--              text names the values_from table.
--   KEY TABLE  values_from = '<table>.<column>' in public, the column alone is the table's primary key or a unique key.
--   FK         stored_in = '<table>.<column>' in public with a validated foreign key (pg_constraint, contype f,
--              convalidated) from exactly that column to exactly the values_from column: the property's storing column.
--   NO ORPHANS every value stored for the property resolves to a key row or is NULL with a reason row: (a) stored_in
--              rows of this property (when the table has property_key): NULL or no key row counts as orphan;
--              (b) observations whose property is in qualifier_of (is_superseded not true) carrying the key in
--              structured_data: the value is a key row, or it is absent and <key>_null_reason is a null_reasons_from row
--              of this key; (c) no current observation of any other property carries the key or its null reason.
--   VALUE SET  values_added (key rows the old list lacked) and values_dropped (old-list values the key table lacks) are
--              stored; each dropped value names its reason in payload dropped_values {value: reason}, a null_reasons_from
--              row of this key, and dropped_values names nothing that was kept.
--   (ta-skeptic2's attack 2026-11-25 01:44 PT added qualifier_of required, convalidated, the key-row orphan test, the
--   list in any wording, (c), IS NOT TRUE, the value set and the lock on the superseded proposal.)
--   UNCHANGED  the property's row other than description (type, namespace, key, label, cardinality, unit, kinds,
--              categories, proposed_by_proposal_id) hashes the same before and after; no other registry row moves.
-- On pass: the successor is approved (resolved_at, gate_measure, decision_rationale); the superseded proposal is
-- status superseded with superseded_by = the successor; observation_properties.description = the new text. The
-- registry row keeps proposed_by_proposal_id (the proposal that created the key). On refusal: statuses unchanged,
-- gate_measure holds the reasons.
-- Test: supabase/sql/test_schema_proposal_supersession_gate.sql (PG17, chained after the gate A test).
--
-- REVERT. DROP FUNCTION public.schema_proposal_supersession_gate(uuid). Ratifications it made stay (supersede them
-- by proposal).
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.schema_proposal_supersession_gate(p_proposal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $fn$
DECLARE
  pr public.schema_proposals%ROWTYPE;
  orig public.schema_proposals%ROWTYPE;
  prop public.observation_properties%ROWTYPE;
  reasons text[] := '{}';
  k text;
  vt text; vc text; st text; sc text; nt text;
  v_rel regclass; s_rel regclass; n_rel regclass;
  quals text[];
  null_clause text := 'false';
  qual_ids uuid[];
  n_stored bigint := 0; n_stored_orphan bigint := 0;
  n_obs bigint := 0; n_obs_orphan bigint := 0; n_obs_outside bigint := 0;
  old_values text[] := '{}'; values_added text[] := '{}'; values_dropped text[] := '{}'; n_added bigint := 0;
  tok text;
  has_reason boolean;
  quals_missing boolean;
  hash_before text; hash_after text; others_before text; others_after text;
  measure jsonb;
  decision text;
  stamp timestamptz := now();
BEGIN
  SELECT * INTO pr FROM public.schema_proposals WHERE id = p_proposal_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'schema_proposal_supersession_gate: unknown proposal id'; END IF;

  -- SHAPE
  IF pr.status <> 'open' THEN reasons := reasons || ('status_' || pr.status); END IF;
  IF pr.proposal_type <> 'modify_property' THEN reasons := reasons || 'not_modify_property'::text; END IF;
  IF pr.proposed_by_user_id IS NOT NULL OR pr.proposed_by_agent_key IS NULL THEN
    reasons := reasons || 'not_an_agent_proposal'::text;
  END IF;
  IF jsonb_typeof(pr.payload) <> 'object' THEN
    reasons := reasons || 'payload_not_object'::text;
  ELSE
    IF coalesce(pr.payload ->> 'field', '') <> 'description' THEN reasons := reasons || 'not_description_only'::text; END IF;
    FOR k IN SELECT jsonb_object_keys(pr.payload) LOOP
      IF k NOT IN ('property_key', 'field', 'values_from', 'stored_in', 'null_reasons_from', 'qualifier_of', 'dropped_values',
                   'description') THEN
        reasons := reasons || ('payload_key_not_allowed:' || k);
      END IF;
    END LOOP;
  END IF;

  -- SUPERSEDES
  SELECT * INTO prop FROM public.observation_properties WHERE property_key = pr.payload ->> 'property_key';
  IF NOT FOUND THEN
    reasons := reasons || 'property_unknown'::text;
  ELSE
    IF pr.supersedes_proposal_id IS DISTINCT FROM prop.proposed_by_proposal_id OR pr.supersedes_proposal_id IS NULL THEN
      reasons := reasons || 'supersedes_not_the_ratifying_proposal'::text;
    END IF;
    -- locked, so two successors of one text cannot both pass already_superseded (ta-skeptic2 should-fix c)
    SELECT * INTO orig FROM public.schema_proposals WHERE id = prop.proposed_by_proposal_id FOR UPDATE;
    IF orig.id IS NULL OR orig.status <> 'approved' THEN reasons := reasons || 'superseded_not_approved'::text; END IF;
    IF EXISTS (SELECT 1 FROM public.schema_proposals s WHERE s.supersedes_proposal_id = prop.proposed_by_proposal_id
                AND s.status = 'approved' AND s.id <> pr.id) THEN
      reasons := reasons || 'already_superseded'::text;
    END IF;
    -- TEXT
    IF coalesce(prop.description, '') !~* 'allowed values:' THEN
      reasons := reasons || 'superseded_text_has_no_value_list'::text;
    ELSE
      -- the old list: after 'Allowed values:' to the sentence end, parentheses removed, the first word of each comma item
      SELECT coalesce(array_agg(DISTINCT w), '{}') INTO old_values
        FROM regexp_split_to_table(regexp_replace(regexp_replace(substr(prop.description,
                                 position('allowed values:' IN lower(prop.description)) + 15), '\..*$', '', 's'),
                                                  '\([^)]*\)', '', 'g'), ',') item,
             LATERAL (SELECT substring(regexp_replace(btrim(item), '^(and|or)\s+', '', 'i') FROM '^([a-z][a-z0-9_]*)\M') AS w) x
       WHERE w IS NOT NULL;
    END IF;
  END IF;
  IF coalesce(pr.payload ->> 'description', '') = '' THEN
    reasons := reasons || 'description_missing'::text;
  ELSIF pr.payload ->> 'description' ~* '\mallowed\s+values?\M' THEN  -- any form, not only the colon (ta-skeptic2 must-fix 3)
    reasons := reasons || 'description_holds_value_list'::text;
  END IF;

  -- KEY TABLE
  IF coalesce(pr.payload ->> 'values_from', '') !~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$' THEN
    reasons := reasons || 'values_from_shape'::text;
  ELSE
    vt := split_part(pr.payload ->> 'values_from', '.', 1);
    vc := split_part(pr.payload ->> 'values_from', '.', 2);
    v_rel := to_regclass(format('public.%I', vt));
    IF v_rel IS NULL THEN
      reasons := reasons || 'values_from_table_missing'::text;
    ELSIF NOT EXISTS (SELECT 1 FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
                       WHERE c.conrelid = v_rel AND c.contype IN ('p', 'u') AND cardinality(c.conkey) = 1 AND a.attname = vc) THEN
      reasons := reasons || 'values_from_not_a_key'::text;
    ELSIF coalesce(pr.payload ->> 'description', '') !~ ('\m' || vt || '\M') THEN
      reasons := reasons || 'description_does_not_name_table'::text;
    END IF;
  END IF;

  -- FK from the storing column
  IF coalesce(pr.payload ->> 'stored_in', '') !~ '^[a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*$' THEN
    reasons := reasons || 'stored_in_shape'::text;
  ELSE
    st := split_part(pr.payload ->> 'stored_in', '.', 1);
    sc := split_part(pr.payload ->> 'stored_in', '.', 2);
    s_rel := to_regclass(format('public.%I', st));
    IF s_rel IS NULL THEN
      reasons := reasons || 'stored_in_table_missing'::text;
    ELSIF v_rel IS NULL OR NOT EXISTS (
        SELECT 1 FROM pg_constraint c
          JOIN pg_attribute sa ON sa.attrelid = c.conrelid AND sa.attnum = c.conkey[1]
          JOIN pg_attribute va ON va.attrelid = c.confrelid AND va.attnum = c.confkey[1]
         WHERE c.contype = 'f' AND c.convalidated AND c.conrelid = s_rel AND c.confrelid = v_rel
           AND cardinality(c.conkey) = 1 AND sa.attname = sc AND va.attname = vc) THEN
      reasons := reasons || 'stored_in_no_foreign_key'::text;
    END IF;
  END IF;

  IF pr.payload ? 'null_reasons_from' THEN
    nt := pr.payload ->> 'null_reasons_from';
    n_rel := CASE WHEN nt ~ '^[a-z_][a-z0-9_]*$' THEN to_regclass(format('public.%I', nt)) END;
    IF n_rel IS NULL OR (SELECT count(*) FROM pg_attribute WHERE attrelid = n_rel AND attname IN ('property_key', 'reason')
                          AND NOT attisdropped) <> 2 THEN
      reasons := reasons || 'null_reasons_from_invalid'::text;
      n_rel := NULL;
    END IF;
  END IF;
  -- required and non-empty: the proposer does not choose whether the observation scan runs (ta-skeptic2 must-fix 1)
  quals_missing := CASE WHEN jsonb_typeof(pr.payload -> 'qualifier_of') = 'array'
                        THEN jsonb_array_length(pr.payload -> 'qualifier_of') = 0 ELSE true END;
  IF quals_missing THEN
    reasons := reasons || 'qualifier_of_missing'::text;
  ELSE
    SELECT array_agg(x) INTO quals FROM jsonb_array_elements_text(pr.payload -> 'qualifier_of') x;
    SELECT array_agg(o.id) INTO qual_ids FROM public.observation_properties o WHERE o.property_key = ANY (quals);
    IF coalesce(cardinality(qual_ids), 0) <> coalesce(cardinality(quals), 0) THEN
      reasons := reasons || 'qualifier_of_unknown'::text;
    END IF;
  END IF;

  -- NO ORPHANS (only when the tables and the FK are sound)
  IF prop.id IS NOT NULL AND NOT (reasons && ARRAY['values_from_shape', 'values_from_table_missing', 'values_from_not_a_key',
                                                  'stored_in_shape', 'stored_in_table_missing', 'stored_in_no_foreign_key']) THEN
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = s_rel AND attname = 'property_key' AND NOT attisdropped) THEN
      -- NULL, or a value with no key row (a NOT VALID or later-dropped key would let one in: ta-skeptic2 must-fix 2)
      EXECUTE format('SELECT count(*), count(*) FILTER (WHERE s.%1$I IS NULL OR NOT EXISTS (SELECT 1 FROM public.%3$I t '
                     'WHERE t.%4$I = s.%1$I)) FROM public.%2$I s WHERE s.property_key = $1', sc, st, vt, vc)
         INTO n_stored, n_stored_orphan USING prop.property_key;
    END IF;
    IF qual_ids IS NOT NULL THEN
      IF n_rel IS NOT NULL THEN
        null_clause := format('(o.structured_data ->> $1 IS NULL AND EXISTS (SELECT 1 FROM public.%I r WHERE r.property_key = $1 '
                              'AND r.reason = o.structured_data ->> ($1 || ''_null_reason'')))', nt);
      END IF;
      EXECUTE format(
        'SELECT count(*), count(*) FILTER (WHERE NOT (
             (o.structured_data ->> $1 IS NOT NULL AND EXISTS (SELECT 1 FROM public.%I t WHERE t.%I::text = o.structured_data ->> $1))
          OR %s))
           FROM public.vehicle_observations o
          WHERE o.property_id = ANY ($2) AND o.is_superseded IS NOT TRUE
            AND (o.structured_data ? $1 OR o.structured_data ? ($1 || ''_null_reason''))',
        vt, vc, null_clause)
        INTO n_obs, n_obs_orphan USING prop.property_key, qual_ids;
    END IF;
    IF n_stored_orphan > 0 OR n_obs_orphan > 0 THEN reasons := reasons || 'stored_values_orphaned'::text; END IF;
    -- the key carried by observations of any other property: none allowed (GIN on structured_data; 150 ms on
    -- production for labor_system_key, 2026-11-25, EXPLAIN ANALYZE)
    SELECT count(*) INTO n_obs_outside FROM public.vehicle_observations o
     WHERE (o.structured_data ? prop.property_key OR o.structured_data ? (prop.property_key || '_null_reason'))
       AND o.is_superseded IS NOT TRUE AND (o.property_id IS NULL OR o.property_id <> ALL (coalesce(qual_ids, '{}')));
    IF n_obs_outside > 0 THEN reasons := reasons || 'key_carried_outside_qualifier_of'::text; END IF;
    -- the value set adopted: key rows the old list lacked, and old-list values the key table lacks; each dropped value
    -- names its null reason (payload dropped_values {value: reason}), a reason row of this key (should-fix b)
    EXECUTE format('SELECT count(*), coalesce((array_agg(t.%1$I::text ORDER BY t.%1$I::text))[1:200], ''{}'') FROM public.%2$I t '
                   'WHERE t.%1$I::text <> ALL ($1)', vc, vt) INTO n_added, values_added USING old_values;
    EXECUTE format('SELECT coalesce(array_agg(v ORDER BY v), ''{}'') FROM unnest($1) v '
                   'WHERE NOT EXISTS (SELECT 1 FROM public.%I t WHERE t.%I::text = v)', vt, vc) INTO values_dropped USING old_values;
    IF jsonb_typeof(coalesce(pr.payload -> 'dropped_values', '{}'::jsonb)) <> 'object' THEN
      reasons := reasons || 'dropped_values_invalid'::text;
    ELSE
      FOREACH tok IN ARRAY values_dropped LOOP
        has_reason := false;
        IF n_rel IS NOT NULL AND pr.payload -> 'dropped_values' ->> tok IS NOT NULL THEN
          EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I r WHERE r.property_key = $1 AND r.reason = $2)', nt)
             INTO has_reason USING prop.property_key, pr.payload -> 'dropped_values' ->> tok;
        END IF;
        IF NOT has_reason THEN reasons := reasons || ('value_dropped_without_reason:' || tok); END IF;
      END LOOP;
      IF EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(pr.payload -> 'dropped_values', '{}'::jsonb)) d WHERE d <> ALL (values_dropped)) THEN
        reasons := reasons || 'dropped_values_not_dropped'::text;
      END IF;
    END IF;
  END IF;

  decision := CASE WHEN cardinality(reasons) = 0 THEN 'ratified' ELSE 'refused' END;
  measure := jsonb_build_object(
    'basis', 'schema_proposal_supersession_gate_v1', 'measured_at', stamp, 'decision', decision,
    'property_key', prop.property_key, 'supersedes', prop.proposed_by_proposal_id,
    'values_from', pr.payload ->> 'values_from', 'stored_in', pr.payload ->> 'stored_in',
    'stored_rows', n_stored, 'stored_rows_orphaned', n_stored_orphan,
    'observations', n_obs, 'observations_orphaned', n_obs_orphan, 'observations_outside_qualifier_of', n_obs_outside,
    'old_values', to_jsonb(old_values), 'values_added', to_jsonb(values_added), 'values_added_count', n_added,
    'values_dropped', to_jsonb(values_dropped), 'dropped_values', pr.payload -> 'dropped_values',
    'reasons', to_jsonb(ARRAY(SELECT DISTINCT r FROM unnest(reasons) r ORDER BY r)));

  PERFORM set_config('nuke.schema_proposal_key_gate', 'on', true);
  IF decision = 'ratified' THEN
    SELECT md5((to_jsonb(p) - 'description')::text) INTO hash_before FROM public.observation_properties p WHERE p.id = prop.id;
    SELECT md5(coalesce(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) INTO others_before
      FROM public.observation_properties p WHERE p.id <> prop.id;
    UPDATE public.schema_proposals
       SET status = 'approved', resolved_at = stamp, gate_measure = measure,
           decision_rationale = 'schema_proposal_supersession_gate_v1: description-only supersession onto a key table; measured; no person reviewed'
     WHERE id = pr.id;
    UPDATE public.schema_proposals SET status = 'superseded', superseded_by = pr.id, resolved_at = coalesce(resolved_at, stamp)
     WHERE id = prop.proposed_by_proposal_id;
    UPDATE public.observation_properties SET description = pr.payload ->> 'description' WHERE id = prop.id;
    SELECT md5((to_jsonb(p) - 'description')::text) INTO hash_after FROM public.observation_properties p WHERE p.id = prop.id;
    SELECT md5(coalesce(string_agg(to_jsonb(p)::text, '|' ORDER BY p.id), '')) INTO others_after
      FROM public.observation_properties p WHERE p.id <> prop.id;
    IF hash_after <> hash_before OR others_after <> others_before THEN
      RAISE EXCEPTION 'schema_proposal_supersession_gate: a registry column other than description moved' USING ERRCODE = '23514';
    END IF;
  ELSE
    UPDATE public.schema_proposals SET gate_measure = measure WHERE id = pr.id AND status = 'open';
  END IF;
  PERFORM set_config('nuke.schema_proposal_key_gate', 'off', true);
  RETURN measure;
END $fn$;
COMMENT ON FUNCTION public.schema_proposal_supersession_gate(uuid) IS
  'schema_proposal_supersession_gate_v1: ratifies one agent modify_property proposal of exactly one shape (description-only, values move from an Allowed values list to a key table the storing column references by foreign key, no stored value orphaned) by measure; stores the measure in schema_proposals.gate_measure. Service role only.';
REVOKE ALL ON FUNCTION public.schema_proposal_supersession_gate(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.schema_proposal_supersession_gate(uuid) TO service_role;
