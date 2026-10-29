-- Captured live reader shape on 2026-10-25; synthetic disposable PG17 fixture only.
-- This is not a replacement for the canonical price or source writers.
CREATE TABLE public.canonical_makes (
  "id" uuid,
  "canonical_name" text
);
CREATE TABLE public.clean_vehicle_prices (
  "vehicle_id" uuid,
  "best_price" numeric,
  "price_source" text,
  "is_sold" boolean
);
CREATE TABLE public.nuke_estimates (
  "id" uuid,
  "vehicle_id" uuid,
  "estimated_value" numeric(12,2),
  "value_low" numeric(12,2),
  "value_high" numeric(12,2),
  "confidence_score" integer,
  "price_tier" text,
  "deal_score" numeric(5,2),
  "deal_score_label" text,
  "heat_score" numeric(5,2),
  "heat_score_label" text,
  "model_version" text,
  "calculated_at" timestamp with time zone,
  "is_stale" boolean
);
CREATE TABLE public.record_prices (
  "make" text,
  "model" text,
  "year_start" integer,
  "year_end" integer,
  "record_price" numeric(12,2),
  "record_vehicle_id" uuid
);
CREATE TABLE public.vehicle_sale_price_untrusted_ids (
  "vehicle_id" uuid
);
CREATE TABLE public.vehicles (
  "id" uuid,
  "make" text,
  "model" text,
  "year" integer,
  "vin" text,
  "mileage" integer,
  "transmission" text,
  "drivetrain" text,
  "body_style" text,
  "current_value" numeric(10,2),
  "created_at" timestamp with time zone,
  "updated_at" timestamp with time zone,
  "sale_price" integer,
  "auction_end_date" text,
  "discovery_source" text,
  "discovery_url" text,
  "sale_status" text,
  "sale_date" date,
  "status" text,
  "is_for_sale" boolean,
  "deleted_at" timestamp with time zone,
  "asking_price" numeric,
  "trim" text,
  "city" text,
  "state" text,
  "primary_image_url" text,
  "platform_source" text,
  "profile_origin" text,
  "origin_organization_id" uuid,
  "series" text,
  "listing_location" text,
  "canonical_vehicle_type" text,
  "canonical_body_style" text,
  "canonical_make_id" uuid,
  "observation_count" integer,
  "has_photos" boolean,
  "sale_price_currency" text,
  "sale_price_usd" numeric,
  is_public boolean DEFAULT true,
  listing_kind text,
  owner_id uuid
);
ALTER TABLE public.vehicles ADD PRIMARY KEY (id);
CREATE FUNCTION public.safe_to_timestamptz(value text) RETURNS timestamptz LANGUAGE sql STABLE AS $$ SELECT value::timestamptz $$;
CREATE TABLE public.non_auto_makes_excluded(make text);
CREATE MATERIALIZED VIEW public.vehicle_valuation_feed AS
 SELECT v.id AS vehicle_id,
    v.year,
    COALESCE(cm.canonical_name, v.make) AS make,
    v.model,
    v.series,
    v."trim",
    v.transmission,
    v.drivetrain,
    v.body_style,
    v.canonical_body_style,
    v.mileage,
    v.vin,
    v.is_for_sale,
    v.sale_status,
    v.sale_date,
    v.created_at,
    v.updated_at,
    ae.auction_end_at,
    COALESCE(v.sale_date::timestamp with time zone, ae.auction_end_at, v.created_at) AS event_at,
    v.discovery_url,
    COALESCE(v.platform_source, v.discovery_source) AS discovery_source,
    v.profile_origin,
    v.origin_organization_id,
    v.city,
    v.state,
    v.listing_location,
    v.canonical_vehicle_type,
    v.has_photos,
    v.primary_image_url,
    NULL::text AS thumbnail_url,
    NULL::text AS medium_url,
    v.primary_image_url AS full_image_url,
    NULL::text AS description_snippet,
    COALESCE(v.observation_count, 0)::bigint AS observation_count,
    NULL::bigint AS source_count,
    NULL::bigint AS photo_count,
    cvp.best_price AS display_price,
    cvp.price_source,
    cvp.is_sold,
    v.asking_price,
        CASE
            WHEN uu.vehicle_id IS NOT NULL THEN NULL::numeric
            WHEN COALESCE(v.sale_price_currency, 'USD'::text) = 'USD'::text THEN v.sale_price::numeric
            ELSE round(v.sale_price_usd)
        END::integer AS sale_price,
    v.current_value,
    ne.estimated_value AS nuke_estimate,
    ne.value_low AS nuke_estimate_low,
    ne.value_high AS nuke_estimate_high,
    ne.confidence_score AS nuke_estimate_confidence,
    ne.price_tier,
    ne.deal_score,
    ne.deal_score_label,
    ne.heat_score,
    ne.heat_score_label,
    ne.model_version,
    ne.calculated_at AS valuation_calculated_at,
        CASE
            WHEN rp.record_vehicle_id = v.id THEN true
            ELSE false
        END AS is_record_price,
    rp.record_price AS segment_record_price,
    COALESCE(ne.deal_score, 50::numeric) *
        CASE
            WHEN COALESCE(v.sale_date::timestamp with time zone, ae.auction_end_at, v.created_at) > (now() - '1 day'::interval) THEN 1.0
            WHEN COALESCE(v.sale_date::timestamp with time zone, ae.auction_end_at, v.created_at) > (now() - '3 days'::interval) THEN 0.95
            WHEN COALESCE(v.sale_date::timestamp with time zone, ae.auction_end_at, v.created_at) > (now() - '7 days'::interval) THEN 0.85
            WHEN COALESCE(v.sale_date::timestamp with time zone, ae.auction_end_at, v.created_at) > (now() - '30 days'::interval) THEN 0.50
            ELSE 0.30
        END + COALESCE(ne.heat_score, 0::numeric) * 0.3 +
        CASE
            WHEN v.sale_status = 'auction_live'::text THEN 200
            WHEN v.is_for_sale = true THEN 80
            ELSE 0
        END::numeric +
        CASE
            WHEN COALESCE(v.platform_source, v.discovery_source) = ANY (ARRAY['bringatrailer'::text, 'bat'::text]) THEN 100
            WHEN COALESCE(v.platform_source, v.discovery_source) = ANY (ARRAY['cars-and-bids'::text, 'cars_and_bids'::text, 'collecting-cars'::text, 'collecting_cars'::text, 'mecum'::text, 'barrett-jackson'::text, 'barrett_jackson'::text, 'rmsothebys'::text, 'gooding'::text, 'bonhams'::text]) THEN 80
            WHEN COALESCE(v.platform_source, v.discovery_source) = ANY (ARRAY['pcarmarket'::text, 'hagerty'::text, 'hemmings'::text]) THEN 60
            WHEN COALESCE(v.platform_source, v.discovery_source) = ANY (ARRAY['facebook_marketplace'::text, 'facebook'::text]) THEN '-30'::integer
            ELSE 20
        END::numeric +
        CASE
            WHEN v.has_photos THEN 20
            ELSE 0
        END::numeric AS feed_rank_score
   FROM vehicles v
     CROSS JOIN LATERAL ( SELECT
                CASE
                    WHEN v.auction_end_date IS NULL THEN NULL::timestamp with time zone
                    ELSE safe_to_timestamptz(v.auction_end_date)
                END AS auction_end_at) ae
     LEFT JOIN canonical_makes cm ON v.canonical_make_id = cm.id
     LEFT JOIN vehicle_sale_price_untrusted_ids uu ON uu.vehicle_id = v.id
     LEFT JOIN clean_vehicle_prices cvp ON cvp.vehicle_id = v.id
     LEFT JOIN nuke_estimates ne ON ne.vehicle_id = v.id
     LEFT JOIN record_prices rp ON COALESCE(cm.canonical_name, v.make) = rp.make AND v.model = rp.model AND v.year >= rp.year_start AND v.year <= rp.year_end
  WHERE v.deleted_at IS NULL AND (v.status <> ALL (ARRAY['deleted'::text, 'merged'::text, 'duplicate'::text])) AND (ne.is_stale IS NOT TRUE OR ne.id IS NULL) AND v.year IS NOT NULL AND v.make IS NOT NULL AND NOT (upper(COALESCE(cm.canonical_name, v.make)) IN ( SELECT upper(non_auto_makes_excluded.make) AS upper
           FROM non_auto_makes_excluded));
