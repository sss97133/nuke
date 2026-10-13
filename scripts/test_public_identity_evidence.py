"""Actual acquisition SELECT against the existing localhost-only native PG fixture.

No replacement matcher: the existing fixture applies the real retained owners.
All additional records below are synthetic, in the disposable test database only.
"""
import json
from pathlib import Path
import time


def run_public_identity_evidence_checks(sql, read, rejects, passed):
    template = Path('scripts/discovery/public-identity-evidence.sql').read_text()
    literal = lambda value: "'" + json.dumps(value).replace("'", "''") + "'"
    def query(value):
        result = sql("BEGIN READ ONLY;SET LOCAL statement_timeout='5s';SET LOCAL lock_timeout='1s';" +
                     template.replace('$1', literal(value)) + "COMMIT;")
        return json.loads(next(line for line in result.splitlines() if line.startswith('{')))
    vehicle = 'b1000000-0000-4000-8000-000000000001'
    private = 'b1000000-0000-4000-8000-000000000002'
    deleted = 'b1000000-0000-4000-8000-000000000003'
    nonvehicle = 'b1000000-0000-4000-8000-000000000004'
    empty = 'b1000000-0000-4000-8000-000000000005'
    missing = 'b1000000-0000-4000-8000-000000000006'
    source = 'b2000000-0000-4000-8000-000000000001'
    # Bring only the legacy metadata column and observation-kind vocabulary up
    # to the catalog already present in production; install the actual privacy rule.
    sql("ALTER TABLE vehicle_field_sources ADD COLUMN IF NOT EXISTS metadata jsonb;")
    sql("ALTER TYPE observation_kind ADD VALUE IF NOT EXISTS 'media';")
    sql("ALTER TYPE observation_kind ADD VALUE IF NOT EXISTS 'splice';")
    privacy = Path('supabase/migrations/20261004175418_observation_private_fields_guard.sql').read_text()
    sql(privacy[privacy.index('CREATE OR REPLACE FUNCTION'):privacy.index('COMMENT ON FUNCTION')])
    sql(f"""INSERT INTO vehicles(id,is_public,deleted_at,listing_kind,year,make,model)
      VALUES('{vehicle}',true,NULL,'vehicle',1977,'Ford','F-150'),
      ('{private}',false,NULL,'vehicle',1901,'PRIVATE-MAKE','PRIVATE-MODEL'),
      ('{deleted}',true,now(),'vehicle',1902,'DELETED-MAKE','DELETED-MODEL'),
      ('{nonvehicle}',true,NULL,'non_vehicle_item',1903,'ITEM-MAKE','ITEM-MODEL'),
      ('{empty}',true,NULL,NULL,NULL,NULL,NULL);
      INSERT INTO field_evidence(vehicle_id,field_name,proposed_value,source_type,status)
      VALUES('{vehicle}','year','1977','bat_listing','accepted'),('{vehicle}','make','Ford','system_update','pending'),
      ('{vehicle}','model','wrong','bat_listing','superseded'),('{private}','make','PRIVATE-MAKE','bat_listing','accepted');
      INSERT INTO vehicle_field_sources(vehicle_id,field_name,field_value,source_type,metadata)
      VALUES('{vehicle}','model','F-150','legacy','{{"observation_id":"not-a-qualified-link"}}');
      INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,source_identifier,ingested_at,
       observed_at,extraction_method,confidence_score,structured_data,content_hash)
      SELECT ('b2000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'{vehicle}','listing',
       '4cdc735c-f117-42f2-889f-ba33805639a5','https://bringatrailer.com/listing/identity-assay-fixture-'||i,
       'identity-assay-source-'||i,'2026-10-01T00:00:00Z',NULL,'html_match',.7,
       '{{"year":1977,"make":"Ford","model":"F-150"}}','identity-assay-source-'||i FROM generate_series(1,103)i;
      INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_url,property_id,source_identifier,
       raw_source_ref,observed_at,ingested_at,extraction_method,confidence_score,structured_data,source_observation_id,content_hash)
      SELECT gen_random_uuid(),p.vehicle_id,'specification',p.source_id,p.source_url,r.id,
       'retained_listing_'||r.property_key||'_v1:'||p.id,'vehicle_observations:'||p.id,p.ingested_at,
       '2026-10-01T00:00:01Z','retained_listing_property_projection_v1',.6,
       jsonb_build_object(r.property_key,p.structured_data->r.property_key,'source_value',p.structured_data->r.property_key,
        'source_observation_id',p.id,'claim_role','listing_claim','observed_at_basis','source_testimony_recorded_at',
        'source_field',r.property_key,'property_key',r.property_key,'projection_version','retained_listing_'||r.property_key||'_v1',
        'analysis_kind','retained_listing_property_projection','source_recorded_at',p.ingested_at,'source_observed_at',p.observed_at,
        'source_confidence_score',p.confidence_score,'source_extraction_method',p.extraction_method,
        'normalization_version','retained_listing_identity_labels_v1','identity_role','extractor_vehicle_label',
        'identity_resolution_status','unverified','source_event_time_status','unknown','factory_configuration_status','unknown',
        'current_configuration_status','unknown','independent_source',false),p.id,'identity-assay-child-'||p.id||r.property_key
      FROM vehicle_observations p CROSS JOIN observation_properties r
      WHERE p.vehicle_id='{vehicle}' AND p.extraction_method='html_match' AND r.property_key IN('year','make','model');
      INSERT INTO vehicle_observations(id,vehicle_id,kind,source_id,source_identifier,property_id,extraction_method,structured_data)
      VALUES(gen_random_uuid(),'{vehicle}','specification','4cdc735c-f117-42f2-889f-ba33805639a5','identity-assay-unsupported',
       '8d274b73-a8a6-43bf-9036-5864d0152725','legacy_backfill','{{"make":"Ford"}}');""")
    keys = [vehicle, private, deleted, nonvehicle, empty, missing]
    inventory = query({'mode':'inventory','vehicleIds':list(reversed(keys))})
    assert inventory['status'] == 'read' and inventory['schemaVersion'] == 'public_identity_evidence_v1'
    assert len(inventory['ownerSha256']) == 64 and inventory['inventoryExhausted']
    assert [s['vehicleId'] for s in inventory['subjects']] == sorted(keys)
    subjects = {s['vehicleId']:s for s in inventory['subjects']}
    for key in [private, deleted, nonvehicle, missing]:
        assert subjects[key] == {'vehicleId':key,'publicEligible':False}
    assert all(f['typedCount'] == 0 for f in subjects[empty]['facets'].values())
    assert subjects[vehicle]['facets']['make']['typedCount'] == 104
    assert subjects[vehicle]['facets']['make']['otherTypedCount'] == 1
    assert all(f['plausibleCount'] == 103 and f['legacyCount'] == 1 and f['legacyMatchingCount'] == 1
               for f in subjects[vehicle]['facets'].values())
    assert 'PRIVATE-MAKE' not in json.dumps(inventory) and 'DELETED-MAKE' not in json.dumps(inventory)
    passed('identity inventory retains empty/missing keys, exact typed/legacy counts, and no private/deleted/nonvehicle values')
    candidates = []; pages = 0; cursor = None
    while True:
        page = query({'mode':'inventory','vehicleIds':keys,'cursor':cursor})
        assert page['subjects'] == inventory['subjects'] and page['ownerSha256'] == inventory['ownerSha256']
        candidates += page['candidates']; pages += 1
        assert page['candidatePageExhausted'] == (not page['hasMore'])
        if not page['hasMore']:
            assert page['nextCursor'] is None
            break
        assert len(page['candidates']) == 100
        last = page['candidates'][-1]
        assert page['nextCursor'] == {'vehicleId':last['vehicleId'],'observationId':last['observationId']}
        cursor = page['nextCursor']
    assert pages == 4 and len(candidates) == 309
    assert len({c['observationId'] for c in candidates}) == 309
    assert [(c['vehicleId'],c['observationId']) for c in candidates] == sorted((c['vehicleId'],c['observationId']) for c in candidates)
    checked = query({'mode':'custody','vehicleIds':keys,'candidateIds':[c['observationId'] for c in candidates[:100]]})
    assert len(checked['results']) == 100 and all(r['qualified'] and r['custodyMatches'] for r in checked['results'])
    assert all(r['identitySha256'] == subjects[vehicle]['identitySha256'] and r['sourceObservedAt'] is None and r['sourceEventTimeStatus']=='unknown' for r in checked['results'])
    assert 'content_text' not in json.dumps(checked) and 'structured_data' not in json.dumps(checked)
    passed('309 plausible keys exhaust in four stable contiguous pages; actual owner matcher qualifies100 while retaining unknown event time')
    child = sql(f"SELECT id FROM vehicle_observations WHERE source_observation_id='{source}' AND property_id='ece619f7-c49a-44f7-999f-a41acf5d4dc3'")
    def custody():
        return query({'mode':'custody','vehicleIds':[vehicle,empty],'candidateIds':[child]})['results'][0]
    initial = custody()
    for column, value, reason in [
        ('structured_data', "structured_data||'{\"seller_name\":\"PRIVATE PERSON\"}'::jsonb", 'source_unavailable_or_ineligible'),
        ('vehicle_id',f"'{empty}'::uuid",'source_unavailable_or_ineligible'),
        ('vehicle_id',f"'{private}'::uuid",'source_unavailable_or_ineligible'),
        ('is_superseded','true','source_custody_mismatch'),
        ('observed_at',"'2026-10-02T00:00:00Z'::timestamptz",'source_custody_mismatch'),
        ('observed_at',"'infinity'::timestamptz",'invalid_recording_clocks'),
        ('observed_at',"now()+interval '1 day'",'invalid_recording_clocks'),
        ('ingested_at',"now()+interval '1 day'",'invalid_recording_clocks')]:
        original = read(f"SELECT coalesce(to_jsonb({column}),'null'::jsonb) FROM vehicle_observations WHERE id='{source}'")
        sql(f"UPDATE vehicle_observations SET {column}={value} WHERE id='{source}'")
        result = custody()
        assert not result['qualified'] and result['reason'] == reason, result
        restore = 'NULL' if original is None else f"{literal(original)}::jsonb#>>'{{}}'"
        cast = '::jsonb' if column=='structured_data' else '::uuid' if column=='vehicle_id' else '::boolean' if column=='is_superseded' else '::timestamptz'
        sql(f"UPDATE vehicle_observations SET {column}=({restore}){cast} WHERE id='{source}'")
    assert custody()['qualified']
    # ingested_at is immutable. Append a distinct synthetic pair through the
    # existing insert guard rather than weakening that guard for a negative test.
    future_source = 'b2000000-0000-4000-8000-000000000104'
    future_child = 'b3000000-0000-4000-8000-000000000104'
    sql(f"""INSERT INTO vehicle_observations
      SELECT (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(p)||jsonb_build_object(
       'id','{future_source}','source_identifier','identity-assay-future-source','content_hash','identity-assay-future-source'))).*
      FROM vehicle_observations p WHERE id='{source}';
      INSERT INTO vehicle_observations
      SELECT (jsonb_populate_record(NULL::vehicle_observations,to_jsonb(o)||jsonb_build_object(
       'id','{future_child}','source_observation_id','{future_source}',
       'source_identifier','retained_listing_year_v1:{future_source}','raw_source_ref','vehicle_observations:{future_source}',
       'ingested_at',now()+interval '1 day','content_hash','identity-assay-future-child',
       'structured_data',o.structured_data||jsonb_build_object('source_observation_id','{future_source}')))).*
      FROM vehicle_observations o WHERE id='{child}';""")
    future = query({'mode':'custody','vehicleIds':[vehicle],'candidateIds':[future_child]})['results'][0]
    assert future['reason']=='invalid_recording_clocks' and not future['qualified']
    sql(f"UPDATE vehicles SET year=1978 WHERE id='{vehicle}'")
    changed = custody()
    assert changed['custodyMatches'] and not changed['qualified'] and not changed['matchesDisplayedValue']
    assert changed['reason']=='displayed_value_disagreement' and changed['identitySha256'] != initial['identitySha256']
    sql(f"UPDATE vehicles SET year=1977,make='  fOrD  ',model=' f-150 ' WHERE id='{vehicle}'")
    labels = query({'mode':'custody','vehicleIds':[vehicle],'candidateIds':[c['observationId'] for c in candidates[:100]]})
    assert all(r['qualified'] for r in labels['results'])
    sql(f"UPDATE vehicles SET is_public=false WHERE id='{vehicle}'")
    hidden = custody()
    assert not hidden['publicEligible'] and hidden['vehicleId'] is None and hidden['propertyKey'] is None and 'identitySha256' not in hidden
    sql(f"UPDATE vehicles SET is_public=true,make='Ford',model='F-150' WHERE id='{vehicle}'")
    passed('real custody rejects private/moved/superseded/future sources; exact year and label normalization, identity-race hash, and private child refusal')
    for args in [{'mode':'inventory','vehicleIds':[]}, {'mode':'inventory','vehicleIds':[vehicle,vehicle]},
                 {'mode':'inventory','vehicleIds':['not-a-uuid']}, {'mode':'inventory','vehicleIds':[None]},
                 {'mode':'inventory','vehicleIds':[vehicle]*201}, {'mode':'wrong','vehicleIds':[vehicle]},
                 {'mode':'inventory','vehicleIds':[vehicle],'cursor':{'vehicleId':vehicle,'observationId':'broken'}},
                 {'mode':'custody','vehicleIds':[vehicle],'candidateIds':[child,child]}]:
        refused = query(args)
        assert refused['status']=='refused' and refused['subjects']==[] and refused['results']==[]
    owner = sql("SELECT pg_get_functiondef('observation_is_public(observation_kind,jsonb)'::regprocedure)")
    sql(owner.replace('SELECT p_kind IN','SELECT true AND p_kind IN'))
    assert query({'mode':'inventory','vehicleIds':[empty]})['ownerSha256'] != inventory['ownerSha256']
    sql(owner)
    started = time.monotonic()
    many = ['60000001-0000-4000-8000-'+str(i).zfill(12) for i in range(1,201)]
    large = query({'mode':'inventory','vehicleIds':many})
    assert len(large['subjects']) == 200 and len(json.dumps(large)) < 2*1024*1024
    passed(f'input refusal, owner-definition drift fingerprint, and200-key local inventory under5s ({(time.monotonic()-started)*1000:.1f}ms including psql)')
