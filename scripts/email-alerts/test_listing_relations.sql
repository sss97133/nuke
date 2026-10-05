-- Local acceptance against a private mail_observation_fixture mirror containing
-- exactly the 76 admitted KSL email/card rows. Never run on production.
-- The mirror redirects only observation source references; event/bridge DDL,
-- foreign keys, functions and RLS use their production names and definitions.
\set ON_ERROR_STOP on
-- Worst-case public view grant tests the view's own vehicle-grain filter even
-- when it bypasses RLS. Existing bound event visibility must remain unchanged.
GRANT SELECT ON public.vehicle_event_summary TO anon,authenticated;
BEGIN;
INSERT INTO public.vehicle_events(id,vehicle_id,source_platform,source_listing_id,source_url,event_type,event_status,final_price,sold_at)
VALUES('10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000001',
       'ksl','bound-existing-fixture','https://cars.ksl.com/auto/listing/777','listing','sold',1234,'2026-01-01T00:00:00Z');
CREATE TEMP TABLE original_source_fixture AS SELECT * FROM public.mail_observation_fixture;
CREATE TEMP TABLE original_links AS SELECT * FROM public.vehicle_event_observations;
SET request.jwt.claim.role='service_role';
DO $$
DECLARE result jsonb; repeated jsonb;
BEGIN
  IF (SELECT count(*) FROM public.mail_observation_fixture)<>76 THEN RAISE EXCEPTION 'expected exact76 input'; END IF;
  result:=public.link_ksl_listing_observations(ARRAY(SELECT id FROM public.mail_observation_fixture));
  IF (result->>'linked')::int<>72 OR (result->>'existing')::int<>4 THEN RAISE EXCEPTION 'small-trial/all-batch counts wrong'; END IF;
  IF (SELECT count(*) FROM public.vehicle_events WHERE vehicle_id IS NULL)<>55 OR (SELECT count(*) FROM public.vehicle_event_observations)<>76 THEN
    RAISE EXCEPTION 'source keys did not converge to55 canonical parents and76 links';
  END IF;
  repeated:=public.link_ksl_listing_observations(ARRAY(SELECT id FROM public.mail_observation_fixture));
  IF (repeated->>'linked')::int<>0 OR (repeated->>'existing')::int<>76 OR repeated->'relations'<>result->'relations' THEN
    RAISE EXCEPTION 'replay changed relation identity';
  END IF;
  IF EXISTS(SELECT FROM original_links b JOIN public.vehicle_event_observations n USING(observation_id)
            WHERE n.linked_at<>b.linked_at OR n.vehicle_event_id<>b.vehicle_event_id) THEN
    RAISE EXCEPTION 'replay changed original relation clock';
  END IF;
  IF EXISTS(SELECT FROM original_source_fixture b JOIN public.mail_observation_fixture n USING(id)
            WHERE to_jsonb(b)<>to_jsonb(n)) THEN RAISE EXCEPTION 'source testimony changed'; END IF;
  IF EXISTS(SELECT FROM public.vehicle_events WHERE vehicle_id IS NULL AND (current_price IS NOT NULL
            OR final_price IS NOT NULL OR started_at IS NOT NULL OR sold_at IS NOT NULL
            OR extracted_at IS NOT NULL OR seller_identifier IS NOT NULL OR buyer_identifier IS NOT NULL
            OR seller_external_identity_id IS NOT NULL OR buyer_external_identity_id IS NOT NULL
            OR event_status<>'observed')) THEN RAISE EXCEPTION 'unknown promoted to vehicle/price/availability/sale/identity'; END IF;
END;
$$;

-- Explicit canonical /listing/ alias joins the same source entity, without
-- inventing a vehicle, a price on recommendations, or a listing-start clock.
DO $$
DECLARE o public.mail_observation_fixture%ROWTYPE; parent_id uuid; result jsonb;
BEGIN
  SELECT * INTO o FROM public.mail_observation_fixture WHERE structured_data->>'email_role'='recommendation' LIMIT 1;
  SELECT vehicle_event_id INTO parent_id FROM public.vehicle_event_observations WHERE observation_id=o.id;
  o.id:='00000000-0000-0000-0000-000000000001';
  o.source_url:=replace(o.source_url,'/auto/listing/','/listing/');
  INSERT INTO public.mail_observation_fixture SELECT o.*;
  result:=public.link_ksl_listing_observations(ARRAY[o.id]);
  IF (SELECT vehicle_event_id FROM public.vehicle_event_observations WHERE observation_id=o.id)<>parent_id THEN
    RAISE EXCEPTION 'supported URL alias split source listing'; END IF;
