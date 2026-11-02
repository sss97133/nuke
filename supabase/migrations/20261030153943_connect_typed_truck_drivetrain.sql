-- Connect current typed drivetrain claims to the existing Truck member reader.
-- Preserve membership, money, keysets, privacy and withdrawn-consensus fences.
-- No source/vehicle writes, inference, new property, grants, capacity or schedule.
BEGIN;
SET LOCAL statement_timeout='10s';
SET LOCAL lock_timeout='1s';
DO $patch$
DECLARE f text;
BEGIN
 f:=pg_get_functiondef('public.treemap_family_models(text,text,boolean,uuid,integer)'::regprocedure);
 IF encode(sha256(convert_to(f,'UTF8')),'base64')<>'ns65MSBdbknlg7bZwKMW4q2yk6cQbfYuDRerNLc6Dbo=' THEN
  RAISE EXCEPTION 'Truck member reader changed; review typed drivetrain connection';
 END IF;
 f:=replace(f,$old0$), config_inputs AS MATERIALIZED ($old0$,$new0$), typed_reports AS MATERIALIZED (
 -- Use the same current canonical owner as the profile. A source claim is not
 -- verification of factory, current physical, or historical-sale configuration.
 SELECT m.id AS vehicle_id,
  CASE public.classify_drivetrain(c.structured_data->>'drivetrain_layout')
   WHEN 'RWD' THEN '2WD' WHEN 'FWD' THEN '2WD'
   ELSE public.classify_drivetrain(c.structured_data->>'drivetrain_layout') END AS typed_drive,
  o.observed_at AS typed_observed_at,o.id AS typed_observation_id
 FROM page m CROSS JOIN LATERAL(
  SELECT vc.* FROM public.vehicle_canonical vc WHERE vc.vehicle_id=m.id
   AND vc.property_id='32b51f19-e5cf-4f67-81d9-96c2d30885a1'::uuid OFFSET 0)c
 JOIN public.observation_properties r ON r.id=c.property_id AND r.property_key='drivetrain_layout'
  AND r.namespace='core' AND r.ratified_at IS NOT NULL AND r.deprecated_at IS NULL
  AND r.data_type='enum' AND r.unit IS NULL
 JOIN public.vehicle_observations o ON o.id=c.observation_id AND o.vehicle_id=m.id AND o.property_id=c.property_id
 WHERE o.kind='specification' AND o.subject_type='vehicle' AND o.subject_id IS NULL
  AND o.is_superseded IS NOT TRUE AND public.observation_is_public(o.kind,o.structured_data)
  AND jsonb_typeof(c.structured_data->'drivetrain_layout')='string'
  AND c.structured_data->>'drivetrain_layout' IN('RWD','FWD','2WD','4WD','AWD')
  AND (o.observed_at IS NULL OR o.observed_at<=statement_timestamp()) AND o.ingested_at<=statement_timestamp()
), config_inputs AS MATERIALIZED ($new0$);
 f:=replace(f,$old1$SELECT m.*,r.observed_at,r.observation_id,r.resolution_method,$old1$,$new1$SELECT m.*,r.observed_at,r.observation_id,r.resolution_method,t.typed_drive,t.typed_observed_at,t.typed_observation_id,$new1$);
 f:=replace(f,$old2$c.vehicle_id IS NOT NULL AS has_consensus,$old2$,$new2$c.vehicle_id IS NOT NULL AS has_consensus,
 t.typed_drive IS NOT NULL AS typed_usable,$new2$);
 f:=replace(f,$old3$LEFT JOIN public.vehicle_field_consensus c ON c.vehicle_id=m.id AND c.field_name='drivetrain'$old3$,$new3$LEFT JOIN public.vehicle_field_consensus c ON c.vehicle_id=m.id AND c.field_name='drivetrain'
 LEFT JOIN typed_reports t ON t.vehicle_id=m.id$new3$);
 f:=replace(f,$old4$SELECT m.*,
 CASE WHEN resolution_method='unresolved' THEN 'conflict'$old4$,$new4$SELECT m.*,
 CASE WHEN typed_usable AND resolution_method IS DISTINCT FROM 'unresolved' THEN typed_observed_at ELSE observed_at END AS drive_observed_at,
 CASE WHEN typed_usable AND resolution_method IS DISTINCT FROM 'unresolved' THEN typed_observation_id ELSE observation_id END AS drive_observation_id,
 CASE WHEN resolution_method='unresolved' THEN 'conflict'
 WHEN typed_usable AND reported_drive IS NOT NULL AND typed_drive<>reported_drive THEN 'conflict'
 WHEN typed_usable AND scalar_rooted AND scalar_drive<>typed_drive THEN 'conflict'$new4$);
 f:=replace(f,$old5$WHEN observation_id IS NOT NULL THEN reported_drive$old5$,$new5$WHEN typed_usable THEN typed_drive
 WHEN observation_id IS NOT NULL THEN reported_drive$new5$);
 f:=replace(f,$old6$observed_at,observation_id) ORDER BY id)$old6$,$new6$drive_observed_at,drive_observation_id) ORDER BY id)$new6$);
 f:=replace(f,$old7$'configuration_basis','current_record_not_sale_time','rows'$old7$,$new7$'configuration_basis','current_record_not_sale_time','configuration_verification','not_assessed','rows'$new7$);
 EXECUTE f;
 IF EXISTS(SELECT FROM pg_stat_activity WHERE pid<>pg_backend_pid() AND wait_event_type='Lock') THEN
  RAISE EXCEPTION 'Lock wait detected; rollback reader change';
 END IF;
END $patch$;
COMMIT;
