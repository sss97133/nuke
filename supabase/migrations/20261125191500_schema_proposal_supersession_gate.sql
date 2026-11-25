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
--              qualifier_of, description (so no data_type, namespace, label, cardinality, unit, scope or adds_values).
--   SUPERSEDES the property's ratifying proposal (observation_properties.proposed_by_proposal_id), status approved;
--              no other approved supersession of it; payload property_key = that property's key.
--   TEXT       the superseded text holds an 'Allowed values:' list and the new text holds none; the new text names
--              the values_from table.
--   KEY TABLE  values_from = '<table>.<column>' in public, the column alone is the table's primary key or a unique key.
--   FK         stored_in = '<table>.<column>' in public with a foreign key (pg_constraint, contype f) from exactly that
--              column to exactly the values_from column: the property's storing column.
--   NO ORPHANS every value stored for the property resolves to a key row or is NULL with a reason row: (a) stored_in
--              rows of this property (when the table has property_key): stored column NULL counts as orphan;
--              (b) observations whose property is in qualifier_of (not superseded) carrying the key in structured_data:
--              the value is a key row, or it is absent and <key>_null_reason is a null_reasons_from row of this key.
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
  n_obs bigint := 0; n_obs_orphan bigint := 0;
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
      IF k NOT IN ('property_key', 'field', 'values_from', 'stored_in', 'null_reasons_from', 'qualifier_of', 'description') THEN
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
    SELECT * INTO orig FROM public.schema_proposals WHERE id = prop.proposed_by_proposal_id;
    IF orig.id IS NULL OR orig.status <> 'approved' THEN reasons := reasons || 'superseded_not_approved'::text; END IF;
    IF EXISTS (SELECT 1 FROM public.schema_proposals s WHERE s.supersedes_proposal_id = prop.proposed_by_proposal_id
                AND s.status = 'approved' AND s.id <> pr.id) THEN
      reasons := reasons || 'already_superseded'::text;
    END IF;
    -- TEXT
    IF coalesce(prop.description, '') !~* 'allowed values:' THEN reasons := reasons || 'superseded_text_has_no_value_list'::text; END IF;
  END IF;
  IF coalesce(pr.payload ->> 'description', '') = '' THEN
    reasons := reasons || 'description_missing'::text;
  ELSIF pr.payload ->> 'description' ~* 'allowed values:' THEN
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
         WHERE c.contype = 'f' AND c.conrelid = s_rel AND c.confrelid = v_rel
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
  IF pr.payload ? 'qualifier_of' THEN
    IF jsonb_typeof(pr.payload -> 'qualifier_of') <> 'array' THEN
      reasons := reasons || 'qualifier_of_invalid'::text;
    ELSE
      SELECT array_agg(x) INTO quals FROM jsonb_array_elements_text(pr.payload -> 'qualifier_of') x;
      SELECT array_agg(o.id) INTO qual_ids FROM public.observation_properties o WHERE o.property_key = ANY (quals);
      IF coalesce(cardinality(qual_ids), 0) <> coalesce(cardinality(quals), 0) THEN
        reasons := reasons || 'qualifier_of_unknown'::text;
      END IF;
    END IF;
  END IF;

  -- NO ORPHANS (only when the tables and the FK are sound)
  IF prop.id IS NOT NULL AND NOT (reasons && ARRAY['values_from_shape', 'values_from_table_missing', 'values_from_not_a_key',
                                                  'stored_in_shape', 'stored_in_table_missing', 'stored_in_no_foreign_key']) THEN
    IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = s_rel AND attname = 'property_key' AND NOT attisdropped) THEN
      EXECUTE format('SELECT count(*), count(*) FILTER (WHERE %I IS NULL) FROM public.%I WHERE property_key = $1', sc, st)
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
          WHERE o.property_id = ANY ($2) AND o.is_superseded = false
            AND (o.structured_data ? $1 OR o.structured_data ? ($1 || ''_null_reason''))',
        vt, vc, null_clause)
        INTO n_obs, n_obs_orphan USING prop.property_key, qual_ids;
    END IF;
    IF n_stored_orphan > 0 OR n_obs_orphan > 0 THEN reasons := reasons || 'stored_values_orphaned'::text; END IF;
  END IF;

  decision := CASE WHEN cardinality(reasons) = 0 THEN 'ratified' ELSE 'refused' END;
  measure := jsonb_build_object(
    'basis', 'schema_proposal_supersession_gate_v1', 'measured_at', stamp, 'decision', decision,
    'property_key', prop.property_key, 'supersedes', prop.proposed_by_proposal_id,
    'values_from', pr.payload ->> 'values_from', 'stored_in', pr.payload ->> 'stored_in',
    'stored_rows', n_stored, 'stored_rows_orphaned', n_stored_orphan,
    'observations', n_obs, 'observations_orphaned', n_obs_orphan,
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
