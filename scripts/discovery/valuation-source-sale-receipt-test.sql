-- Synthetic contract test. Run with psql -v ON_ERROR_STOP=1 -f this file
-- ONLY against a disposable database named dm_refinement_sale_receipt.
-- No production rows, credentials, testimony intake or paid inference.
\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'dm_refinement_sale_receipt' OR EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='auth') THEN
    RAISE EXCEPTION 'Refusing to install fixtures outside the isolated synthetic database';
  END IF;
END $$;
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
DO $$ DECLARE r text; BEGIN
  FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('CREATE ROLE %I',r); END IF;
  END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO anon,authenticated,service_role;
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, year integer, make text, model text, is_public boolean DEFAULT true, deleted_at timestamptz,
  listing_kind text, origin_metadata jsonb, body_style text, engine_type text, transmission text,
  condition_rating integer, primary_image_url text, sale_status text, auction_outcome text, reserve_status text,
  sale_price numeric, bat_sold_price numeric, sold_price numeric, winning_bid numeric, high_bid numeric,
  asking_price numeric, sale_date date, bat_sale_date date, listing_updated_at timestamptz,
  listing_posted_at timestamptz, nuke_estimate numeric, nuke_estimate_confidence integer,
  valuation_calculated_at timestamptz, canonical_outcome text, canonical_platform text,
  listing_url text, bat_auction_url text, platform_url text, discovery_url text, notes text,
  import_metadata jsonb, created_at timestamptz DEFAULT now(), auction_end_date text
);
CREATE INDEX ON public.vehicles(lower(make),year,lower(model));
CREATE TABLE public.listing_page_snapshots (
  id uuid PRIMARY KEY, listing_url text, fetched_at timestamptz, success boolean, http_status integer, html text, platform text, metadata jsonb, html_sha256 text, created_at timestamptz NOT NULL
);
ALTER TABLE public.listing_page_snapshots ENABLE ROW LEVEL SECURITY;
GRANT SELECT ON public.listing_page_snapshots TO anon,authenticated;
-- No public raw-snapshot policy: the reader may return sanitized attribution only.
CREATE TABLE public.make_model_profiles(subject_id uuid PRIMARY KEY,grain text,year integer,canonical_make text,canonical_model text);
INSERT INTO public.make_model_profiles VALUES ('11111111-1111-1111-1111-111111111111','year',1970,'Synthetic','Coupe');
CREATE FUNCTION public.cohort_members(p_subject uuid) RETURNS TABLE(vehicle_id uuid) LANGUAGE sql AS $$
  SELECT v.id FROM public.vehicles v JOIN public.make_model_profiles m ON m.subject_id=p_subject
  WHERE v.year=m.year AND lower(v.make)=lower(m.canonical_make) AND lower(v.model)=lower(m.canonical_model)
$$;
-- Minimal dependency fixture for the existing status contract, not a replacement owner.
CREATE FUNCTION public.vehicle_sale_basis(text,text,text,text,text,numeric,text,jsonb,timestamptz)
RETURNS text LANGUAGE sql AS $$ SELECT CASE WHEN $1 IN ('not_sold','unsold','bid_to') OR $2 IN ('reserve_not_met','no_sale') THEN NULL
  WHEN $1='sold' OR $2='sold' THEN 'status' END $$;
-- Execute the actual current price reader, rather than a hand-built price return fixture.
\ir ../../supabase/migrations/20260928224500_vehicle_price_facts_live_outcome.sql
CREATE FUNCTION public.valuation_by_ymm(integer DEFAULT NULL,text DEFAULT NULL,text DEFAULT NULL) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
\ir ../../supabase/migrations/20261004073000_valuation_source_sale_receipt.sql

