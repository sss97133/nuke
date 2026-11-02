-- Carry already admitted native seller evidence into existing price/profile readers.
-- No scalar, identity, sale/bid policy, ownership, grant or row policy changes.
BEGIN;
SET LOCAL statement_timeout='5s';
SET LOCAL lock_timeout='2s';
DO $migration$
DECLARE d text; next_d text;
BEGIN
  d := pg_get_functiondef('public.vehicle_price_facts(uuid[])'::regprocedure);
  IF position('native_listing_price_clock_v1' in d)=0 THEN
    IF position($old$    SELECT v.*,
      CASE WHEN v.basis IS NOT NULL$old$ in d)=0 THEN RAISE EXCEPTION 'price reader anchor 0 drifted'; END IF;
    d := replace(d,$old$    SELECT v.*,
      CASE WHEN v.basis IS NOT NULL$old$,$new$    SELECT v.*, native_ask.observed_at AS native_ask_at, native_ask.source_url AS native_ask_url, native_ask.platform AS native_ask_platform,
      CASE WHEN v.basis IS NOT NULL$new$);
    IF position($old$    FROM dated v
$old$ in d)=0 THEN RAISE EXCEPTION 'price reader anchor 1 drifted'; END IF;
    d := replace(d,$old$    FROM dated v
$old$,$new$    FROM dated v
    -- native_listing_price_clock_v1: bind an existing scalar to its own retained
    -- seller quote. Amounts and sold/bid/estimate priority remain unchanged.
    LEFT JOIN LATERAL (
      SELECT o.observed_at, o.source_url,
             CASE WHEN o.extraction_method='gateway_jsonld_v1' THEN 'gateway_classics'
                  ELSE o.structured_data->>'platform' END AS platform
      FROM public.vehicle_observations o
      WHERE v.source_url ~ '^https?://(www[.])?(gatewayclassiccars|streetsideclassics|grautogallery)[.]com/'
        AND o.vehicle_id=v.id AND o.kind='listing' AND o.is_superseded=false
        AND o.extraction_method IN ('gateway_jsonld_v1','dealer_microdata_v1','dealer_microdata_v2')
        AND o.structured_data->>'source_claims_only'='true'
        AND o.structured_data->>'price_currency'='USD'
        AND jsonb_typeof(o.structured_data->'asking_price')='number'
        AND (o.structured_data->>'asking_price')::numeric=v.asking_price
        AND o.raw_source_ref='listing_page_snapshots:'||(o.extraction_metadata->>'snapshot_id')
        AND o.extraction_metadata->>'source_capture_sha256' ~ '^[a-f0-9]{64}$'
        AND regexp_replace(rtrim(o.source_url,'/'),'^https?://(www[.])?','')=
            regexp_replace(rtrim(v.source_url,'/'),'^https?://(www[.])?','')
      ORDER BY o.observed_at DESC NULLS LAST,o.ingested_at DESC LIMIT 1
    ) native_ask ON true
$new$);
    IF position($old$COALESCE(f.listing_updated_at, f.listing_posted_at)$old$ in d)=0 THEN RAISE EXCEPTION 'price reader anchor 2 drifted'; END IF;
    d := replace(d,$old$COALESCE(f.listing_updated_at, f.listing_posted_at)$old$,$new$COALESCE(f.native_ask_at, f.listing_updated_at, f.listing_posted_at)$new$);
    IF position($old$    f.canonical_platform, f.source_url$old$ in d)=0 THEN RAISE EXCEPTION 'price reader anchor 3 drifted'; END IF;
    d := replace(d,$old$    f.canonical_platform, f.source_url$old$,$new$    CASE WHEN f.basis IS NULL AND NOT (f.f_live AND f.f_bid IS NOT NULL) AND f.f_ask_active AND f.f_ask IS NOT NULL THEN coalesce(f.native_ask_platform,f.canonical_platform) ELSE f.canonical_platform END,
    CASE WHEN f.basis IS NULL AND NOT (f.f_live AND f.f_bid IS NOT NULL) AND f.f_ask_active AND f.f_ask IS NOT NULL THEN coalesce(f.native_ask_url,f.source_url) ELSE f.source_url END$new$);
    EXECUTE d;
  END IF;
  d := pg_get_functiondef('public.vehicle_profile_read(uuid)'::regprocedure);
  IF position('native_listing_members_v1' in d)=0 THEN
    IF position($old$),
-- The newest readable title claim$old$ in d)=0 THEN RAISE EXCEPTION 'profile reader anchor 0 drifted'; END IF;
    d := replace(d,$old$),