END;
$$;

-- A conflicting source key, unknown required clock, wrong source or supplied
-- forged raw hash refuses admission atomically and leaves original rows alone.
DO $$
DECLARE o public.mail_observation_fixture%ROWTYPE; did_refuse boolean;
BEGIN
  SELECT * INTO o FROM public.mail_observation_fixture WHERE id<>'00000000-0000-0000-0000-000000000001' LIMIT 1;
  o.id:='00000000-0000-0000-0000-000000000002';
  o.source_url:='https://cars.ksl.com/auto/listing/999999999';
  INSERT INTO public.mail_observation_fixture SELECT o.*;
  did_refuse:=false;
  BEGIN PERFORM public.link_ksl_listing_observations(ARRAY[o.id]); EXCEPTION WHEN check_violation THEN did_refuse:=true; END;
  IF NOT did_refuse THEN RAISE EXCEPTION 'source conflict accepted'; END IF;
  UPDATE public.mail_observation_fixture SET source_url=structured_data->>'url',observed_at=NULL WHERE id=o.id;
  did_refuse:=false;
  BEGIN PERFORM public.link_ksl_listing_observations(ARRAY[o.id]); EXCEPTION WHEN check_violation THEN did_refuse:=true; END;
  IF NOT did_refuse THEN RAISE EXCEPTION 'unknown event clock accepted'; END IF;
  UPDATE public.mail_observation_fixture SET observed_at=(structured_data->>'email_sent_at')::timestamptz,
    source_id='00000000-0000-0000-0000-000000000099' WHERE id=o.id;
  did_refuse:=false;
  BEGIN PERFORM public.link_ksl_listing_observations(ARRAY[o.id]); EXCEPTION WHEN check_violation THEN did_refuse:=true; END;
  IF NOT did_refuse THEN RAISE EXCEPTION 'wrong source accepted'; END IF;
  IF EXISTS(SELECT FROM public.vehicle_event_observations WHERE observation_id=o.id) THEN RAISE EXCEPTION 'refused link landed'; END IF;
END;
$$;

-- Test permissions as actual roles, not an authorization label. No NULL-vehicle
-- parent or summary cohort is visible to an anonymous reader; bridge is private.
DO $$
DECLARE o public.mail_observation_fixture%ROWTYPE; result jsonb; refused boolean;
BEGIN
  SELECT * INTO o FROM public.mail_observation_fixture LIMIT 1;
  o.id:='00000000-0000-0000-0000-000000000003';
  o.source_url:='https://cars.ksl.com/auto/listing/999999991';
  o.structured_data:=o.structured_data||jsonb_build_object('listing_id','999999991','url',o.source_url);
  o.source_identifier:=left(o.source_identifier,71)||left(encode(extensions.digest(o.source_url,'sha256'),'hex'),24);
  INSERT INTO public.mail_observation_fixture SELECT o.*;
  INSERT INTO public.vehicle_events(id,vehicle_id,source_platform,source_listing_id,source_url,event_type,event_status)
  VALUES('10000000-0000-0000-0000-000000000003','20000000-0000-0000-0000-000000000001',
         'ksl','999999991','https://cars.ksl.com/listing/999999991','listing','listed');
  result:=public.link_ksl_listing_observations(ARRAY[o.id]);
  IF (SELECT vehicle_event_id FROM public.vehicle_event_observations WHERE observation_id=o.id)
      <>'10000000-0000-0000-0000-000000000003' THEN RAISE EXCEPTION 'compatible native listing not reused'; END IF;
  IF (SELECT vehicle_id FROM public.mail_observation_fixture WHERE id=o.id) IS NOT NULL THEN
    RAISE EXCEPTION 'native listing reuse changed original vehicle attribution'; END IF;
  -- Same publisher key in another native episode is ambiguous, never a merge.
  INSERT INTO public.vehicle_events(id,vehicle_id,source_platform,source_listing_id,source_url,event_type,event_status)
  VALUES('10000000-0000-0000-0000-000000000004','20000000-0000-0000-0000-000000000001',
         'ksl','999999991','https://cars.ksl.com/auto/listing/999999991','listing','sold');
  refused:=false;
  BEGIN PERFORM public.link_ksl_listing_observations(ARRAY[o.id]); EXCEPTION WHEN check_violation THEN refused:=true; END;
  IF NOT refused THEN RAISE EXCEPTION 'multiple native episodes accepted'; END IF;
  -- A pre-existing incompatible UUID namespace tuple cannot be overwritten.
  o.id:='00000000-0000-0000-0000-000000000005';
  o.source_url:='https://cars.ksl.com/auto/listing/999999992';
  o.structured_data:=o.structured_data||jsonb_build_object('listing_id','999999992','url',o.source_url);
  o.source_identifier:=left(o.source_identifier,71)||left(encode(extensions.digest(o.source_url,'sha256'),'hex'),24);
  INSERT INTO public.mail_observation_fixture SELECT o.*;
  INSERT INTO public.vehicle_events(id,vehicle_id,source_platform,source_listing_id,event_type,event_status)
  VALUES(md5('ksl-email-listing-blip-v1:cars.ksl.com/auto/listing/999999992')::uuid,
         '20000000-0000-0000-0000-000000000001','other-platform','separate-resale-namespace','auction','sold');
  refused:=false;
  BEGIN PERFORM public.link_ksl_listing_observations(ARRAY[o.id]); EXCEPTION WHEN check_violation THEN refused:=true; END;
  IF NOT refused OR EXISTS(SELECT FROM public.vehicle_event_observations WHERE observation_id=o.id) THEN
    RAISE EXCEPTION 'incompatible PK namespace accepted'; END IF;
