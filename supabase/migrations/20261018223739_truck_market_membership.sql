-- Extend the existing family reader with complete, public, priced-sale membership.
-- No testimony or vehicle identity is rewritten. Raw names survive every regrouping.
SET statement_timeout = '10s';
SET lock_timeout = '3s';
CREATE OR REPLACE FUNCTION public.treemap_family_models(p_brand text,p_family_key text,p_members boolean,p_after uuid DEFAULT NULL,p_partition integer DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $fn$
WITH scope AS MATERIALIZED (
 SELECT m.model_key,min(m.family) AS family
 FROM public.mv_family_market m
 WHERE p_members AND p_brand IN ('Chevrolet','GMC') AND m.brand=p_brand
 AND EXISTS (SELECT 1 FROM public.mv_family_market u WHERE u.brand=p_brand
   AND u.family_key=p_family_key AND u.family='Pickup')
 AND m.family IN ('Pickup','3100','3600','3800','Apache','Cameo','C10','K10','C20','K20','C30','K30',
 'C1500','K1500','454 SS','C2500','K2500','C3500','K3500','3500','S10','S-10 Pickup','Colorado',
 'Avalanche','SSR','LUV','Silverado','Sierra','Syclone','Sonoma','S15 Pickup','Canyon','Hummer EV Pickup')
 GROUP BY m.model_key
), brand_outcomes AS MATERIALIZED (
 SELECT id,model,year,sold_amount,source_name FROM public.mv_treemap_outcomes
 WHERE lower(brand_name)=lower(p_brand) AND sold_amount>0
 AND (p_partition IS NULL OR (p_partition BETWEEN 0 AND 3
   AND id BETWEEN (to_hex(p_partition*4)||repeat('0',31))::uuid AND (to_hex(p_partition*4+3)||repeat('f',31))::uuid))
), cursor_position AS MATERIALIZED (
 -- Opaque, non-authorizing cursor: do not expose an excluded/private candidate ID.
 SELECT id FROM brand_outcomes WHERE p_after IS NOT NULL AND md5(id::text)::uuid=p_after
), priced AS MATERIALIZED (
 SELECT o.*,s.family FROM brand_outcomes o
 JOIN scope s ON s.model_key=lower(btrim(coalesce(o.model,'')))
 WHERE p_after IS NULL OR o.id>(SELECT id FROM cursor_position LIMIT 1)
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
 'snapshot',(SELECT max(as_of) FROM public.mv_family_market WHERE brand=p_brand),
 'as_of',statement_timestamp(),'population','public_all_time_priced_sale_records',
 'configuration_basis','current_record_not_sale_time','rows',coalesce((SELECT jsonb_agg(jsonb_build_array(
 id,model,year,sold_amount,source_name,sale_date,family,drive,body_style,cab_config,series,trim,
 observed_at,observation_id) ORDER BY id) FROM configured),'[]'::jsonb));
$fn$;
REVOKE ALL ON FUNCTION public.treemap_family_models(text,text,boolean,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.treemap_family_models(text,text,boolean,uuid,integer) TO anon,authenticated,service_role;
COMMENT ON FUNCTION public.treemap_family_models(text,text,boolean,uuid,integer) IS
'Complete public GM Truck priced-sale membership for orthogonal treemap partitions; 1000-record pages with opaque non-authorizing cursor, has_more and stable fold snapshot. Current configuration, never sale-time configuration. Raw identity retained; El Camino/Caballero remain outside Truck.';
CREATE OR REPLACE FUNCTION public.treemap_family_models(p_brand text, p_family_key text)
 RETURNS TABLE(model text, sold bigint, sold_any bigint, offered bigint, usd bigint, dated bigint, sold_12m bigint, sold_prior_12m bigint, usd_12m bigint, usd_prior_12m bigint, as_of timestamp with time zone)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH target_keys AS (
    SELECT p_family_key AS family_key
    UNION
    SELECT DISTINCT m.family_key
    FROM public.mv_family_market m
    WHERE m.brand = p_brand
      AND EXISTS (
        SELECT 1
        FROM public.mv_family_market u
        WHERE u.brand = p_brand
          AND u.family_key = p_family_key
          AND u.family = 'Pickup'
      )
      AND (
        (p_brand = 'Chevrolet' AND m.family IN (
          'Pickup', '3100', '3600', '3800', 'Apache', 'Cameo',
          'C10', 'K10', 'C20', 'K20', 'C30', 'K30',
          'C1500', 'K1500', '454 SS', 'C2500', 'K2500', 'C3500', 'K3500', '3500',
          'S10', 'S-10 Pickup', 'Colorado', 'Avalanche', 'SSR', 'LUV', 'Silverado'
        ))
        OR (p_brand = 'GMC' AND m.family IN (
          'Pickup', 'C1500', 'K1500', 'Sierra', 'Syclone',
          'Sonoma', 'S15 Pickup', 'C2500', 'K2500', 'C3500', 'K3500', 'Canyon', 'Hummer EV Pickup'
        ))
        OR (p_brand = 'Ford' AND m.family IN (
          'Pickup', 'F-1', 'F-100', 'F-150', 'F-250', 'F-350', 'F-450', 'Ranger'
        ))
      )
  ),
  matched_models AS (
    SELECT nullif(m.model, '') AS model, m.model_key, m.sold, m.sold_any, m.offered, m.usd, m.bat_dated,
           m.bat_sold_12m, m.bat_sold_prior_12m, m.bat_usd_12m, m.bat_usd_prior_12m, m.as_of
    FROM public.mv_family_market m
    JOIN target_keys tk ON tk.family_key = m.family_key
    WHERE m.brand = p_brand AND m.sold > 0
    UNION
    SELECT nullif(m.model, '') AS model, m.model_key, m.sold, m.sold_any, m.offered, m.usd, m.bat_dated,
           m.bat_sold_12m, m.bat_sold_prior_12m, m.bat_usd_12m, m.bat_usd_prior_12m, m.as_of
    FROM public.mv_family_market m
    WHERE m.brand = p_brand AND m.sold > 0
      AND (
        (
          p_brand = 'Chevrolet'
          AND EXISTS (
            SELECT 1 FROM public.mv_family_market u
            WHERE u.brand = p_brand AND u.family_key = p_family_key AND u.family = 'Silverado'
          )
          AND m.model ILIKE '%silverado%'
        )
        OR (
          p_brand = 'GMC'
          AND EXISTS (
            SELECT 1 FROM public.mv_family_market u
            WHERE u.brand = p_brand AND u.family_key = p_family_key AND u.family = 'Sierra'
          )
          AND m.model ILIKE '%sierra%'
        )
      )
  )
  SELECT model, sold, sold_any, offered, usd, bat_dated,
         bat_sold_12m, bat_sold_prior_12m, bat_usd_12m, bat_usd_prior_12m, as_of
  FROM matched_models
  ORDER BY usd DESC, model_key
  LIMIT 200;
$function$
;
CREATE OR REPLACE FUNCTION public.treemap_family_sales(p_brand text, p_family_key text, p_limit integer DEFAULT 12000)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  WITH target_keys AS (
    SELECT p_family_key AS family_key
    UNION
    SELECT DISTINCT m.family_key
    FROM public.mv_family_market m
    WHERE m.brand = p_brand
      AND EXISTS (
        SELECT 1
        FROM public.mv_family_market u
        WHERE u.brand = p_brand
          AND u.family_key = p_family_key
          AND u.family = 'Pickup'
      )
      AND (
        (p_brand = 'Chevrolet' AND m.family IN (
          'Pickup', '3100', '3600', '3800', 'Apache', 'Cameo',
          'C10', 'K10', 'C20', 'K20', 'C30', 'K30',
          'C1500', 'K1500', '454 SS', 'C2500', 'K2500', 'C3500', 'K3500', '3500',
          'S10', 'S-10 Pickup', 'Colorado', 'Avalanche', 'SSR', 'LUV', 'Silverado'
        ))
        OR (p_brand = 'GMC' AND m.family IN (
          'Pickup', 'C1500', 'K1500', 'Sierra', 'Syclone',
          'Sonoma', 'S15 Pickup', 'C2500', 'K2500', 'C3500', 'K3500', 'Canyon', 'Hummer EV Pickup'
        ))
        OR (p_brand = 'Ford' AND m.family IN (
          'Pickup', 'F-1', 'F-100', 'F-150', 'F-250', 'F-350', 'F-450', 'Ranger'
        ))
      )
  ),
  raw_w AS (
    SELECT s.vehicle_id, s.sale_date, s.usd, s.source, s.year, s.model
    FROM public.mv_family_sales s
    JOIN target_keys tk ON tk.family_key = s.family_key
    WHERE s.brand = p_brand
      AND s.sale_date > current_date - 1826
      AND s.sale_date <= current_date
    UNION
    SELECT s.vehicle_id, s.sale_date, s.usd, s.source, s.year, s.model
    FROM public.mv_family_sales s
    WHERE p_brand IN ('Chevrolet', 'GMC')
      AND s.brand = p_brand
      AND s.sale_date > current_date - 1826
      AND s.sale_date <= current_date
      AND (
        (
          p_brand = 'Chevrolet'
          AND EXISTS (
            SELECT 1 FROM public.mv_family_market u
            WHERE u.brand = p_brand AND u.family_key = p_family_key AND u.family = 'Silverado'
          )
          AND s.model ILIKE '%silverado%'
        )
        OR (
          p_brand = 'GMC'
          AND EXISTS (
            SELECT 1 FROM public.mv_family_market u
            WHERE u.brand = p_brand AND u.family_key = p_family_key AND u.family = 'Sierra'
          )
          AND s.model ILIKE '%sierra%'
        )
      )
  ),
  step1 AS (
    SELECT DISTINCT ON (
      s.usd,
      s.source,
      COALESCE(s.year, 0),
      CASE
        WHEN s.source = 'Barrett-Jackson'
          AND v.primary_image_url IS NOT NULL
          AND btrim(v.primary_image_url) <> ''
        THEN 'bj-img:' || lower(regexp_replace(btrim(v.primary_image_url), '\?.*$', ''))
        WHEN s.source IN ('Bring a Trailer', 'Mecum', 'Bonhams')
          OR to_char(s.sale_date, 'MM-DD') <> '01-01'
        THEN 'dt:' || s.sale_date::text
        ELSE 'id:' || s.vehicle_id::text
      END
    )
      s.vehicle_id,
      s.sale_date,
      s.usd,
      s.source,
      s.year,
      -- Enrich model string with series / trim / body_style / listing_title when raw model lacks those tokens
      btrim(
        COALESCE(NULLIF(btrim(s.model), ''), NULLIF(btrim(v.model), ''), '')
        || CASE
             WHEN v.series IS NOT NULL AND btrim(v.series) <> ''
                  AND position(lower(btrim(v.series)) in lower(COALESCE(s.model, ''))) = 0
             THEN ' ' || btrim(v.series)
             ELSE ''
           END
        || CASE
             WHEN v.trim IS NOT NULL AND btrim(v.trim) <> ''
                  AND position(lower(btrim(v.trim)) in lower(COALESCE(s.model, '') || ' ' || COALESCE(v.series, ''))) = 0
             THEN ' ' || btrim(v.trim)
             ELSE ''
           END
        || CASE
             WHEN v.body_style IS NOT NULL AND btrim(v.body_style) <> ''
                  AND lower(btrim(v.body_style)) NOT IN ('truck', 'pickup', 'car', 'cars', 'other', 'subcompact cars', 'compact cars')
                  AND position(lower(btrim(v.body_style)) in lower(COALESCE(s.model, '') || ' ' || COALESCE(v.series, '') || ' ' || COALESCE(v.trim, ''))) = 0
             THEN ' ' || btrim(v.body_style)
             ELSE ''
           END
        || CASE
             WHEN COALESCE(v.listing_title, v.title) IS NOT NULL
                  AND length(COALESCE(s.model, '')) <= 18
             THEN ' · ' || btrim(COALESCE(v.listing_title, v.title))
             ELSE ''
           END
      ) AS model,
      v.vin,
      v.primary_image_url
    FROM raw_w s
    LEFT JOIN public.vehicles v ON v.id = s.vehicle_id
    ORDER BY
      s.usd DESC,
      s.source,
      COALESCE(s.year, 0),
      CASE
        WHEN s.source = 'Barrett-Jackson'
          AND v.primary_image_url IS NOT NULL
          AND btrim(v.primary_image_url) <> ''
        THEN 'bj-img:' || lower(regexp_replace(btrim(v.primary_image_url), '\?.*$', ''))
        WHEN s.source IN ('Bring a Trailer', 'Mecum', 'Bonhams')
          OR to_char(s.sale_date, 'MM-DD') <> '01-01'
        THEN 'dt:' || s.sale_date::text
        ELSE 'id:' || s.vehicle_id::text
      END,
      (v.primary_image_url IS NOT NULL AND btrim(v.primary_image_url) <> '') DESC,
      (v.vin IS NOT NULL AND length(btrim(v.vin)) >= 5) DESC,
      s.sale_date DESC,
      s.vehicle_id
  ),
  deduped AS (
    SELECT DISTINCT ON (
      s.source,
      s.sale_date,
      s.usd,
      COALESCE(s.year, 0),
      CASE
        WHEN s.vin IS NOT NULL AND length(btrim(s.vin)) >= 5
        THEN 'vin:' || upper(btrim(s.vin))
        WHEN s.primary_image_url IS NOT NULL
          AND btrim(s.primary_image_url) <> ''
          AND s.primary_image_url !~* '(placeholder|default|no[-_]?image|blank)'
        THEN 'img:' || lower(regexp_replace(btrim(s.primary_image_url), '\?.*$', ''))
        ELSE 'id:' || s.vehicle_id::text
      END
    )
      s.vehicle_id,
      s.sale_date,
      s.usd,
      s.source,
      s.year,
      s.model
    FROM step1 s
    ORDER BY
      s.source,
      s.sale_date,
      s.usd,
      COALESCE(s.year, 0),
      CASE
        WHEN s.vin IS NOT NULL AND length(btrim(s.vin)) >= 5
        THEN 'vin:' || upper(btrim(s.vin))
        WHEN s.primary_image_url IS NOT NULL
          AND btrim(s.primary_image_url) <> ''
          AND s.primary_image_url !~* '(placeholder|default|no[-_]?image|blank)'
        THEN 'img:' || lower(regexp_replace(btrim(s.primary_image_url), '\?.*$', ''))
        ELSE 'id:' || s.vehicle_id::text
      END,
      (s.primary_image_url IS NOT NULL AND btrim(s.primary_image_url) <> '') DESC,
      s.vehicle_id
  ),
  page AS (
    SELECT *
    FROM deduped
    ORDER BY sale_date DESC, vehicle_id
    LIMIT LEAST(GREATEST(p_limit, 1), 15000)
  )
  SELECT jsonb_build_object(
    'n', (SELECT count(*) FROM deduped),
    'returned', (SELECT count(*) FROM page),
    'truncated', (SELECT count(*) FROM deduped) > (SELECT count(*) FROM page),
    'window_from', current_date - 1825,
    'rows', COALESCE((
      SELECT jsonb_agg(jsonb_build_array(vehicle_id, sale_date, usd, source, year, model) ORDER BY sale_date DESC, vehicle_id)
      FROM page
    ), '[]'::jsonb)
  );
$function$
;
NOTIFY pgrst,'reload schema';
