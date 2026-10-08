\set ON_ERROR_STOP on
\ir ../migrations/20261008013347_defer_bat_sale_intake_under_parent_locks.sql
SELECT fixture_assert(NOT has_table_privilege('anon','bat_sale_capture_deferrals','SELECT'),'deferral state not public');
SELECT fixture_assert(NOT has_table_privilege('authenticated','bat_sale_capture_deferrals','SELECT'),'deferral state not signed-in visible');
SELECT fixture_assert(NOT has_table_privilege('service_role','bat_sale_capture_deferrals','INSERT,UPDATE,DELETE,TRUNCATE'),'service raw deferral mutation denied');
SELECT fixture_assert(NOT has_sequence_privilege('service_role','bat_sale_capture_deferrals_id_seq','USAGE'),'service identity mint denied');
SELECT fixture_assert(NOT has_function_privilege('service_role','defer_bat_sale_snapshot(uuid)','EXECUTE'),'internal append not an API endpoint');
SELECT fixture_assert(NOT has_function_privilege('anon','retry_bat_sale_deferrals()','EXECUTE'),'anonymous retry denied');
SELECT fixture_assert((SELECT count(*)=3 FROM pg_attribute WHERE attrelid='bat_sale_capture_deferrals'::regclass AND attnum>0 AND NOT attisdropped AND col_description(attrelid,attnum) IS NOT NULL),'all3 earned buffer columns described');
SELECT fixture_assert((SELECT count(*)=1 FROM pg_constraint WHERE conrelid='bat_sale_capture_deferrals'::regclass AND contype='f'),'deferral preserves capture FK');
SELECT fixture_reject($a$SELECT defer_bat_sale_snapshot('99999999-9999-9999-9999-999999999999')$a$,'nonexistent capture cannot be deferred','23503');
SELECT fixture_capture(1599);
SELECT defer_bat_sale_snapshot(md5('fixture-capture-1599')::uuid);
SELECT fixture_assert(assay_bat_sale_intake()#>>'{counts,deferred}'='1','assay includes actual outstanding capture event');
SELECT fixture_assert(retry_bat_sale_deferrals()=1,'already queued capture consumes duplicate deferred event');
SELECT fixture_assert((SELECT count(*)=0 FROM bat_sale_capture_deferrals),'duplicate deferral did not create a second work row');
