-- Disposable PG17 only. Synthetic rows are read-only JSON views; no testimony writes.
-- Executes captured baseline readers and the actual migration twice.
-- Visibility fixture models an already-filtered caller boundary; live RLS is verified separately.
\set ON_ERROR_STOP on
DO $$ BEGIN IF current_database() NOT LIKE 'dm_refinement_%' THEN RAISE EXCEPTION 'disposable database required'; END IF; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT NULL::uuid $$;
CREATE FUNCTION public.vehicle_user_has_access(uuid,uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.vehicle_sale_price_untrusted_read(uuid) RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.vehicle_sale_citation(uuid,numeric) RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT NULL::jsonb $$;
CREATE VIEW public.vehicles WITH (security_invoker=true) AS SELECT * FROM jsonb_to_recordset(coalesce(nullif(current_setting('test.vehicles',true),''),'[]')::jsonb) AS r(id uuid,uploaded_by uuid,make text,model text,year integer,mileage integer,transmission text,engine_size text,drivetrain text,body_style text,is_public boolean,notes text,created_at timestamp with time zone,sale_price integer,auction_end_date text,bat_auction_url text,bat_sold_price numeric,bat_sale_date date,discovery_url text,bat_location text,sale_status text,sale_date date,deleted_at timestamp with time zone,entry_type text,import_metadata jsonb,asking_price numeric,user_id uuid,owner_id uuid,trim text,city text,state text,mileage_source text,platform_url text,series text,engine_type text,transmission_model text,sold_price integer,normalized_model text,auction_outcome text,high_bid integer,winning_bid integer,location text,listing_url text,listing_posted_at timestamp with time zone,listing_updated_at timestamp with time zone,listing_title text,listing_location text,reserve_status text,canonical_body_style text,nuke_estimate numeric,nuke_estimate_confidence integer,valuation_calculated_at timestamp with time zone,canonical_platform text,canonical_outcome text,sale_price_usd numeric) WHERE is_public IS TRUE;
CREATE VIEW public.vehicle_observations WITH (security_invoker=true) AS SELECT * FROM jsonb_to_recordset(coalesce(nullif(current_setting('test.vehicle_observations',true),''),'[]')::jsonb) AS r(id uuid,vehicle_id uuid,kind text,content_text text,source_url text,extraction_method text,observed_at timestamptz,is_superseded boolean,structured_data jsonb,confidence_score numeric,ingested_at timestamptz,raw_source_ref text,extraction_metadata jsonb) WHERE EXISTS (SELECT FROM public.vehicles v WHERE v.id=r.vehicle_id);
CREATE VIEW public.field_evidence WITH (security_invoker=true) AS SELECT * FROM jsonb_to_recordset(coalesce(nullif(current_setting('test.field_evidence',true),''),'[]')::jsonb) AS r(vehicle_id uuid,field_name text,source_type text,source_confidence integer,extracted_at timestamptz,status text,proposed_value text) WHERE true;
CREATE VIEW public.timeline_events WITH (security_invoker=true) AS SELECT * FROM jsonb_to_recordset(coalesce(nullif(current_setting('test.timeline_events',true),''),'[]')::jsonb) AS r(vehicle_id uuid,event_date date,event_type text,created_at timestamptz) WHERE true;
CREATE VIEW public.ownership_verifications WITH (security_invoker=true) AS SELECT * FROM jsonb_to_recordset(coalesce(nullif(current_setting('test.ownership_verifications',true),''),'[]')::jsonb) AS r(vehicle_id uuid,user_id uuid,status text,title_document_url text,drivers_license_url text) WHERE true;
CREATE VIEW public.vehicle_contributors WITH (security_invoker=true) AS SELECT * FROM jsonb_to_recordset(coalesce(nullif(current_setting('test.vehicle_contributors',true),''),'[]')::jsonb) AS r(vehicle_id uuid,user_id uuid,role text,status text) WHERE true;
CREATE TYPE public.fixture_mark AS (trim_package text,series_code text,body_style text);
CREATE FUNCTION public.resolve_vehicle_identity_marks(text,text,integer,text,text,text) RETURNS SETOF public.fixture_mark LANGUAGE sql STABLE AS $$ SELECT NULL::public.fixture_mark WHERE false $$;
CREATE OR REPLACE FUNCTION public.vehicle_sale_basis(p_sale_status text, p_auction_outcome text, p_canonical_platform text, p_listing_url text, p_discovery_url text, p_sale_price numeric, p_notes text, p_import_metadata jsonb, p_created_at timestamp with time zone)
 RETURNS text
 LANGUAGE sql
 STABLE PARALLEL SAFE
AS $function$
  WITH x AS (
    SELECT
      CASE
        WHEN p_listing_url LIKE 'conceptcarz://%' OR p_listing_url LIKE 'https://conceptcarz://%' THEN 'conceptcarz'
        ELSE COALESCE(
          NULLIF(p_canonical_platform, 'unknown'),
          CASE
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'carsandbids\.com'     THEN 'cars-and-bids'
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'mecum\.com'           THEN 'mecum'
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'barrett-jackson\.com' THEN 'barrett-jackson'
            WHEN COALESCE(p_listing_url, p_discovery_url, '') ~* 'goodingco\.com'       THEN 'gooding'
            ELSE NULL
          END)
      END AS plat
  )
  SELECT CASE
    -- contradicting testimony: an explicit no-sale on the row means the sale is not proven (2026-09-27, part 4)
    WHEN p_auction_outcome IN ('reserve_not_met', 'no_sale')
      OR p_sale_status IN ('not_sold', 'unsold', 'bid_to')
      OR (plat = 'mecum' AND p_notes ~ 'Result: bid-goes-on')                                              THEN NULL
    -- the rule: a status says money moved
    WHEN p_sale_status = 'sold' OR p_auction_outcome = 'sold' THEN 'status'
    -- after the cutover nothing but a status counts
    WHEN p_created_at >= '2026-09-27 00:00:00+00'::timestamptz THEN NULL
    -- legacy rows: the platform's own sale marker, left on the row by the writer
    WHEN plat = 'mecum'           AND p_sale_price > 0 AND p_notes ~ 'Result: sold'                       THEN 'mecum_sale_result'
    WHEN plat = 'cars-and-bids'   AND p_sale_price > 0 AND p_import_metadata->>'auction_status' = 'sold'  THEN 'cab_auction_status'
    WHEN plat = 'gooding'         AND p_sale_price > 0                                                    THEN 'gooding_sale_price'
    WHEN plat = 'barrett-jackson' AND p_sale_price > 0
         AND p_auction_outcome IS DISTINCT FROM 'no_sale' AND p_sale_status IS DISTINCT FROM 'not_sold'   THEN 'bj_result_price'
    WHEN plat = 'conceptcarz'     AND p_sale_price > 0 AND p_notes ~ '"status": "sold"'                   THEN 'conceptcarz_sold'
    -- everything else (BaT, pcarmarket, bonhams, rm-sothebys, broad-arrow, hagerty, every classified,
    -- every aggregator, unknown): not a sale until a status proves it
    ELSE NULL
  END
  FROM x;
$function$;
CREATE OR REPLACE FUNCTION public.vehicle_profile_source_kind(p_source_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE
    WHEN s = '' OR s IN ('vehicle_record', 'system_update') THEN 'legacy'
    WHEN s ~ '(pixel|image|photo|plate|exif)' THEN 'image'
    WHEN s ~ '(listing|trailer|\ybat\y|auction|craigslist|classified|marketplace)' THEN 'listing'
    WHEN s ~ '(manual|documentation|corpus|spid|rpo|title|receipt|document|invoice)' THEN 'document'
    WHEN s ~ '(owner|user)' THEN 'owner'
    WHEN s ~ '(agent|llm|claude|gpt|vision|model)' THEN 'agent'
    ELSE 'legacy' END
  FROM (SELECT lower(coalesce(p_source_type, ''))) AS t(s);
$function$;
CREATE OR REPLACE FUNCTION public.vehicle_profile_kind_trust(p_kind text)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
AS $function$
  SELECT CASE p_kind
    WHEN 'owner' THEN 0.9 WHEN 'document' THEN 0.85 WHEN 'image' THEN 0.8 WHEN 'listing' THEN 0.6
    WHEN 'agent' THEN 0.5 WHEN 'model' THEN 0.4 ELSE 0.3 END;
$function$;
CREATE OR REPLACE FUNCTION public.vehicle_profile_claim(p_value jsonb, p_unit text, p_source_type text, p_confidence integer, p_observed_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
 SET search_path TO ''
 SET "TimeZone" TO 'UTC'
AS $function$
  SELECT jsonb_build_object(
           'value', p_value,
           'source', CASE WHEN p_source_type IS NULL
                          THEN jsonb_build_object('kind', 'legacy', 'label', 'vehicle record')
                          ELSE jsonb_build_object('kind', k.kind, 'label', replace(p_source_type, '_', ' '), 'method', p_source_type) END,
           'observed_at', CASE WHEN p_source_type IS NULL THEN NULL ELSE p_observed_at END,
           'trust', CASE WHEN p_source_type IS NULL THEN 0.3
                         WHEN p_confidence IS NOT NULL THEN round(least(1, greatest(0, p_confidence / 100.0)), 2)
                         ELSE public.vehicle_profile_kind_trust(k.kind) END)
         || CASE WHEN p_unit IS NULL THEN '{}'::jsonb ELSE jsonb_build_object('unit', p_unit) END
  FROM (SELECT public.vehicle_profile_source_kind(p_source_type) AS kind) k;
$function$;
CREATE OR REPLACE FUNCTION public.vehicle_price_facts(p_vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, price_kind text, price_amount numeric, price_as_of timestamp with time zone, price_live boolean, sold_amount numeric, sold_on date, sold_basis text, sold_amount_from text, ask_amount numeric, ask_as_of timestamp with time zone, bid_amount numeric, bid_on date, bid_from text, estimate_amount numeric, estimate_confidence integer, estimate_as_of timestamp with time zone, outcome text, platform text, source_url text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
AS $function$
  -- Keep the canonical sale basis once per selected vehicle. The SQL helper
  -- returns all twenty fields, so folding this stage repeats its source rule.
  WITH v AS MATERIALIZED (
    SELECT v.id, v.sale_status, v.auction_outcome, v.reserve_status,
           CASE WHEN public.vehicle_sale_price_untrusted_read(v.id) THEN NULL ELSE coalesce(v.sale_price_usd, v.sale_price) END AS sale_price, v.bat_sold_price, v.sold_price, v.winning_bid, v.high_bid,
           v.asking_price, v.sale_date, v.bat_sale_date, v.listing_updated_at, v.listing_posted_at,
           v.nuke_estimate, v.nuke_estimate_confidence, v.valuation_calculated_at,
           v.canonical_outcome, v.canonical_platform,
           COALESCE(v.listing_url, v.bat_auction_url, v.platform_url) AS source_url,
           vehicle_sale_basis(v.sale_status, v.auction_outcome, v.canonical_platform, v.listing_url,
                              v.discovery_url, v.sale_price::numeric, v.notes, v.import_metadata,
                              v.created_at) AS basis,
           v.auction_end_date
    FROM vehicles v
    WHERE v.id = ANY (p_vehicle_ids)
      AND v.deleted_at IS NULL
  ),
  dated AS (
    -- Leave date parsing inline: an unused malformed legacy date must retain
    -- the old lazy CASE behavior rather than becoming a new reader exception.
    SELECT v.*, CASE WHEN v.auction_end_date ~ '^\d{4}-\d{2}-\d{2}'
      THEN left(v.auction_end_date, 10)::date END AS auction_end_on
    FROM v
  ),
  f AS (
    SELECT v.*,
      CASE WHEN v.basis IS NOT NULL THEN COALESCE(NULLIF(v.sale_price, 0)::numeric, NULLIF(v.winning_bid, 0)::numeric,
                                                  NULLIF(v.bat_sold_price, 0)::numeric, NULLIF(v.sold_price, 0)::numeric)
      END AS f_sold_amount,
      CASE WHEN v.basis IS NOT NULL THEN
        CASE WHEN v.sale_price > 0 THEN 'sale_price' WHEN v.winning_bid > 0 THEN 'winning_bid'
             WHEN v.bat_sold_price > 0 THEN 'bat_sold_price' WHEN v.sold_price > 0 THEN 'sold_price' END
      END AS f_sold_from,
      CASE WHEN v.basis IS NOT NULL THEN COALESCE(v.sale_date, v.bat_sale_date, v.auction_end_on) END AS f_sold_on,
      NULLIF(v.asking_price, 0) AS f_ask,
      COALESCE(NULLIF(v.high_bid, 0), NULLIF(v.winning_bid, 0))::numeric AS f_bid,
      CASE WHEN v.high_bid > 0 THEN 'high_bid' WHEN v.winning_bid > 0 THEN 'winning_bid' END AS f_bid_from,
      NULLIF(v.nuke_estimate, 0) AS f_estimate,
      COALESCE(v.sale_status = 'auction_live', false) AS f_live,
      COALESCE(v.sale_status, '') NOT IN ('sold', 'ended', 'not_sold', 'unsold', 'bid_to', 'auction_live', 'upcoming')
        AS f_ask_active
    FROM dated v
  )
  SELECT
    f.id,
    CASE WHEN f.basis IS NOT NULL                     THEN 'sold'
         WHEN f.f_live AND f.f_bid IS NOT NULL        THEN 'bid'
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN 'ask'
         WHEN f.f_bid IS NOT NULL                     THEN 'bid'
         WHEN f.f_estimate IS NOT NULL                THEN 'estimate'
    END,
    CASE WHEN f.basis IS NOT NULL                     THEN f.f_sold_amount
         WHEN f.f_live AND f.f_bid IS NOT NULL        THEN f.f_bid
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN f.f_ask
         WHEN f.f_bid IS NOT NULL                     THEN f.f_bid
         ELSE f.f_estimate
    END,
    CASE WHEN f.basis IS NOT NULL                     THEN f.f_sold_on::timestamptz
         WHEN f.f_live AND f.f_bid IS NOT NULL        THEN NULL
         WHEN f.f_ask_active AND f.f_ask IS NOT NULL  THEN COALESCE(f.listing_updated_at, f.listing_posted_at)
         WHEN f.f_bid IS NOT NULL                     THEN f.auction_end_on::timestamptz
         ELSE f.valuation_calculated_at
    END,
    f.f_live,
    f.f_sold_amount, f.f_sold_on, f.basis, f.f_sold_from,
    f.f_ask, CASE WHEN f.f_ask IS NOT NULL THEN COALESCE(f.listing_updated_at, f.listing_posted_at) END,
    f.f_bid, CASE WHEN f.f_bid IS NOT NULL THEN f.auction_end_on END, f.f_bid_from,
    f.f_estimate, CASE WHEN f.f_estimate IS NOT NULL THEN f.nuke_estimate_confidence END,
    CASE WHEN f.f_estimate IS NOT NULL THEN f.valuation_calculated_at END,
    CASE WHEN f.basis IS NOT NULL THEN 'sold'
         WHEN f.sale_status IN ('not_sold', 'unsold', 'bid_to') OR f.reserve_status = 'reserve_not_met'
              OR f.auction_outcome IN ('reserve_not_met', 'no_sale')                          THEN 'reserve_not_met'
         WHEN f.sale_status IN ('auction_live', 'upcoming')                                   THEN 'active'
         WHEN f.sale_status = 'for_sale'
              OR (COALESCE(f.asking_price, 0) > 0 AND COALESCE(f.sale_status, 'available') NOT IN ('ended'))
                                                                                              THEN 'for_sale'
         WHEN f.sale_status = 'ended'                                                         THEN 'ended'
         WHEN f.sale_status = 'available' AND (COALESCE(f.high_bid, 0) > 0 OR COALESCE(f.winning_bid, 0) > 0)
                                                                                              THEN 'ended'
         ELSE 'unknown'
    END,
    f.canonical_platform, f.source_url
  FROM f;
$function$;
CREATE OR REPLACE FUNCTION public.vehicle_profile_read(p_vehicle_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO 'public', 'pg_temp'
 SET "TimeZone" TO 'UTC'
AS $function$
WITH v AS (
  SELECT id, user_id, owner_id, uploaded_by, entry_type,
         year, make, model, normalized_model, series, trim, transmission, transmission_model,
         mileage, mileage_source, canonical_body_style, body_style, engine_size, engine_type,
         drivetrain, city, state, location, listing_location, bat_location, discovery_url, listing_title
  FROM public.vehicles
  WHERE id = p_vehicle_id AND deleted_at IS NULL
),
-- The newest readable title claim per key whose quote is still the vehicle's title. Event time is unknown.
title_claims AS (
  SELECT DISTINCT ON (o.structured_data->>'property_key')
         o.structured_data->>'property_key' AS key,
         btrim(o.structured_data->>(o.structured_data->>'property_key')) AS value,
         jsonb_build_object(
           'value', btrim(o.structured_data->>(o.structured_data->>'property_key')),
           'source', jsonb_build_object('kind', 'listing', 'label', 'record title', 'method', o.extraction_method, 'url', o.source_url),
           'observed_at', NULL,
           'trust', o.confidence_score) AS member
  FROM v
  JOIN public.vehicle_observations o ON o.vehicle_id = v.id
  WHERE o.kind = 'specification'
    AND o.extraction_method = 'vehicle_title_facet_projection_v1'
    AND o.is_superseded IS NOT TRUE
    AND o.structured_data->>'claim_role' = 'record_label'
    AND o.structured_data->>'property_key' IN ('trim', 'body_style')
    AND o.structured_data->>'source_value' = v.listing_title
    AND nullif(btrim(o.structured_data->>(o.structured_data->>'property_key')), '') IS NOT NULL
  ORDER BY o.structured_data->>'property_key', o.confidence_score DESC NULLS LAST, o.ingested_at DESC
),
recorded AS (
  SELECT coalesce(nullif(btrim(v.trim), ''), (SELECT value FROM title_claims WHERE key = 'trim')) AS trim,
         coalesce(nullif(btrim(v.canonical_body_style), ''), nullif(btrim(v.body_style), ''),
                  (SELECT value FROM title_claims WHERE key = 'body_style')) AS body_style
  FROM v
),
who AS (SELECT (SELECT auth.uid()) AS uid),
viewer AS (
  SELECT CASE
    WHEN who.uid IS NULL THEN 'anon'
    WHEN (who.uid = v.user_id AND coalesce(v.entry_type, 'owner_claim') <> 'contributor_data') OR who.uid = v.owner_id
      OR EXISTS (SELECT 1 FROM public.ownership_verifications ov
                 WHERE ov.vehicle_id = v.id AND ov.user_id = who.uid AND ov.status = 'approved'
                   AND coalesce(ov.title_document_url, '') NOT IN ('', 'pending')
                   AND coalesce(ov.drivers_license_url, '') NOT IN ('', 'pending'))
      OR EXISTS (SELECT 1 FROM public.vehicle_contributors vc
                 WHERE vc.vehicle_id = v.id AND vc.user_id = who.uid AND vc.role = 'owner'
                   AND coalesce(vc.status, 'active') = 'active') THEN 'owner'
    WHEN who.uid = v.uploaded_by OR public.vehicle_user_has_access(v.id, who.uid) THEN 'contributor'
    ELSE 'anon' END AS viewer
  FROM v, who
),
-- Accepted evidence for the header's fields, as the viewer may read it.
evidence AS (
  SELECT field_name, source_type, source_confidence, extracted_at,
         lower(regexp_replace(btrim(proposed_value), '\s+', ' ', 'g')) AS norm
  FROM public.field_evidence
  WHERE vehicle_id = p_vehicle_id AND status = 'accepted' AND proposed_value IS NOT NULL
    AND field_name IN ('body_style', 'engine_size', 'engine_type', 'transmission', 'drivetrain', 'mileage')
),
-- The strip's dimensions in order, the value the record holds for each, and the evidence field it is attributed under.
facets AS (
  SELECT f.ord, f.dimension, f.field, f.title_case, btrim(x.value) AS value, x.claim
  FROM v
  CROSS JOIN (VALUES
    (0, 'trim',         NULL::text,     true),
    (1, 'body_style',   'body_style',   true),
    (2, 'engine',       'engine_size',  false),
    (3, 'transmission', 'transmission', true),
    (4, 'drivetrain',   'drivetrain',   false),
    (5, 'location',     NULL::text,     false)) AS f(ord, dimension, field, title_case)
  CROSS JOIN LATERAL (SELECT CASE f.dimension
      WHEN 'trim'         THEN CASE WHEN nullif(btrim(v.trim), '') IS NULL THEN (SELECT value FROM title_claims WHERE key = 'trim') END
      WHEN 'body_style'   THEN coalesce(nullif(v.canonical_body_style, ''), nullif(btrim(v.body_style), ''),
                                        (SELECT value FROM title_claims WHERE key = 'body_style'))
      WHEN 'engine'       THEN coalesce(nullif(btrim(v.engine_size), ''), nullif(btrim(v.engine_type), ''))
      WHEN 'transmission' THEN v.transmission
      WHEN 'drivetrain'   THEN v.drivetrain
      WHEN 'location'     THEN coalesce(
        nullif(concat_ws(', ', nullif(v.city, ''), nullif(v.state, '')), ''),
        nullif(btrim(v.location), ''),
        nullif(btrim(v.listing_location), ''),
        nullif(btrim(v.bat_location), '')
      )
    END AS value,
    CASE
      WHEN f.dimension = 'trim' AND nullif(btrim(v.trim), '') IS NULL
        THEN (SELECT member FROM title_claims WHERE key = 'trim')
      WHEN f.dimension = 'body_style' AND nullif(v.canonical_body_style, '') IS NULL AND nullif(btrim(v.body_style), '') IS NULL
        THEN (SELECT member FROM title_claims WHERE key = 'body_style')
    END AS claim) x
  WHERE x.value IS NOT NULL AND btrim(x.value) <> ''
),
-- The best accepted row whose value is what the record shows; otherwise the legacy claim.
claims AS (
  SELECT fa.ord, fa.dimension,
    CASE WHEN fa.title_case
      THEN (SELECT string_agg(CASE WHEN w ~ '^[A-Z0-9]{1,4}$' THEN w ELSE upper(left(w, 1)) || lower(substr(w, 2)) END, ' ' ORDER BY n)
            FROM regexp_split_to_table(fa.value, '\s+') WITH ORDINALITY AS t(w, n))
      ELSE fa.value END AS label,
    coalesce(fa.claim, public.vehicle_profile_claim(to_jsonb(fa.value), NULL, e.source_type, e.source_confidence, e.extracted_at)) AS member
  FROM facets fa
  LEFT JOIN LATERAL (
    SELECT e.source_type, e.source_confidence, e.extracted_at
    FROM evidence e
    WHERE fa.field IS NOT NULL
      AND (CASE WHEN fa.dimension = 'engine' THEN e.field_name IN ('engine_size', 'engine_type') ELSE e.field_name = fa.field END)
      AND e.norm = lower(regexp_replace(fa.value, '\s+', ' ', 'g'))
    ORDER BY e.source_confidence DESC NULLS LAST, e.extracted_at DESC NULLS LAST
    LIMIT 1) e ON true
),
-- A reading without a source is a guess, and a guess is not shown.
odometer AS (
  SELECT CASE
    WHEN v.mileage IS NULL OR v.mileage <= 0 THEN NULL
    WHEN e.source_type IS NOT NULL
      THEN public.vehicle_profile_claim(to_jsonb(v.mileage), 'mi', e.source_type, e.source_confidence, e.extracted_at)
    WHEN nullif(btrim(coalesce(v.mileage_source, '')), '') IS NOT NULL
      THEN jsonb_build_object('value', v.mileage, 'unit', 'mi',
             'source', jsonb_build_object('kind', k.kind, 'label', btrim(v.mileage_source)),
             'observed_at', NULL, 'trust', public.vehicle_profile_kind_trust(k.kind))
    ELSE NULL END AS claim
  FROM v
  LEFT JOIN LATERAL (
    SELECT e.source_type, e.source_confidence, e.extracted_at
    FROM evidence e
    WHERE e.field_name = 'mileage' AND e.norm = v.mileage::text
    ORDER BY e.source_confidence DESC NULLS LAST, e.extracted_at DESC NULLS LAST
    LIMIT 1) e ON true
  CROSS JOIN LATERAL (
    SELECT CASE WHEN s.sk = 'legacy' THEN 'listing' ELSE s.sk END AS kind
    FROM (SELECT public.vehicle_profile_source_kind(v.mileage_source) AS sk) s) k
),
-- The headline price as a claim: what kind of price, from which platform, as of when.
-- A recorded sale is not a bid is not an ask; an estimate is never presented as the car's price.
price AS (
  SELECT p.price_kind, p.price_amount, p.price_as_of, p.price_live, p.platform, p.source_url,
         lower(regexp_replace(coalesce(p.platform, ''), '[_\-\s]+', '', 'g')) IN
           ('craigslist', 'facebookmarketplace', 'ksl', 'kslclassifieds', 'classiccars', 'autotrader', 'carscom', 'dealersite') AS classified
  FROM public.vehicle_price_facts(ARRAY[p_vehicle_id]) p
  WHERE p.price_kind IN ('sold', 'bid', 'ask') AND p.price_amount > 0
  LIMIT 1
),
price_claim AS (
  SELECT jsonb_build_object(
           'value', p.price_amount,
           'unit', CASE WHEN p.classified THEN '' ELSE 'USD' END,
           'source', CASE WHEN cite.c IS NOT NULL
                          THEN jsonb_build_object('kind', 'document', 'url', NULL, 'label', cite.c->>'label', 'method', p.price_kind)
                          ELSE jsonb_build_object('kind', 'listing', 'url', coalesce(p.source_url, (SELECT discovery_url FROM v)),
                       'label', upper(regexp_replace(p.platform, '[-_]', ' ', 'g')), 'method', p.price_kind) END,
           'observed_at', p.price_as_of,
           'trust', CASE WHEN cite.c IS NOT NULL THEN 0.85 ELSE CASE p.price_kind WHEN 'sold' THEN 0.9 WHEN 'bid' THEN 0.7 ELSE 0.5 END END) AS claim,
         (CASE p.price_kind
            WHEN 'sold' THEN 'Last recorded sale'
            WHEN 'bid'  THEN CASE WHEN p.price_live THEN 'Current bid' ELSE 'High bid' END
            ELSE 'Asking' END)
         || CASE WHEN p.classified THEN ' · currency unrecorded' ELSE '' END AS label
  FROM price p
  LEFT JOIN LATERAL (SELECT public.vehicle_sale_citation(p_vehicle_id, p.price_amount) AS c WHERE p.price_kind = 'sold') cite ON true
),
shown AS (
  SELECT member AS c, ord FROM claims
  UNION ALL
  SELECT claim, 99 FROM odometer WHERE claim IS NOT NULL
),
strip AS (
  SELECT (SELECT count(*) FROM shown) AS shown,
         (SELECT count(*) FROM shown WHERE c->'source'->>'kind' <> 'legacy') AS attributed,
         (SELECT max((c->>'observed_at')::timestamptz) FROM shown) AS as_of,
         (SELECT coalesce(jsonb_agg(jsonb_build_object('dimension', dimension, 'label', label, 'member', member) ORDER BY ord), '[]'::jsonb)
          FROM claims) AS facets,
         (SELECT claim FROM odometer) AS odometer
),
-- The timeline as days × kinds: every dated event the viewer may read, folded to one row per day,
-- newest first, at most 1000 days. Coverage states how many of the vehicle's events the days carry.
timeline_days AS (
  SELECT d.day, d.kinds, d.n
  FROM (
    SELECT k.event_date AS day, jsonb_object_agg(k.kind, k.n ORDER BY k.kind) AS kinds, sum(k.n) AS n
    FROM (SELECT event_date, coalesce(nullif(btrim(event_type), ''), 'event') AS kind, count(*) AS n
          FROM public.timeline_events
          WHERE vehicle_id = p_vehicle_id AND event_date IS NOT NULL
          GROUP BY 1, 2) k
    GROUP BY k.event_date
    ORDER BY k.event_date DESC
    LIMIT 1000) d
),
timeline AS (
  SELECT (SELECT count(*) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id) AS total,
         (SELECT max(created_at) FROM public.timeline_events WHERE vehicle_id = p_vehicle_id) AS as_of,
         (SELECT coalesce(sum(n), 0) FROM timeline_days) AS dated,
         (SELECT coalesce(jsonb_agg(jsonb_build_object('day', day, 'kinds', kinds) ORDER BY day DESC), '[]'::jsonb) FROM timeline_days) AS days
),
-- The listing's full prose as captured: the newest description-capture observation the viewer may read. vehicles.description
-- is a short summary on some sources (BaT keeps 480 characters); the prose lives in the log, so the document carries it
-- beside the summary, with its source and clock. Absent when no capture is readable.
descr AS (
  SELECT jsonb_build_object(
           'text', o.content_text,
           'length', length(o.content_text),
           'source', jsonb_build_object('kind', 'listing', 'url', o.source_url, 'method', o.extraction_method),
           'observed_at', o.observed_at) AS d
  FROM public.vehicle_observations o
  WHERE o.vehicle_id = p_vehicle_id AND o.kind = 'listing'
    AND coalesce(o.is_superseded, false) = false
    AND o.structured_data ->> 'description_capture' = 'true'
    AND length(btrim(coalesce(o.content_text, ''))) > 0
  ORDER BY o.observed_at DESC NULLS LAST, length(o.content_text) DESC
  LIMIT 1
),
-- Vetted period-accurate factory marque emblems, series badges, trim plates, and body silhouettes.
identity_marks AS (
  SELECT coalesce(jsonb_agg(to_jsonb(r.m) ORDER BY r.ord), '[]'::jsonb) AS marks
  FROM v
  CROSS JOIN recorded rc
  CROSS JOIN LATERAL (
    SELECT lower(concat_ws(' ', v.model, v.normalized_model, v.series, rc.trim)) AS ident,
           lower(concat_ws(' ', v.model, v.normalized_model, rc.body_style)) AS body
  ) rec
  CROSS JOIN LATERAL (
    SELECT m, row_number() OVER () AS ord
    FROM public.resolve_vehicle_identity_marks(
      v.make,
      COALESCE(v.normalized_model, v.model),
      v.year,
      v.series,
      rc.trim,
      rc.body_style
    ) m
  ) r
  WHERE ((r.m).trim_package IS NULL
         OR position(lower(regexp_replace((r.m).trim_package, '\s*\(.*$', '')) in rec.ident) > 0)
    AND ((r.m).series_code IS NULL
         OR position(lower((r.m).series_code) in rec.ident) > 0
         OR position(lower(regexp_replace((r.m).series_code, '^C', 'K')) in rec.ident) > 0)
    AND ((r.m).body_style IS NULL
         OR EXISTS (SELECT 1 FROM regexp_split_to_table(lower((r.m).body_style), '\s*/\s*') p
                    WHERE p <> '' AND position(p in rec.body) > 0))
)
SELECT jsonb_build_object(
  'vehicle_id', v.id,
  'viewer', (SELECT viewer FROM viewer),
  'read_at', now(),
  'description', (SELECT d FROM descr),
  'identity_marks', (SELECT marks FROM identity_marks),
  'sections',
    jsonb_build_array(jsonb_build_object(
      'kind', 'masthead',
      'identity_source', jsonb_build_object(
        'year', v.year, 'make', v.make, 'model', v.model, 'normalized_model', v.normalized_model,
        'series', v.series, 'trim', v.trim, 'transmission', v.transmission, 'transmission_model', v.transmission_model),
      'year', v.year, 'make', v.make, 'model', v.model,
      'price', (SELECT claim FROM price_claim),
      'priceLabel', (SELECT label FROM price_claim),
      'identity_marks', (SELECT marks FROM identity_marks)))
    || CASE WHEN s.shown > 0 THEN jsonb_build_array(jsonb_build_object(
      'kind', 'strip',
      'coverage', jsonb_build_object('n', s.attributed, 'of', s.shown, 'grain', 'facts attributed', 'as_of', s.as_of),
      'facets', s.facets,
      'odometer', s.odometer)) ELSE '[]'::jsonb END
    || CASE WHEN t.total > 0 THEN jsonb_build_array(jsonb_build_object(
      'kind', 'timeline',
      'coverage', jsonb_build_object('n', t.dated, 'of', t.total, 'grain', 'events dated', 'as_of', t.as_of),
      'days', t.days)) ELSE '[]'::jsonb END)
FROM v, strip s, timeline t;
$function$;
SELECT set_config('test.vehicles',$rows$[{"id": "10000000-0000-0000-0000-000000000001", "is_public": true, "year": 1995, "make": "Ford", "model": "F150", "engine_size": "5.0L V8", "transmission": "Automatic", "mileage": 12000, "asking_price": 16995, "sale_status": "for_sale", "canonical_platform": "streetside_classics", "listing_url": "https://www.streetsideclassics.com/vehicles/42-det/1995-ford-f150", "created_at": "2026-10-30T00:00:00Z"}]$rows$,false);
SELECT set_config('test.vehicle_observations',$rows$[{"id": "20000000-0000-0000-0000-000000000001", "vehicle_id": "10000000-0000-0000-0000-000000000001", "kind": "listing", "content_text": "Retained dealer description", "source_url": "https://www.streetsideclassics.com/vehicles/42-det/1995-ford-f150", "extraction_method": "dealer_microdata_v2", "observed_at": "2026-10-30T12:00:00Z", "ingested_at": "2026-10-30T13:00:00Z", "is_superseded": false, "raw_source_ref": "listing_page_snapshots:30000000-0000-0000-0000-000000000001", "extraction_metadata": {"snapshot_id": "30000000-0000-0000-0000-000000000001", "source_capture_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, "structured_data": {"platform": "streetside_classics", "source_claims_only": true, "price_currency": "USD", "asking_price": 16995, "engine": "5.0L V8", "transmission": "Automatic", "mileage": 12000, "source_mileage": {"unitCode": "SMI"}, "description": "Retained dealer description"}}]$rows$,false);
DO $$ BEGIN ASSERT (SELECT price_as_of IS NULL FROM vehicle_price_facts(ARRAY['10000000-0000-0000-0000-000000000001'::uuid])), 'baseline lacks retained ask clock'; END $$;
\ir ../migrations/20261031074000_native_listing_profile_evidence.sql
\ir ../migrations/20261031074000_native_listing_profile_evidence.sql
DO $$ BEGIN ASSERT (SELECT price_amount=16995 AND price_kind='ask' AND price_as_of='2026-10-30T12:00:00Z'::timestamptz FROM vehicle_price_facts(ARRAY['10000000-0000-0000-0000-000000000001'::uuid])), 'matching asking price carries original source clock'; END $$;
DO $$ BEGIN ASSERT vehicle_profile_read('10000000-0000-0000-0000-000000000001'::uuid)->'description'->>'text'='Retained dealer description', 'retained native prose reaches profile'; END $$;
DO $$ BEGIN ASSERT vehicle_profile_read('10000000-0000-0000-0000-000000000001'::uuid)#>>'{sections,1,facets,0,member,source,method}'='dealer_microdata_v2', 'engine shows native provenance'; END $$;
DO $$ BEGIN ASSERT vehicle_profile_read('10000000-0000-0000-0000-000000000001'::uuid)#>>'{sections,1,odometer,unit}'='mi', 'qualified native odometer has units'; END $$;
SELECT set_config('test.vehicle_observations',$rows$[{"id": "20000000-0000-0000-0000-000000000001", "vehicle_id": "10000000-0000-0000-0000-000000000001", "kind": "listing", "content_text": "Retained dealer description", "source_url": "https://www.streetsideclassics.com/vehicles/42-det/1995-ford-f150", "extraction_method": "dealer_microdata_v2", "observed_at": "2026-10-30T12:00:00Z", "ingested_at": "2026-10-30T13:00:00Z", "is_superseded": true, "raw_source_ref": "listing_page_snapshots:30000000-0000-0000-0000-000000000001", "extraction_metadata": {"snapshot_id": "30000000-0000-0000-0000-000000000001", "source_capture_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, "structured_data": {"platform": "streetside_classics", "source_claims_only": true, "price_currency": "USD", "asking_price": 16995, "engine": "5.0L V8", "transmission": "Automatic", "mileage": 12000, "source_mileage": {"unitCode": "SMI"}, "description": "Retained dealer description"}}]$rows$,false);
DO $$ BEGIN ASSERT (SELECT price_as_of IS NULL FROM vehicle_price_facts(ARRAY['10000000-0000-0000-0000-000000000001'::uuid])), 'superseded cannot qualify asking clock'; END $$;
SELECT set_config('test.vehicle_observations',$rows$[{"id": "20000000-0000-0000-0000-000000000001", "vehicle_id": "10000000-0000-0000-0000-000000000001", "kind": "listing", "content_text": "Retained dealer description", "source_url": "https://www.streetsideclassics.com/vehicles/42-det/1995-ford-f150-other", "extraction_method": "dealer_microdata_v2", "observed_at": "2026-10-30T12:00:00Z", "ingested_at": "2026-10-30T13:00:00Z", "is_superseded": false, "raw_source_ref": "listing_page_snapshots:30000000-0000-0000-0000-000000000001", "extraction_metadata": {"snapshot_id": "30000000-0000-0000-0000-000000000001", "source_capture_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, "structured_data": {"platform": "streetside_classics", "source_claims_only": true, "price_currency": "USD", "asking_price": 16995, "engine": "5.0L V8", "transmission": "Automatic", "mileage": 12000, "source_mileage": {"unitCode": "SMI"}, "description": "Retained dealer description"}}]$rows$,false);
DO $$ BEGIN ASSERT (SELECT price_as_of IS NULL FROM vehicle_price_facts(ARRAY['10000000-0000-0000-0000-000000000001'::uuid])), 'other-source cannot qualify asking clock'; END $$;
SELECT set_config('test.vehicle_observations',$rows$[{"id": "20000000-0000-0000-0000-000000000001", "vehicle_id": "10000000-0000-0000-0000-000000000001", "kind": "listing", "content_text": "Retained dealer description", "source_url": "https://www.streetsideclassics.com/vehicles/42-det/1995-ford-f150", "extraction_method": "dealer_microdata_v2", "observed_at": "2026-10-30T12:00:00Z", "ingested_at": "2026-10-30T13:00:00Z", "is_superseded": false, "raw_source_ref": "listing_page_snapshots:30000000-0000-0000-0000-000000000001", "extraction_metadata": {"snapshot_id": "30000000-0000-0000-0000-000000000001", "source_capture_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, "structured_data": {"platform": "streetside_classics", "source_claims_only": true, "price_currency": "USD", "asking_price": 19995, "engine": "5.0L V8", "transmission": "Automatic", "mileage": 12000, "source_mileage": {"unitCode": "SMI"}, "description": "Retained dealer description"}}]$rows$,false);
DO $$ BEGIN ASSERT (SELECT price_as_of IS NULL FROM vehicle_price_facts(ARRAY['10000000-0000-0000-0000-000000000001'::uuid])), 'other-amount cannot qualify asking clock'; END $$;
SELECT set_config('test.vehicle_observations',$rows$[{"id": "20000000-0000-0000-0000-000000000001", "vehicle_id": "10000000-0000-0000-0000-000000000001", "kind": "listing", "content_text": "Retained dealer description", "source_url": "https://www.streetsideclassics.com/vehicles/42-det/1995-ford-f150", "extraction_method": "dealer_microdata_v2", "observed_at": "2026-10-30T12:00:00Z", "ingested_at": "2026-10-30T13:00:00Z", "is_superseded": false, "raw_source_ref": "listing_page_snapshots:30000000-0000-0000-0000-000000000001", "extraction_metadata": {"snapshot_id": "30000000-0000-0000-0000-000000000001", "source_capture_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, "structured_data": {"platform": "streetside_classics", "source_claims_only": true, "price_currency": "CAD", "asking_price": 16995, "engine": "5.0L V8", "transmission": "Automatic", "mileage": 12000, "source_mileage": {"unitCode": "SMI"}, "description": "Retained dealer description"}}]$rows$,false);
DO $$ BEGIN ASSERT (SELECT price_as_of IS NULL FROM vehicle_price_facts(ARRAY['10000000-0000-0000-0000-000000000001'::uuid])), 'other-currency cannot qualify asking clock'; END $$;
SELECT set_config('test.vehicle_observations',$rows$[{"id": "20000000-0000-0000-0000-000000000001", "vehicle_id": "10000000-0000-0000-0000-000000000001", "kind": "listing", "content_text": "Retained dealer description", "source_url": "https://www.streetsideclassics.com/vehicles/42-det/1995-ford-f150", "extraction_method": "dealer_microdata_v2", "observed_at": "2026-10-30T12:00:00Z", "ingested_at": "2026-10-30T13:00:00Z", "is_superseded": false, "raw_source_ref": "unrelated", "extraction_metadata": {"snapshot_id": "30000000-0000-0000-0000-000000000001", "source_capture_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, "structured_data": {"platform": "streetside_classics", "source_claims_only": true, "price_currency": "USD", "asking_price": 16995, "engine": "5.0L V8", "transmission": "Automatic", "mileage": 12000, "source_mileage": {"unitCode": "SMI"}, "description": "Retained dealer description"}}]$rows$,false);
DO $$ BEGIN ASSERT (SELECT price_as_of IS NULL FROM vehicle_price_facts(ARRAY['10000000-0000-0000-0000-000000000001'::uuid])), 'invalid-custody cannot qualify asking clock'; END $$;
SELECT set_config('test.vehicle_observations',$rows$[{"id": "20000000-0000-0000-0000-000000000001", "vehicle_id": "10000000-0000-0000-0000-000000000001", "kind": "listing", "content_text": "Retained dealer description", "source_url": "https://www.streetsideclassics.com/vehicles/42-det/1995-ford-f150", "extraction_method": "dealer_microdata_v2", "observed_at": "2026-10-30T12:00:00Z", "ingested_at": "2026-10-30T13:00:00Z", "is_superseded": false, "raw_source_ref": "listing_page_snapshots:30000000-0000-0000-0000-000000000001", "extraction_metadata": {"snapshot_id": "30000000-0000-0000-0000-000000000001", "source_capture_sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}, "structured_data": {"platform": "streetside_classics", "source_claims_only": true, "price_currency": "USD", "asking_price": 16995, "engine": "5.0L V8", "transmission": "Automatic", "mileage": 12000, "source_mileage": {"unitCode": "SMI"}, "description": "Retained dealer description"}}]$rows$,false);
SELECT set_config('test.field_evidence',$rows$[{"vehicle_id": "10000000-0000-0000-0000-000000000001", "field_name": "engine_size", "source_type": "factory_service_manual", "source_confidence": 95, "extracted_at": "2026-10-29T00:00:00Z", "status": "accepted", "proposed_value": "5.0L V8"}]$rows$,false);
DO $$ BEGIN ASSERT vehicle_profile_read('10000000-0000-0000-0000-000000000001'::uuid)#>>'{sections,1,facets,0,member,source,method}'='factory_service_manual', 'accepted evidence retains priority'; END $$;
SELECT set_config('test.vehicles',$rows$[{"id": "10000000-0000-0000-0000-000000000001", "is_public": true, "year": 1995, "make": "Ford", "model": "F150", "engine_size": "5.0L V8", "transmission": "Automatic", "mileage": 12000, "asking_price": 16995, "sale_status": "sold", "canonical_platform": "streetside_classics", "listing_url": "https://www.streetsideclassics.com/vehicles/42-det/1995-ford-f150", "created_at": "2026-10-30T00:00:00Z", "sale_price": 25000, "sale_date": "2026-10-29"}]$rows$,false);
DO $$ BEGIN ASSERT (SELECT price_kind='sold' AND price_amount=25000 AND price_as_of='2026-10-29'::timestamptz FROM vehicle_price_facts(ARRAY['10000000-0000-0000-0000-000000000001'::uuid])), 'sold priority and date unchanged'; END $$;
SELECT set_config('test.vehicles',$rows$[{"id": "10000000-0000-0000-0000-000000000001", "is_public": true, "year": 1995, "make": "Ford", "model": "F150", "engine_size": "5.0L V8", "transmission": "Automatic", "mileage": 12000, "asking_price": 16995, "sale_status": "auction_live", "canonical_platform": "streetside_classics", "listing_url": "https://www.streetsideclassics.com/vehicles/42-det/1995-ford-f150", "created_at": "2026-10-30T00:00:00Z", "high_bid": 15000}]$rows$,false);
DO $$ BEGIN ASSERT (SELECT price_kind='bid' AND price_amount=15000 AND price_as_of IS NULL FROM vehicle_price_facts(ARRAY['10000000-0000-0000-0000-000000000001'::uuid])), 'live bid priority unchanged'; END $$;
SELECT set_config('test.vehicles',$rows$[{"id": "10000000-0000-0000-0000-000000000001", "is_public": false, "year": 1995, "make": "Ford", "model": "F150", "engine_size": "5.0L V8", "transmission": "Automatic", "mileage": 12000, "asking_price": 16995, "sale_status": "for_sale", "canonical_platform": "streetside_classics", "listing_url": "https://www.streetsideclassics.com/vehicles/42-det/1995-ford-f150", "created_at": "2026-10-30T00:00:00Z"}]$rows$,false);
DO $$ BEGIN ASSERT vehicle_profile_read('10000000-0000-0000-0000-000000000001'::uuid) IS NULL, 'hidden vehicle remains absent through reader'; END $$;
SELECT 'native reader positive, refusal, priority and reapply checks passed' AS result;
