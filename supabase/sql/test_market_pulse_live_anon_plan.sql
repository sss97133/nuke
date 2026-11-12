-- Disposable PG17 only. 20261116036000 changes only market_pulse_live's plan: its output is identical to the
-- previous body for anon, an untied authenticated user, an owner and service_role, across the BaT board fixture's
-- states (applied, refused, ambiguous and expired identity links; native overlay), and its grants are unchanged.
\set ON_ERROR_STOP on
\ir test_bat_stable_board_identity.sql

-- The previous body, kept for comparison in the same statement (same clocks).
DO $copy$
DECLARE def text:=pg_get_functiondef('public.market_pulse_live()'::regprocedure);
BEGIN
 ASSERT strpos(def,'stable_links AS MATERIALIZED')>0 AND strpos(def,'stable_episodes')=0,'fixture carries the previous body';
 EXECUTE replace(def,'FUNCTION public.market_pulse_live()','FUNCTION pg_temp.market_pulse_live_previous()');
END $copy$;
CREATE TEMP TABLE plan_acl AS SELECT proacl FROM pg_proc WHERE oid='public.market_pulse_live()'::regprocedure;
-- The fixture's authenticated policy shows private vehicle ...0002 (the owner's view); anon sees public rows only.
CREATE TEMP TABLE plan_viewers(label text, role text, sub text);
INSERT INTO plan_viewers VALUES ('anon','anon',NULL),('untied','authenticated','7d3f1c2a-0000-4000-8000-000000000001'),
 ('owner','authenticated','7d3f1c2a-0000-4000-8000-000000000002'),('service','service_role',NULL);
GRANT SELECT ON plan_viewers TO anon,authenticated,service_role;

\ir ../migrations/20261116036000_market_pulse_live_anon_plan.sql
-- Replay is a no-op.
\ir ../migrations/20261116036000_market_pulse_live_anon_plan.sql

SELECT assert_contract((SELECT proacl FROM pg_proc WHERE oid='public.market_pulse_live()'::regprocedure)
 IS NOT DISTINCT FROM (SELECT proacl FROM plan_acl),'grants unchanged');
SELECT assert_contract(strpos(pg_get_functiondef('public.market_pulse_live()'::regprocedure),'stable_episodes AS MATERIALIZED')>0,
 'new plan installed');

CREATE OR REPLACE FUNCTION pg_temp.plan_same(p_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record; a jsonb; b jsonb;
BEGIN
 FOR r IN SELECT * FROM plan_viewers LOOP
  PERFORM set_config('request.jwt.claims',CASE WHEN r.sub IS NULL THEN jsonb_build_object('role',r.role)
   ELSE jsonb_build_object('role',r.role,'sub',r.sub) END::text,true);
  PERFORM set_config('request.jwt.claim.sub',coalesce(r.sub,''),true);
  PERFORM set_config('request.jwt.claim.role',r.role,true);
  EXECUTE format('SET LOCAL ROLE %I',r.role);
  SELECT public.market_pulse_live(),pg_temp.market_pulse_live_previous() INTO a,b;
  RESET ROLE;
  IF a::text IS DISTINCT FROM b::text THEN
   RAISE EXCEPTION 'market_pulse_live changed for % in state %',r.label,p_state;
  END IF;
  IF jsonb_array_length(a->'auctions')=0 THEN RAISE EXCEPTION 'empty board in state %',p_state; END IF;
 END LOOP;
END $$;

BEGIN; SELECT pg_temp.plan_same('fixture end: expired 217 presentation'); COMMIT;
-- Restore the 217 presentation: the ambiguous inventory locator refusal.
UPDATE market_pulse_live_snapshot SET payload=jsonb_set(payload,'{auctions}',
 (SELECT jsonb_agg(CASE WHEN a->>10='https://bringatrailer.com/listing/relisted-217'
 THEN jsonb_set(a,'{5}',to_jsonb(now()+interval '2 days')) ELSE a END) FROM jsonb_array_elements(payload->'auctions') a));
BEGIN; SELECT pg_temp.plan_same('ambiguous inventory locator'); COMMIT;
DO $$ BEGIN ASSERT public.market_pulse_live()#>>'{identity_links,https://bringatrailer.com/listing/relisted-217,refusal_reason}'
 ='ambiguous_inventory_locator','fixture state reached'; END $$;
-- Drop the second locator: multiple lot presentations for 217 and 209.
UPDATE market_pulse_live_snapshot SET payload=jsonb_set(payload,'{auctions}',
 (SELECT jsonb_agg(a) FROM jsonb_array_elements(payload->'auctions') a WHERE a->>0<>'00000000-0000-0000-0000-000000000399'));
BEGIN; SELECT pg_temp.plan_same('multiple lot presentations'); COMMIT;
-- Move 209 back: 217's applied alias and 200's refusal.
UPDATE vehicle_events SET vehicle_id='00000000-0000-0000-0000-000000000209',ended_at=now()-interval '1 day'
 WHERE vehicle_id='00000000-0000-0000-0000-000000000217' AND source_url LIKE '%relisted-209%';
UPDATE auction_events SET vehicle_id='00000000-0000-0000-0000-000000000209'
 WHERE vehicle_id='00000000-0000-0000-0000-000000000217' AND source_url LIKE '%relisted-209%';
UPDATE vehicle_observations SET vehicle_id='00000000-0000-0000-0000-000000000209'
 WHERE vehicle_id='00000000-0000-0000-0000-000000000217' AND source_url LIKE '%relisted-209%';
BEGIN; SELECT pg_temp.plan_same('applied alias'); COMMIT;
SELECT 'market pulse live anon plan contract passed' AS result;
