-- Replan this skewed brand scope with bound values on every call, following
-- existing cohort readers. Its SQL-function generic plan estimates one model
-- row and repeatedly nested-loops the Chevrolet scope; anonymous RPC times out
-- despite the fast literal SELECT assay. Membership and public gates unchanged.
SET statement_timeout = '10s';
SET lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.treemap_family_models(p_brand text,p_family_key text,p_members boolean,p_after uuid DEFAULT NULL,p_partition integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
DECLARE result jsonb;
BEGIN
 EXECUTE $read$
WITH scope AS MATERIALIZED (
 SELECT m.model_key,min(m.family) AS family
 FROM public.mv_family_market m
 WHERE $3::boolean AND $1::text IN ('Chevrolet','GMC') AND m.brand=$1::text
 AND EXISTS (SELECT 1 FROM public.mv_family_market u WHERE u.brand=$1::text
   AND u.family_key=$2::text AND u.family='Pickup')
 AND m.family IN ('Pickup','3100','3600','3800','Apache','Cameo','C10','K10','C20','K20','C30','K30',
 'C1500','K1500','454 SS','C2500','K2500','C3500','K3500','3500','S10','S-10 Pickup','Colorado',
 'Avalanche','SSR','LUV','Silverado','Sierra','Syclone','Sonoma','S15 Pickup','Canyon','Hummer EV Pickup')
 GROUP BY m.model_key
), brand_outcomes AS MATERIALIZED (
 SELECT id,model,year,sold_amount,source_name FROM public.mv_treemap_outcomes
 WHERE lower(brand_name)=lower($1::text) AND sold_amount>0
 AND ($5::integer IS NULL OR ($5::integer BETWEEN 0 AND 3
   AND id BETWEEN (to_hex($5::integer*4)||repeat('0',31))::uuid AND (to_hex($5::integer*4+3)||repeat('f',31))::uuid))
), cursor_position AS MATERIALIZED (
 -- Opaque, non-authorizing cursor: do not expose an excluded/private candidate ID.
 SELECT id FROM brand_outcomes WHERE $4::uuid IS NOT NULL AND md5(id::text)::uuid=$4::uuid
), priced AS MATERIALIZED (
 SELECT o.*,s.family FROM brand_outcomes o
 JOIN scope s ON s.model_key=lower(btrim(coalesce(o.model,'')))
 WHERE $4::uuid IS NULL OR o.id>(SELECT id FROM cursor_position LIMIT 1)
 ORDER BY o.id LIMIT 1001
), candidates AS MATERIALIZED (
 SELECT * FROM priced ORDER BY id LIMIT 1000
), members AS MATERIALIZED (
 SELECT o.id,o.model,o.year,o.sold_amount,o.source_name,coalesce(v.sale_date,v.bat_sale_date) AS sale_date,
  o.family,v.drivetrain,v.body_style,v.cab_config,v.series,v.trim
 FROM candidates o JOIN public.vehicles v ON v.id=o.id
 WHERE v.is_public=true AND v.deleted_at IS NULL AND coalesce(v.listing_kind,'')<>'non_vehicle_item'
), page AS MATERIALIZED (
 SELECT * FROM members ORDER BY id LIMIT 1000
), reports AS MATERIALIZED (
 -- Same selected-testimony custody checks as get_vehicle_specs; current config,
 -- never a claim about configuration at a historical sale.
 SELECT c.vehicle_id,c.consensus_value,c.resolution_method,o.observed_at,o.id AS observation_id
 FROM page m JOIN public.vehicle_field_consensus c ON c.vehicle_id=m.id AND c.field_name='drivetrain'
 JOIN public.vehicle_observations o ON o.id=c.source_observation_id
 WHERE o.vehicle_id=c.vehicle_id AND o.is_superseded IS NOT TRUE
 AND o.kind='listing' AND o.subject_type='vehicle'
 AND o.structured_data->>'drivetrain' IS NOT DISTINCT FROM c.consensus_value
 AND o.confidence_score IS NOT DISTINCT FROM c.consensus_confidence
 AND public.observation_is_public(o.kind,o.structured_data)
 AND o.observed_at<=c.as_of_at AND o.ingested_at<=c.as_of_at
 AND o.observed_at<=statement_timestamp() AND o.ingested_at<=statement_timestamp()
), config_inputs AS MATERIALIZED (
 SELECT m.*,r.observed_at,r.observation_id,r.resolution_method,
 c.vehicle_id IS NOT NULL AS has_consensus,
 CASE public.classify_drivetrain(m.drivetrain) WHEN 'RWD' THEN '2WD' WHEN 'FWD' THEN '2WD'
   ELSE public.classify_drivetrain(m.drivetrain) END AS scalar_drive,
 CASE public.classify_drivetrain(r.consensus_value) WHEN 'RWD' THEN '2WD' WHEN 'FWD' THEN '2WD'
   ELSE public.classify_drivetrain(r.consensus_value) END AS reported_drive
 FROM page m LEFT JOIN reports r ON r.vehicle_id=m.id
 LEFT JOIN public.vehicle_field_consensus c ON c.vehicle_id=m.id AND c.field_name='drivetrain'
), rooted AS (
 SELECT m.*,scalar_drive IS NOT NULL AND (
 EXISTS (SELECT 1 FROM public.vehicle_field_sources fs WHERE fs.vehicle_id=m.id AND fs.field_name='drivetrain'
 AND lower(btrim(fs.field_value))=lower(btrim(m.drivetrain)) AND coalesce(fs.source_type,'') NOT IN ('computed',''))
 OR EXISTS (SELECT 1 FROM public.field_evidence fe WHERE fe.vehicle_id=m.id AND fe.field_name='drivetrain'
 AND lower(btrim(fe.proposed_value))=lower(btrim(m.drivetrain)) AND fe.status IN ('pending','accepted'))) AS scalar_rooted
 FROM config_inputs m
), configured AS (
 SELECT m.*,
 CASE WHEN resolution_method='unresolved' THEN 'conflict'
 -- Independent rooted scalar testimony has no ordering clock here. A dated
 -- listing does not prove it is newer than that undated claim.
 WHEN reported_drive IS NOT NULL AND scalar_rooted AND scalar_drive<>reported_drive THEN 'conflict'
 WHEN observation_id IS NOT NULL THEN reported_drive
 -- Withdrawn/stale consensus cannot resurrect an older scalar.
 WHEN NOT has_consensus AND scalar_rooted THEN scalar_drive END AS drive
 FROM rooted m
)
SELECT jsonb_build_object('n',(SELECT count(*) FROM members),'truncated',false,'has_more',(SELECT count(*) FROM priced)>1000,
 'next_cursor',(SELECT md5(id::text)::uuid FROM candidates ORDER BY id DESC LIMIT 1),
 'snapshot',(SELECT max(as_of) FROM public.mv_family_market WHERE brand=$1::text),
 'as_of',statement_timestamp(),'population','public_all_time_priced_sale_records',
 'configuration_basis','current_record_not_sale_time','rows',coalesce((SELECT jsonb_agg(jsonb_build_array(
 id,model,year,sold_amount,source_name,sale_date,family,drive,body_style,cab_config,series,trim,
 observed_at,observation_id) ORDER BY id) FROM configured),'[]'::jsonb))
 $read$ INTO result USING p_brand,p_family_key,p_members,p_after,p_partition;
 RETURN result;
END;
$fn$;
NOTIFY pgrst, 'reload schema';