CREATE UNIQUE INDEX idx_vvf_vehicle_id ON public.vehicle_valuation_feed(vehicle_id);
CREATE INDEX idx_vvf_event_at ON public.vehicle_valuation_feed(event_at DESC,vehicle_id);
CREATE INDEX idx_vvf_feed_rank_vid ON public.vehicle_valuation_feed(feed_rank_score DESC,vehicle_id);
CREATE INDEX idx_vvf_created ON public.vehicle_valuation_feed(created_at DESC);
CREATE INDEX idx_vvf_display_price ON public.vehicle_valuation_feed(display_price);
CREATE INDEX idx_vvf_feed_rank ON public.vehicle_valuation_feed(feed_rank_score DESC);
CREATE INDEX idx_vvf_has_photos ON public.vehicle_valuation_feed(has_photos);
CREATE INDEX idx_vvf_make ON public.vehicle_valuation_feed(make);
CREATE INDEX idx_vvf_source ON public.vehicle_valuation_feed(discovery_source);
CREATE INDEX idx_vvf_updated ON public.vehicle_valuation_feed(updated_at DESC);
CREATE INDEX idx_vvf_vehicle_type ON public.vehicle_valuation_feed(canonical_vehicle_type);
CREATE INDEX idx_vvf_year ON public.vehicle_valuation_feed(year);
GRANT ALL ON public.vehicle_valuation_feed TO anon,authenticated,service_role;
CREATE OR REPLACE FUNCTION public.refresh_vehicle_valuation_feed_safe()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  SET LOCAL statement_timeout = '600000'; -- 10 min
  REFRESH MATERIALIZED VIEW CONCURRENTLY vehicle_valuation_feed;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_vehicle_valuation_feed_safe() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.refresh_vehicle_valuation_feed_safe() TO service_role;
CREATE SCHEMA cron;
CREATE TABLE cron.job(jobid bigint PRIMARY KEY,jobname text UNIQUE,command text,schedule text,active boolean);
INSERT INTO cron.job VALUES (447,'refresh-feed-mv','SET statement_timeout = ''300s''; SET work_mem = ''256MB''; SET max_parallel_workers_per_gather = 0; SET enable_indexscan = off; SET enable_bitmapscan = off; SET enable_nestloop = off; REFRESH MATERIALIZED VIEW CONCURRENTLY public.vehicle_valuation_feed;','35 */6 * * *',true);
CREATE FUNCTION cron.alter_job(job_id bigint,schedule text DEFAULT NULL,command text DEFAULT NULL,database text DEFAULT NULL,username text DEFAULT NULL,active boolean DEFAULT NULL) RETURNS void LANGUAGE plpgsql AS $fn$
BEGIN UPDATE cron.job j SET command=coalesce(alter_job.command,j.command),schedule=coalesce(alter_job.schedule,j.schedule),active=coalesce(alter_job.active,j.active) WHERE j.jobid=job_id; END;
$fn$;