CREATE FUNCTION pg_temp.seed(n integer,d jsonb DEFAULT '{}'::jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE vid uuid:=md5('vehicle-'||n)::uuid; sid uuid:=md5('snapshot-'||n)::uuid;
  source_url text:=coalesce(d->>'source_url','https://bringatrailer.com/listing/synthetic-'||coalesce(d->>'source_number',n::text)||'/');
  amount numeric:=coalesce((d->>'amount')::numeric,n*1000);
  sale_day date:=coalesce((d->>'date')::date,'2025-06-15');
BEGIN
  INSERT INTO public.listing_page_snapshots VALUES (sid,coalesce(d->>'snapshot_url',source_url),
    coalesce((d->>'fetched_at')::timestamptz,'2025-06-16T00:00:00Z'),coalesce((d->>'success')::boolean,true),200,
    CASE WHEN d ? 'html' THEN d->>'html' ELSE 'PRIVATE RAW HTML Sold for <strong>'||coalesce(d->>'raw_currency',d->>'currency','USD')||' $'||coalesce(d->>'raw_price',amount::text)||'</strong> <span>on '||coalesce(d->>'raw_date',to_char(sale_day,'FMMM/FMDD/YY')) END,coalesce(d->>'platform','bat'),
    jsonb_build_object('vehicle_id',coalesce(d->>'protected_vehicle_id',vid::text),'vehicle_matched',true,
      'parsed_at',coalesce(d->>'protected_parsed_at','2025-06-16T12:00:00Z')),NULL,
    coalesce((d->>'ingested_at')::timestamptz,'2025-06-16T06:00:00Z'));
  UPDATE public.listing_page_snapshots SET html_sha256=encode(sha256(convert_to(html,'UTF8')),'hex') WHERE id=sid;
  INSERT INTO public.vehicles(id,year,make,model,sale_status,sale_price,sale_date,listing_url,canonical_platform,is_public,deleted_at,listing_kind,condition_rating,body_style,origin_metadata)
  VALUES(vid,1970,'Synthetic','Coupe',coalesce(d->>'status','sold'),amount,sale_day,source_url,'bat',coalesce((d->>'public')::boolean,true),
    (d->>'deleted_at')::timestamptz,d->>'listing_kind',(d->>'condition')::integer,'Coupe',
    jsonb_build_object('bat_snapshot_parsed',jsonb_build_object('snapshot_id',coalesce(d->>'snapshot_id',sid::text),
      'parsed_at',coalesce(d->>'parsed_at','2025-06-16T12:00:00Z'),'sale_currency',CASE WHEN d ? 'currency' THEN d->>'currency' ELSE 'USD' END,
      'sale_status',coalesce(d->>'parsed_status','sold'),'sale_price',coalesce(d->>'parsed_price',amount::text),
      'sale_date',coalesce(d->>'parsed_date',to_char(sale_day,'FMMM/FMDD/YY')))));
END $$;
CREATE FUNCTION pg_temp.base() RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  TRUNCATE public.vehicles,public.listing_page_snapshots;
  FOR n IN 1..10 LOOP PERFORM pg_temp.seed(n); END LOOP;
END $$;
CREATE FUNCTION pg_temp.read(d jsonb DEFAULT '{}'::jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.valuation_by_ymm(1970,'Synthetic','Coupe',coalesce((d->>'before')::timestamptz,'2026-01-01T00:00:00Z'),
    '2024-01-01T00:00:00Z',coalesce((d->>'known')::timestamptz,'2026-01-03T00:00:00Z'),coalesce(d->>'currency','USD'),
    coalesce((d->>'price')::numeric,5000),(d->>'subject')::uuid,coalesce(d->>'mode','retrospective'))
$$;
CREATE FUNCTION pg_temp.ok(label text,condition boolean) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF condition IS NOT TRUE THEN RAISE EXCEPTION 'Contract failed: %',label; END IF;
  RAISE NOTICE 'PASS %',label;
END $$;

SELECT pg_temp.base();
DO $$ DECLARE r jsonb; BEGIN
  r:=pg_temp.read();
  PERFORM pg_temp.ok('complete registered cohort, ten lots and tie midrank',r#>>'{stats,sold_count}'='10' AND (r#>>'{receipt,percentile}')::numeric=45 AND r#>>'{receipt,cohort,basis}'='registered_same_year_model_context');
  PERFORM pg_temp.ok('old named caller shape preserved',public.valuation_by_ymm(p_year=>1970,p_make=>'Synthetic',p_model=>'Coupe') ?& ARRAY['query','stats','comparables','receipt']);
  PERFORM pg_temp.ok('no invented comment/bid/condition adjustment',r#>'{stats,avg_bid_count}'='null'::jsonb AND r#>>'{receipt,condition_adjusted_assessment}'='unmeasured');
END $$;

SELECT pg_temp.seed(11,'{"source_number":"1","source_url":"http://www.bringatrailer.com/listing/SYNTHETIC-1?ref=x#bid","amount":1000}');
SELECT pg_temp.ok('URL aliases count once and output strips query/fragment',pg_temp.read()#>>'{stats,sold_count}'='10' AND pg_temp.read()#>>'{receipt,coverage,duplicate_presentations}'='1' AND NOT (pg_temp.read()::text LIKE '%ref=x%'));
SELECT pg_temp.ok('subject excluded across source aliases',pg_temp.read(jsonb_build_object('subject',md5('vehicle-1')::uuid))#>>'{stats,sold_count}'='9');
UPDATE public.vehicles SET sale_price=8000,origin_metadata=jsonb_set(origin_metadata,'{bat_snapshot_parsed,sale_price}','8000') WHERE id=md5('vehicle-11')::uuid;
UPDATE public.listing_page_snapshots SET html='Sold for <strong>USD $8,000</strong> <span>on 6/15/25',html_sha256=encode(sha256(convert_to('Sold for <strong>USD $8,000</strong> <span>on 6/15/25','UTF8')),'hex') WHERE id=md5('snapshot-11')::uuid;
SELECT pg_temp.ok('duplicate price conflict is withheld, not averaged',pg_temp.read()#>>'{stats,sold_count}'='9' AND pg_temp.read()#>>'{receipt,coverage,conflicting_source_lots}'='1' AND pg_temp.read()#>'{stats,median}'='null'::jsonb);
UPDATE public.vehicles SET origin_metadata=jsonb_set(origin_metadata,'{bat_snapshot_parsed,parsed_at}','"2026-01-02T00:00:00Z"') WHERE id=md5('vehicle-11')::uuid;
UPDATE public.listing_page_snapshots SET fetched_at='2026-01-02T00:00:00Z',metadata=jsonb_set(metadata,'{parsed_at}','"2026-01-02T00:00:00Z"') WHERE id=md5('snapshot-11')::uuid;
SELECT pg_temp.ok('late conflicting alias cannot change earlier known-at denominator',pg_temp.read('{"mode":"known_at","known":"2026-01-01T00:00:00Z"}')#>>'{stats,sold_count}'='10');

SELECT pg_temp.base();
SELECT pg_temp.seed(11,'{"source_number":"1","amount":1000,"status":"not_sold","parsed_status":"bid_to","html":"Bid to <strong>USD $1,000</strong> <span>on 6/15/25"}');
SELECT pg_temp.ok('explicit unsold alias conflicts with sold result',pg_temp.read()#>>'{stats,sold_count}'='9' AND pg_temp.read()#>>'{receipt,coverage,conflicting_source_lots}'='1');
SELECT pg_temp.base();
SELECT pg_temp.seed(11,'{"source_number":"1","amount":1000}');
UPDATE public.vehicles SET sale_price=8000 WHERE id=md5('vehicle-11')::uuid;
SELECT pg_temp.ok('mutable alias price cannot veto an agreeing protected source receipt',pg_temp.read()#>>'{stats,sold_count}'='10' AND pg_temp.read()#>>'{receipt,exclusions,source_sale_conflict}'='1');
UPDATE public.vehicles SET sale_status='not_sold' WHERE id=md5('vehicle-11')::uuid;
SELECT pg_temp.ok('old source clock cannot date a new mutable outcome veto',pg_temp.read()#>>'{stats,sold_count}'='10' AND pg_temp.read()#>>'{receipt,coverage,conflicting_source_lots}'='0');

SELECT pg_temp.base();
SELECT pg_temp.seed(11,'{"ingested_at":"2026-01-02T00:00:00Z"}');
SELECT pg_temp.ok('late snapshot row ingestion refuses earlier known-at even with old capture and parse clocks',pg_temp.read('{"mode":"known_at","known":"2026-01-01T00:00:00Z"}')#>>'{stats,sold_count}'='10' AND pg_temp.read('{"mode":"known_at","known":"2026-01-01T00:00:00Z"}')#>>'{receipt,exclusions,learned_later}'='1');
SELECT pg_temp.ok('retrospective receipt exposes actual source row ingestion as the maximum known clock',pg_temp.read()#>>'{stats,sold_count}'='11' AND EXISTS(SELECT 1 FROM jsonb_array_elements(pg_temp.read()#>'{receipt,eligible}') e WHERE e->>'vehicleId'=md5('vehicle-11')::uuid::text AND (e->>'snapshotCreatedAt')::timestamptz='2026-01-02T00:00:00Z' AND (e->>'knownAt')::timestamptz=(e->>'snapshotCreatedAt')::timestamptz));
SELECT pg_temp.seed(12,'{"source_number":"1","amount":8000,"ingested_at":"2026-01-02T00:00:00Z"}');
SELECT pg_temp.ok('late-ingested conflicting alias cannot veto an earlier qualified source lot',pg_temp.read('{"mode":"known_at","known":"2026-01-01T00:00:00Z"}')#>>'{stats,sold_count}'='10' AND pg_temp.read('{"mode":"known_at","known":"2026-01-01T00:00:00Z"}')#>>'{receipt,coverage,conflicting_source_lots}'='0');
SELECT pg_temp.seed(13,'{"ingested_at":"infinity"}');
SELECT pg_temp.ok('nonfinite protected ingestion clock is unknown, never qualifying evidence',pg_temp.read()#>>'{receipt,exclusions,clock_unknown_or_conflicting}'='1');

SELECT pg_temp.base();
SELECT pg_temp.seed(11,'{"raw_currency":"UNKNOWN"}');
SELECT pg_temp.seed(12,'{"currency":"EUR"}');
SELECT pg_temp.seed(13,'{"status":"not_sold"}');
SELECT pg_temp.seed(14,'{"snapshot_id":"bad uuid","parsed_price":"bad amount","parsed_at":"bad clock"}');
SELECT pg_temp.seed(15,'{"snapshot_url":"https://bringatrailer.com/listing/different/"}');
SELECT pg_temp.seed(16,'{"raw_price":"NaN"}');
SELECT pg_temp.seed(17,'{"raw_date":"2/30/25"}');
SELECT pg_temp.seed(18,'{"fetched_at":"2025-06-17T00:00:00Z"}');
SELECT pg_temp.seed(19,'{"public":false}');
SELECT pg_temp.seed(20,'{"deleted_at":"2025-07-01T00:00:00Z"}');
SELECT pg_temp.seed(21,'{"listing_kind":"non_vehicle_item"}');
SELECT pg_temp.ok('bad/unknown/mismatched source evidence excluded without cast errors',pg_temp.read()#>>'{stats,sold_count}'='10' AND pg_temp.read()#>>'{receipt,exclusions,currency_unknown}'='1' AND pg_temp.read()#>>'{receipt,exclusions,different_currency}'='1');
SELECT pg_temp.ok('public/nondeleted/real gates precede counts and source reads',pg_temp.read()#>>'{receipt,coverage,member_rows}'='18');
SELECT pg_temp.ok('EUR remains EUR with no conversion or USD default',pg_temp.read('{"currency":"EUR"}')#>>'{stats,sold_count}'='1' AND pg_temp.read('{"currency":"EUR"}')#>'{stats,median}'='null'::jsonb);
SELECT pg_temp.ok('reject nonfinite probe and future/invalid clocks',pg_temp.read('{"price":"NaN"}') ? 'error' AND pg_temp.read('{"before":"infinity"}') ? 'error' AND pg_temp.read('{"mode":"known_at","known":"2026-01-02T00:00:00Z"}') ? 'error');

SELECT pg_temp.base();
SELECT pg_temp.seed(11,'{"date":"2026-01-01","protected_parsed_at":"2026-01-02T00:00:00Z","fetched_at":"2026-01-02T00:00:00Z"}');
SELECT pg_temp.ok('same-day date grain cannot precede intraday close',pg_temp.read('{"before":"2026-01-01T18:00:00Z"}')#>>'{stats,sold_count}'='10');
SELECT pg_temp.ok('retrospective later discovery differs from known-at',pg_temp.read('{"before":"2026-01-02T00:00:00Z"}')#>>'{stats,sold_count}'='11' AND pg_temp.read('{"before":"2026-01-02T00:00:00Z","known":"2026-01-01T18:00:00Z","mode":"known_at"}')#>>'{stats,sold_count}'='10');

SET ROLE anon;
SELECT pg_temp.ok('public route returns sanitized evidence but cannot read raw snapshots',(SELECT count(*) FROM public.listing_page_snapshots)=0 AND public.valuation_by_ymm(1970,'Synthetic','Coupe') ? 'receipt');
RESET ROLE;
SELECT pg_temp.ok('only one RPC signature remains',(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname='valuation_by_ymm')=1);

TRUNCATE public.vehicles,public.listing_page_snapshots;
INSERT INTO public.vehicles(id,year,make,model,is_public)
SELECT md5('cap-'||n)::uuid,1970,'Synthetic','Coupe',true FROM generate_series(1,10001) n;
SELECT pg_temp.ok('10001-member cap refuses rather than returning a sampled statistic',pg_temp.read() ? 'error' AND pg_temp.read()#>>'{coverage,complete}'='false' AND pg_temp.read()#>'{stats}'='null'::jsonb);
TRUNCATE public.vehicles;
SELECT pg_temp.ok('zero eligible means unknown aggregates, not zero prices',pg_temp.read()#>>'{stats,sold_count}'='0' AND pg_temp.read()#>'{stats,median}'='null'::jsonb AND pg_temp.read()#>'{receipt,percentile}'='null'::jsonb);

-- The same fixtures execute against parseBaTHTML in batComps.test.ts. This reader
-- shares its supported grammar, with stricter malformed/ambiguity refusals.
CREATE TEMP TABLE bat_sale_fixtures(doc jsonb);
\copy bat_sale_fixtures FROM 'scripts/discovery/bat-sale-parser-fixtures.json'
DO $$ DECLARE f jsonb;r jsonb;qualified boolean; BEGIN
  FOR f IN SELECT value FROM bat_sale_fixtures, jsonb_array_elements(doc) LOOP
    PERFORM pg_temp.base();
    DELETE FROM public.vehicles WHERE id=md5('vehicle-1')::uuid;
    DELETE FROM public.listing_page_snapshots WHERE id=md5('snapshot-1')::uuid;
    PERFORM pg_temp.seed(1,jsonb_build_object('html',f->>'html','amount',12345,'currency',coalesce(f#>>'{canonical,currency}','USD')));
    r:=pg_temp.read(jsonb_build_object('currency',coalesce(f#>>'{canonical,currency}','USD')));
    qualified:=EXISTS(SELECT 1 FROM jsonb_array_elements(r#>'{receipt,eligible}') e WHERE e->>'vehicleId'=md5('vehicle-1')::uuid::text);
    PERFORM pg_temp.ok('raw-source grammar: '||(f->>'name'),qualified=(f->>'eligible')::boolean);
  END LOOP;
END $$;
SELECT pg_temp.base();
UPDATE public.vehicles SET origin_metadata=jsonb_set(origin_metadata,'{bat_snapshot_parsed}',
  (origin_metadata->'bat_snapshot_parsed')||'{"sale_currency":"EUR","sale_price":999999,"sale_status":"bid_to","sale_date":"1/1/00","parsed_at":"1900-01-01T00:00:00Z"}'::jsonb);
SELECT pg_temp.ok('forged mutable sale fields cannot change protected source units, amount, status or clocks',pg_temp.read()#>>'{stats,sold_count}'='10' AND (pg_temp.read()#>>'{receipt,percentile}')::numeric=45);
UPDATE public.listing_page_snapshots SET metadata=jsonb_set(metadata,'{vehicle_id}','"22222222-2222-2222-2222-222222222222"');
SELECT pg_temp.ok('a valid snapshot pointer cannot forge its protected vehicle custody',pg_temp.read()#>>'{stats,sold_count}'='0' AND pg_temp.read()#>>'{receipt,exclusions,snapshot_unmatched}'='10');
SELECT pg_temp.base();
UPDATE public.listing_page_snapshots SET metadata=jsonb_set(metadata,'{parsed_at}','"2025-06-16 12:00:00+00"');
SELECT pg_temp.ok('SQL-writer short UTC offsets are valid captured clocks',pg_temp.read()#>>'{stats,sold_count}'='10');
UPDATE public.listing_page_snapshots SET metadata=jsonb_set(metadata,'{parsed_at}','"2025-06-16 12:00:00"');
SELECT pg_temp.ok('timezone-free parser clocks remain unknown',pg_temp.read()#>>'{stats,sold_count}'='0');
SELECT pg_temp.base();
UPDATE public.listing_page_snapshots SET html=html||' changed after capture' WHERE id=md5('snapshot-1')::uuid;
SELECT pg_temp.ok('current body must match its protected captured content hash',pg_temp.read()#>>'{stats,sold_count}'='9' AND pg_temp.read()#>>'{receipt,exclusions,source_body_hash_unknown_or_conflicting}'='1');
SELECT pg_temp.ok('synthetic writes leave no waiting lock cascade',NOT EXISTS(SELECT 1 FROM pg_stat_activity WHERE wait_event_type='Lock'));
