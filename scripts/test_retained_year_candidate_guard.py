"""Native-year cost guard: unchanged custody/readers and no parsing of unrelated fields."""
from pathlib import Path


def run_year_candidate_guard_checks(sql, read, rejects, passed):
    literal = lambda value: "'" + value.replace("'", "''") + "'"
    names = ('retained_description_year_text_witness', 'retained_description_year_value_matches')
    signatures = ('text', 'vehicle_observations,vehicle_observations')
    definitions = [sql(f"SELECT pg_get_functiondef('public.{name}({args})'::regprocedure)")
                   for name, args in zip(names, signatures)]
    for name, definition in zip(names, definitions):
        sql(definition.replace(f'FUNCTION public.{name}(', f'FUNCTION public.{name}_guard_before('))
    snapshot = """SELECT jsonb_build_object(
      'vehicles',(SELECT md5(jsonb_agg(to_jsonb(v) ORDER BY id)::text) FROM vehicles v),
      'work',(SELECT md5(jsonb_agg(to_jsonb(q) ORDER BY source_observation_id,property_id)::text) FROM retained_listing_property_work q),
      'replay',(SELECT md5(to_jsonb(r)::text) FROM retained_listing_property_replay r WHERE id),
      'sources',(SELECT md5(jsonb_agg(to_jsonb(s) ORDER BY id)::text) FROM observation_sources s),
      'properties',(SELECT md5(jsonb_agg(to_jsonb(r) ORDER BY id)::text) FROM observation_properties r),
      'job',(SELECT md5(to_jsonb(j)::text) FROM cron.job j WHERE jobname='project-retained-listing-properties'),
      'canonical_definition',md5(pg_get_viewdef('vehicle_canonical'::regclass,true)),
      'function_identity',(SELECT jsonb_agg(jsonb_build_object('oid',oid,'acl',proacl) ORDER BY proname) FROM pg_proc
        WHERE pronamespace='public'::regnamespace AND proname IN('retained_description_year_text_witness','retained_description_year_value_matches')))
    """
    before = read(snapshot)
    custody_query = """SELECT jsonb_agg(jsonb_build_object('id',o.id,'current',retained_listing_property_result_matches(
      o.source_observation_id,o.property_id,o.id)) ORDER BY o.id) FROM vehicle_observations o
      WHERE o.structured_data->>'source_profile'='bat_description_year_label_v1'"""
    custody = read(custody_query)
    migration = Path('supabase/migrations/20261011060954_retained_year_witness_candidate_guard.sql').read_text()
    sql(migration)
    assert read(snapshot) == before
    assert read(custody_query) == custody
    # The old and new predicates must agree for current year claims and other
    # retained fields. Mutated composites test refusals without writing testimony.
    differential = read("""WITH pairs AS MATERIALIZED(SELECT p,o FROM vehicle_observations o
      JOIN vehicle_observations p ON p.id=o.source_observation_id
      WHERE o.extraction_method='retained_listing_property_projection_v1'
      ORDER BY (o.structured_data->>'source_profile'='bat_description_year_label_v1') DESC NULLS LAST,o.id LIMIT 500)
      SELECT jsonb_build_object('compared',count(*),'disagreements',count(*) FILTER(WHERE
        retained_description_year_value_matches(p,o) IS DISTINCT FROM retained_description_year_value_matches_guard_before(p,o))) FROM pairs""")
    assert differential == {'compared': 500, 'disagreements': 0}
    pair = read("""SELECT jsonb_build_object('parent',p.id,'child',o.id,'vehicle',o.vehicle_id) FROM vehicle_observations o
      JOIN vehicle_observations p ON p.id=o.source_observation_id
      WHERE o.structured_data->>'source_profile'='bat_description_year_label_v1'
        AND retained_listing_property_result_matches(p.id,o.property_id,o.id) ORDER BY o.id LIMIT 1""")
    assert pair
    parent, child = pair['parent'], pair['child']
    for patch in ("jsonb_build_object('property_id',NULL)",
                  "jsonb_build_object('property_id','514cacd3-82b4-4330-b3df-e292612ee718')",
                  "jsonb_build_object('extraction_method','other')",
                  "jsonb_build_object('structured_data',o.structured_data||jsonb_build_object('source_profile',NULL))",
                  "jsonb_build_object('structured_data',o.structured_data||jsonb_build_object('source_profile','other'))",
                  "jsonb_build_object('structured_data',o.structured_data||jsonb_build_object('year',1801))",
                  "jsonb_build_object('structured_data',o.structured_data||jsonb_build_object('identity_resolution_status','verified'))"):
        assert sql(f"""SELECT retained_description_year_value_matches(p,x) IS NOT DISTINCT FROM
          retained_description_year_value_matches_guard_before(p,x) FROM vehicle_observations p,
          vehicle_observations o CROSS JOIN LATERAL(SELECT jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||{patch}) AS x)r
          WHERE p.id='{parent}' AND o.id='{child}'""") == 't'
    cases = ["This 2001 BMW X5 4.4i is finished in silver. " + "The source introduction remains an unverified identity label. " * 2,
             "This 2014 Airstream was built on a 2013 chassis. " + "The replacement configuration remains unknown. " * 2,
             "This 2001 Example is " + "x" * 500 + ". The original quote is too long.",
             "This 2001 Example is " + "é" * 250 + ". The original quote exceeds500 bytes.",
             "This 1800 Example is offered with records. " + "Its identity remains unverified. " * 3,
             "This 2101 Example is offered with records. " + "Its identity remains unverified. " * 3]
    for text in cases:
        assert sql(f"SELECT retained_description_year_text_witness({literal(text)}) IS NOT DISTINCT FROM retained_description_year_text_witness_guard_before({literal(text)})") == 't'
    # A parser trap demonstrates that unrelated fields cannot invoke the parser.
    # The valid control must invoke it. Everything inside this probe rolls back.
    sql(f"""BEGIN;
      CREATE OR REPLACE FUNCTION retained_description_property_witness(p vehicle_observations,p_key text) RETURNS jsonb
      LANGUAGE plpgsql STABLE SET search_path='' AS $$ BEGIN RAISE EXCEPTION 'parser_trap';END $$;
      DO $$ DECLARE p vehicle_observations;o vehicle_observations;x vehicle_observations;patch jsonb;BEGIN
        SELECT * INTO p FROM vehicle_observations WHERE id='{parent}';SELECT * INTO o FROM vehicle_observations WHERE id='{child}';
        FOREACH patch IN ARRAY ARRAY[jsonb_build_object('property_id',NULL),
          jsonb_build_object('property_id','514cacd3-82b4-4330-b3df-e292612ee718'),jsonb_build_object('extraction_method','other'),
          jsonb_build_object('structured_data',o.structured_data||jsonb_build_object('source_profile','other'))] LOOP
          x:=jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||patch);
          IF retained_description_year_value_matches(p,x) IS DISTINCT FROM false THEN RAISE EXCEPTION 'unrelated candidate accepted';END IF;
        END LOOP;
        BEGIN PERFORM retained_description_year_value_matches(p,o);RAISE EXCEPTION 'valid candidate skipped parser';
        EXCEPTION WHEN raise_exception THEN IF SQLERRM<>'parser_trap' THEN RAISE;END IF;END;
      END $$;ROLLBACK;""")
    assert read(custody_query) == custody
    winner = sql(f"SELECT observation_id FROM vehicle_canonical WHERE vehicle_id='{pair['vehicle']}' AND property_id='ece619f7-c49a-44f7-999f-a41acf5d4dc3'")
    assert winner
    assert sql(f"SET ROLE anon;SELECT observation_id FROM vehicle_canonical WHERE vehicle_id='{pair['vehicle']}' AND property_id='ece619f7-c49a-44f7-999f-a41acf5d4dc3';RESET ROLE;").splitlines()[-2] == winner
    provenance = read(f"SELECT get_field_provenance('{pair['vehicle']}','year')")
    assert any(o['id'] == child and o['source_profile'] == 'bat_description_year_label_v1' for o in provenance['observations'])
    rejects(migration)
    for name, args in zip(names, signatures):
        sql(f'DROP FUNCTION public.{name}_guard_before({args})')
    passed('year candidate guard:500-pair differential and refusals, byte bounds, no parsing of unrelated fields, unchanged custody/queue/replay/source/property/privacy/identity/grants and public winner')
