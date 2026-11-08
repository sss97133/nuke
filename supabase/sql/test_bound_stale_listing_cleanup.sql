\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() NOT LIKE 'dm_refinement_bound_stale_listing%' OR to_regclass('public.vehicles') IS NOT NULL THEN
    RAISE EXCEPTION 'Requires empty disposable cleanup contract database';
  END IF;
END $$;
CREATE TABLE public.external_listings(id integer PRIMARY KEY, listing_status text, end_date timestamptz, updated_at timestamptz, final_price numeric);
CREATE TABLE public.vehicles(id integer PRIMARY KEY, is_for_sale boolean, deleted_at timestamptz, listing_updated_at timestamptz, listing_posted_at timestamptz, updated_at timestamptz);
CREATE TABLE public.fixture_transitions(id integer, old_status text, new_status text);
CREATE FUNCTION public.fixture_transition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
  INSERT INTO fixture_transitions VALUES(NEW.id, OLD.listing_status, NEW.listing_status);
  RETURN NEW;
END $$;
CREATE TRIGGER fixture_transition AFTER UPDATE ON public.external_listings FOR EACH ROW EXECUTE FUNCTION public.fixture_transition();
INSERT INTO public.external_listings SELECT i,'active',now()-interval '1 day',now()-interval '2 days',NULL FROM generate_series(1,61) i;
INSERT INTO public.external_listings VALUES (100,'active',now()+interval '1 hour',now(),NULL),(101,'sold',now()-interval '1 day',now(),12345),(102,'active',NULL,now(),NULL),(103,'active',now()-interval '5 minutes',now(),NULL);
INSERT INTO public.vehicles SELECT i,true,NULL,now()-interval '50 days',NULL,now()-interval '50 days' FROM generate_series(1,111) i;
INSERT INTO public.vehicles VALUES (200,true,NULL,now(),NULL,now()),(201,true,now(),now()-interval '50 days',NULL,now()-interval '50 days');
\ir ../migrations/20261108181926_bound_stale_listing_cleanup.sql
CREATE FUNCTION pg_temp.check(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL: %',label; END IF;
 RAISE NOTICE 'PASS: %',label;
END $$;
SELECT pg_temp.check(public.cleanup_stale_listings()=75,'First invocation commits bounded 25 listing and 50 vehicle updates');
SELECT pg_temp.check((SELECT count(*)=25 FROM fixture_transitions),'All transition triggers still fire');
SELECT pg_temp.check((SELECT count(*)=36 FROM external_listings WHERE id<100 AND listing_status='active'),'Remaining listing work survives for next cycle');
SELECT pg_temp.check(public.cleanup_stale_listings()=75,'Second bounded cycle progresses');
SELECT pg_temp.check(public.cleanup_stale_listings()=22,'Final cycle drains remainder');
SELECT pg_temp.check(public.cleanup_stale_listings()=0,'Completed work is idempotent');
SELECT pg_temp.check((SELECT count(*)=61 FROM fixture_transitions),'One transition per listing, no duplicates');
SELECT pg_temp.check((SELECT count(*)=61 FROM external_listings WHERE id<100 AND listing_status='ended' AND final_price IS NULL),'Expiry never invents a sale price');
SELECT pg_temp.check((SELECT count(*)=3 FROM external_listings WHERE id IN(100,102,103) AND listing_status='active'),'Future, unknown and within-grace ends remain active');
SELECT pg_temp.check((SELECT listing_status='sold' AND final_price=12345 FROM external_listings WHERE id=101),'Existing sale testimony unchanged');
SELECT pg_temp.check((SELECT count(*)=2 FROM vehicles WHERE id>=200 AND is_for_sale),'Recent and deleted vehicle rows unchanged');
