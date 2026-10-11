"""Exercise the existing canonical view with production-style source RLS."""
from pathlib import Path


def run_canonical_recovery_checks(sql, read, rejects, passed):
    samples = read("""SELECT jsonb_agg(x) FROM (
     SELECT DISTINCT ON(r.property_key) r.property_key,c.vehicle_id,c.property_id,c.observation_id,o.source_observation_id
     FROM vehicle_canonical c JOIN vehicle_observations o ON o.id=c.observation_id
     JOIN observation_properties r ON r.id=c.property_id
     JOIN vehicle_observations p ON p.id=o.source_observation_id
     WHERE p.extraction_method IN('html_description_capture','html_match')
     AND (retained_description_property_matches(p,o) OR retained_listing_identity_matches(p,o))
     ORDER BY r.property_key,c.observation_id)x""")
    assert {'year','make','model','mileage_miles','interior_color','exterior_color','drivetrain_layout'} <= {r['property_key'] for r in samples}
    identity = next(r for r in samples if r['property_key']=='make')
    native = next(r for r in samples if r['property_key']=='mileage_miles')
    def metadata():
        return read("""SELECT jsonb_build_object('view_oid','vehicle_canonical'::regclass::oid,
     'view_acl',(SELECT relacl::text FROM pg_class WHERE oid='vehicle_canonical'::regclass),
     'source_policy',(SELECT jsonb_agg(to_jsonb(p) ORDER BY policyname) FROM pg_policies p WHERE schemaname='public' AND tablename='observation_sources'),
     'source_options',(SELECT jsonb_build_object('rls',relrowsecurity,'acl',relacl::text) FROM pg_class WHERE oid='observation_sources'::regclass),
     'helper_oids',(SELECT jsonb_object_agg(proname,oid) FROM pg_proc WHERE oid IN(
      'retained_listing_identity_matches(vehicle_observations,vehicle_observations)'::regprocedure,
      'retained_description_property_matches(vehicle_observations,vehicle_observations)'::regprocedure)))""")
    # The source catalog grants SELECT but only authenticated has an RLS read policy.
    sql("GRANT USAGE ON SCHEMA public TO anon,authenticated; GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon,authenticated;")
    sql("ALTER TABLE observation_sources ENABLE ROW LEVEL SECURITY; CREATE POLICY canonical_fixture_authenticated_source ON observation_sources FOR SELECT TO authenticated USING(true);")
    before = metadata()
    def canonical_count(role, row):
        return sql(f"SET ROLE {role}; SELECT count(*) FROM vehicle_canonical WHERE vehicle_id='{row['vehicle_id']}' AND property_id='{row['property_id']}'; RESET ROLE;").splitlines()[-2]
    for row in (identity,native):
        assert canonical_count('anon',row)=='0'
        assert canonical_count('authenticated',row)=='1'
    assert sql('SET ROLE anon; SELECT count(*) FROM observation_sources; RESET ROLE;').splitlines()[-2]=='0'
    passed('real source RLS reproduces anonymous native and identity canonical omission')
    previous_receipt=read('SELECT previous_scan_receipt FROM retained_listing_property_replay WHERE id')
    candidates=read("""SELECT jsonb_agg(x) FROM(
     SELECT source_observation_id,property_id FROM retained_listing_property_work
     WHERE status='done' AND property_id IN('c0f743ae-dc94-4dfd-98ef-514b76f74a9b','66b2f1f6-b714-4ac0-85b6-60ba89529c1a','235aed17-9bd3-4886-90be-9b1a8e2d1844')
     ORDER BY source_observation_id,property_id LIMIT 503)x""")
    assert len(candidates)==503
    def work_condition(row):
        return f"source_observation_id='{row['source_observation_id']}' AND property_id='{row['property_id']}'"
    keys=','.join(f"('{r['source_observation_id']}'::uuid,'{r['property_id']}'::uuid)" for r in candidates)
    sql(f"""UPDATE retained_listing_property_work SET status='failed',attempts=3,
     next_attempt_at='2026-10-10T23:30:00Z',last_error='canonical_request_failed',observation_id=NULL,completed_at=NULL
     WHERE (source_observation_id,property_id) IN({keys})""")
    sql(f"UPDATE retained_listing_property_work SET next_attempt_at='2026-10-10T23:55:00Z' WHERE {work_condition(candidates[-1])}")
    sql(f"UPDATE retained_listing_property_work SET last_error='unrelated_failure' WHERE {work_condition(candidates[-2])}")
    migration = Path('supabase/migrations/20261010234847_retained_canonical_reader_recovery.sql').read_text()
    sql(migration)
    recovered=read("SELECT previous_scan_receipt->'enum_failure_retry_recovery' FROM retained_listing_property_replay WHERE id")
    assert recovered['requeued']==500 and len(recovered['previous_work'])==500 and recovered['cap']==500
    assert all(r['status']=='failed' and r['attempts']==3 and r['last_error']=='canonical_request_failed' for r in recovered['previous_work'])
    assert read("SELECT previous_scan_receipt-'enum_failure_retry_recovery' FROM retained_listing_property_replay WHERE id")==previous_receipt
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE status='pending' AND attempts=0 AND last_error='enum_membership_incident_recheck'")=='500'
    assert sql("SELECT count(*) FROM retained_listing_property_work WHERE status='failed'")=='3'
    for row in candidates[-2:]:
        assert sql(f"SELECT status FROM retained_listing_property_work WHERE {work_condition(row)}")=='failed'
    passed('incident recheck caps at500, retains exact previous failed-work receipts and prior replay receipts, excludes later/unrelated failures')
    for role in ('anon','authenticated'):
        for row in samples:
            assert canonical_count(role,row)=='1', (role,row['property_key'])
    assert sql('SET ROLE anon; SELECT count(*) FROM observation_sources; RESET ROLE;').splitlines()[-2]=='0'
    for name in ('retained_description_property_value_matches','retained_listing_identity_value_matches',
                 'retained_description_property_matches','retained_listing_identity_matches'):
        assert sql(f"SELECT NOT prosecdef FROM pg_proc WHERE oid='{name}(vehicle_observations,vehicle_observations)'::regprocedure")=='t'
    assert metadata()==before
    for row, name, field, value in [
        (identity,'retained_listing_identity','identity_resolution_status','verified'),
        (identity,'retained_listing_identity','source_value','forged label'),
        (native,'retained_description_property','true_mileage_status','verified'),
        (native,'retained_description_property','source_event_time_status','known'),
    ]:
        assert sql(f"""SELECT NOT public.{name}_matches(p,jsonb_populate_record(NULL::vehicle_observations,
         to_jsonb(o)||jsonb_build_object('structured_data',o.structured_data||jsonb_build_object('{field}','{value}'))))
         AND NOT public.{name}_value_matches(p,jsonb_populate_record(NULL::vehicle_observations,
         to_jsonb(o)||jsonb_build_object('structured_data',o.structured_data||jsonb_build_object('{field}','{value}'))))
         FROM vehicle_observations o JOIN vehicle_observations p ON p.id=o.source_observation_id
         WHERE o.id='{row['observation_id']}'""")=='t'
    # Pure predicates are shared with admission/completion; metadata changes still withdraw the view.
    for table, condition, change in [
        ('vehicles',f"id='{identity['vehicle_id']}'",'is_public=false'),
        ('observation_properties',f"id='{identity['property_id']}'","label='Changed identity meaning'"),
        ('observation_sources',"slug='bat'","supported_observations=ARRAY[]::observation_kind[]"),
    ]:
        old=sql(f"SELECT to_jsonb(t) FROM {table} t WHERE {condition}")
        sql(f"UPDATE {table} SET {change} WHERE {condition}")
        assert canonical_count('anon',identity)=='0'
        column=change.split('=',1)[0]
        literal="'"+old.replace("'","''")+"'"
        sql(f"UPDATE {table} SET {column}=(SELECT {column} FROM jsonb_populate_record(NULL::public.{table},{literal}::jsonb)) WHERE {condition}")
        assert canonical_count('anon',identity)=='1'
    rejects(migration)
    sql('DROP POLICY canonical_fixture_authenticated_source ON observation_sources; ALTER TABLE observation_sources DISABLE ROW LEVEL SECURITY;')
    passed('anonymous/authenticated canonical values delivered with unchanged source policy, invoker security, view/helper OIDs and grants; metadata withdrawal still enforced')