-- The newest readable title claim$old$,$new$),
-- native_listing_members_v1: source assertions retain their capture clock and
-- unknown physical configuration. Row policies still bound every observation.
native_listings AS (
  SELECT o.*,
    CASE WHEN o.extraction_method='gateway_jsonld_v1' THEN 'Gateway Classic Cars seller listing'
         WHEN o.structured_data->>'platform'='streetside_classics' THEN 'Streetside Classics seller listing'
         ELSE 'GR Auto Gallery seller listing' END AS source_label
  FROM v JOIN public.vehicle_observations o ON o.vehicle_id=v.id
  WHERE o.kind='listing' AND o.is_superseded=false
    AND o.extraction_method IN ('gateway_jsonld_v1','dealer_microdata_v1','dealer_microdata_v2')
    AND o.structured_data->>'source_claims_only'='true'
    AND o.raw_source_ref='listing_page_snapshots:'||(o.extraction_metadata->>'snapshot_id')
    AND o.extraction_metadata->>'source_capture_sha256' ~ '^[a-f0-9]{64}$'
),
native_members AS (
  SELECT f.dimension,f.value,o.observed_at,o.ingested_at,
    jsonb_build_object('value',f.value,'observed_at',o.observed_at,
      'trust',public.vehicle_profile_kind_trust('listing'),
      'source',jsonb_build_object('kind','listing','url',o.source_url,'label',o.source_label,'method',o.extraction_method),
      'qualification',jsonb_build_object('role','seller_claim','factory_configuration_status','unknown','current_configuration_status','unknown'))
      || CASE WHEN f.dimension='mileage' THEN jsonb_build_object('value',(o.structured_data->>'mileage')::numeric,'unit','mi') ELSE '{}'::jsonb END AS member
  FROM native_listings o
  CROSS JOIN LATERAL (VALUES
    ('engine',o.structured_data->>'engine'),
    ('transmission',o.structured_data->>'transmission'),
    ('mileage',CASE WHEN o.structured_data->'source_mileage'->>'unitCode'='SMI'
                    AND jsonb_typeof(o.structured_data->'mileage')='number' THEN o.structured_data->>'mileage' END)
  ) f(dimension,value)
  WHERE nullif(btrim(f.value),'') IS NOT NULL
),
-- The newest readable title claim$new$);
    IF position($old$coalesce(fa.claim, public.vehicle_profile_claim(to_jsonb(fa.value), NULL, e.source_type, e.source_confidence, e.extracted_at)) AS member$old$ in d)=0 THEN RAISE EXCEPTION 'profile reader anchor 1 drifted'; END IF;
    d := replace(d,$old$coalesce(fa.claim, public.vehicle_profile_claim(to_jsonb(fa.value), NULL, e.source_type, e.source_confidence, e.extracted_at)) AS member$old$,$new$coalesce(fa.claim, CASE WHEN e.source_type IS NOT NULL THEN public.vehicle_profile_claim(to_jsonb(fa.value), NULL, e.source_type, e.source_confidence, e.extracted_at) END, n.member, public.vehicle_profile_claim(to_jsonb(fa.value), NULL, NULL, NULL, NULL)) AS member$new$);
    IF position($old$    LIMIT 1) e ON true
),
-- A reading without a source$old$ in d)=0 THEN RAISE EXCEPTION 'profile reader anchor 2 drifted'; END IF;
    d := replace(d,$old$    LIMIT 1) e ON true
),
-- A reading without a source$old$,$new$    LIMIT 1) e ON true
  LEFT JOIN LATERAL (SELECT nm.member FROM native_members nm WHERE nm.dimension=fa.dimension
    AND lower(regexp_replace(nm.value,'[[:space:]]+',' ','g'))=lower(regexp_replace(fa.value,'[[:space:]]+',' ','g'))
    ORDER BY nm.observed_at DESC NULLS LAST,nm.ingested_at DESC LIMIT 1) n ON true
),
-- A reading without a source$new$);
    IF position($old$    WHEN nullif(btrim(coalesce(v.mileage_source, '')), '') IS NOT NULL$old$ in d)=0 THEN RAISE EXCEPTION 'profile reader anchor 3 drifted'; END IF;
    d := replace(d,$old$    WHEN nullif(btrim(coalesce(v.mileage_source, '')), '') IS NOT NULL$old$,$new$    WHEN n.member IS NOT NULL THEN n.member
    WHEN nullif(btrim(coalesce(v.mileage_source, '')), '') IS NOT NULL$new$);
    IF position($old$  CROSS JOIN LATERAL (
    SELECT CASE WHEN s.sk$old$ in d)=0 THEN RAISE EXCEPTION 'profile reader anchor 4 drifted'; END IF;
    d := replace(d,$old$  CROSS JOIN LATERAL (
    SELECT CASE WHEN s.sk$old$,$new$  LEFT JOIN LATERAL (SELECT nm.member FROM native_members nm WHERE nm.dimension='mileage' AND nm.value=v.mileage::text
    ORDER BY nm.observed_at DESC NULLS LAST,nm.ingested_at DESC LIMIT 1) n ON true
  CROSS JOIN LATERAL (
    SELECT CASE WHEN s.sk$new$);
    IF position($old$    AND o.structured_data ->> 'description_capture' = 'true'$old$ in d)=0 THEN RAISE EXCEPTION 'profile reader anchor 5 drifted'; END IF;
    d := replace(d,$old$    AND o.structured_data ->> 'description_capture' = 'true'$old$,$new$    AND (o.structured_data ->> 'description_capture' = 'true' OR EXISTS (SELECT 1 FROM native_listings n WHERE n.id=o.id
      AND nullif(btrim(n.structured_data->>'description'),'') IS NOT NULL AND n.content_text=n.structured_data->>'description'))$new$);
    EXECUTE d;
  END IF;
END
$migration$;
COMMIT;