END;
$$;
SET LOCAL ROLE anon;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.vehicle_events)<>4 OR (SELECT count(*) FROM public.vehicle_event_summary)<>1 THEN
    RAISE EXCEPTION 'unresolved vehicle identity leaked through event reader'; END IF;
  IF NOT EXISTS(SELECT FROM public.vehicle_events WHERE id='10000000-0000-0000-0000-000000000001'
                AND final_price=1234 AND event_status='sold')
     OR NOT EXISTS(SELECT FROM public.vehicle_event_summary WHERE vehicle_id='20000000-0000-0000-0000-000000000001'
                   AND times_sold=3 AND highest_sale_price=1234) THEN
    RAISE EXCEPTION 'existing bound event behavior changed'; END IF;
  BEGIN
    PERFORM 1 FROM public.vehicle_event_observations;
    RAISE EXCEPTION 'bridge was publicly readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
  BEGIN
    PERFORM public.link_ksl_listing_observations(ARRAY['00000000-0000-0000-0000-000000000001'::uuid]);
    RAISE EXCEPTION 'anonymous relation writer accepted';
  EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  IF (SELECT count(*) FROM public.vehicle_events)<>4 OR (SELECT count(*) FROM public.vehicle_event_summary)<>1 THEN
    RAISE EXCEPTION 'authenticated reader visibility changed'; END IF;
  BEGIN PERFORM 1 FROM public.vehicle_event_observations; RAISE EXCEPTION 'authenticated bridge exposed';
    EXCEPTION WHEN insufficient_privilege THEN NULL; END;
END;
$$;
RESET ROLE;
DO $$
BEGIN
  BEGIN
    INSERT INTO public.vehicle_events(vehicle_id,source_platform,source_listing_id,source_url,event_type,event_status)
    VALUES(NULL,'ksl','cars.ksl.com/auto/listing/999999993','https://cars.ksl.com/auto/listing/999999993','listing','active');
    RAISE EXCEPTION 'conditional NULL invariant allowed ordinary active event';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN
    INSERT INTO public.vehicle_events(vehicle_id,source_platform,source_listing_id,source_url,event_type,event_status,metadata)
    VALUES(NULL,'ksl','cars.ksl.com/auto/listing/999999993','https://cars.ksl.com/auto/listing/999999993','listing','observed',
      jsonb_build_object('identity_state','unresolved_source_listing','writer','ingest-observation:ksl_listing_relation_v1'));
    RAISE EXCEPTION 'conditional NULL invariant allowed arbitrary PK';
  EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.vehicle_event_observations SET linked_at=now(); RAISE EXCEPTION 'relation clock mutable';
    EXCEPTION WHEN check_violation THEN NULL; END;
  BEGIN UPDATE public.vehicle_events SET event_status='active' WHERE vehicle_id IS NULL; RAISE EXCEPTION 'source blip promoted to availability';
    EXCEPTION WHEN check_violation THEN NULL; END;
END;
$$;
ROLLBACK;
\echo 'KSL listing relation source-key/alias/conflict/unknown/replay/clock/privacy acceptance passed'
