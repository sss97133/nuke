-- Run in the SAME psql session immediately after
-- scripts/discovery/valuation-source-sale-receipt-test.sql, in its disposable DB.
\set ON_ERROR_STOP on
DO $$ BEGIN
 IF current_database()<>'dm_refinement_sale_receipt' THEN RAISE EXCEPTION 'Disposable source-receipt database only'; END IF;
END $$;
SELECT pg_temp.base();
SELECT pg_temp.seed(11,'{"date":"2025-07-15","fetched_at":"2025-07-16T00:00:00Z","ingested_at":"2025-07-16T06:00:00Z","protected_parsed_at":"2025-07-16T12:00:00Z","parsed_at":"2025-07-16T12:00:00Z"}');
CREATE TABLE public.vehicle_location_observations(
 id uuid PRIMARY KEY,vehicle_id uuid,source_type text,source_url text,observed_at timestamptz,
 created_at timestamptz,country_code text,confidence real,county_fips text
);
CREATE INDEX ON public.vehicle_location_observations(vehicle_id,observed_at DESC);
CREATE TABLE public.us_county_boundaries(fips text PRIMARY KEY);
INSERT INTO public.us_county_boundaries VALUES('32003');
INSERT INTO public.vehicle_location_observations VALUES(md5('location-11')::uuid,md5('vehicle-11')::uuid,
 'listing','https://bringatrailer.com/listing/synthetic-11/','2025-07-16','2025-07-16',NULL,0.9,'32003');
\ir ../migrations/20261007183841_sale_residuals_by_ymm.sql
\ir ../migrations/20261007191200_qualify_sale_residual_county_country.sql
DO $$ DECLARE r jsonb:=sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-07-01'); BEGIN
 PERFORM pg_temp.ok('real source parser and price owner feed the residual baseline',
 r#>>'{baseline,n}'='10' AND (r#>>'{baseline,median}')::numeric=5500);
 PERFORM pg_temp.ok('real source receipt reaches residual and canonical US county with unknown country',
 r#>>'{coverage,residuals}'='1' AND abs((r#>>'{sales,0,log_residual}')::numeric-ln(2::numeric))<0.000000001
 AND r#>>'{sales,0,county_fips}'='32003'
 AND r#>>'{sales,0,snapshot_id}'=md5('snapshot-11')::uuid::text);
END $$;
-- Source hash failure must remove the sale; the fold must not fall back to vehicles.sale_price.
UPDATE public.listing_page_snapshots SET html=html||'tampered' WHERE id=md5('snapshot-11')::uuid;
SELECT pg_temp.ok('raw hash failure cannot leak a vehicle scalar into residuals',
 sale_residuals_by_ymm(1970,'Synthetic','Coupe','2025-07-01')#>>'{coverage,qualified_target_sales}'='0');
