-- Disposable PG17 only. 20261116038000 removes exactly the retired verdict from market_pulse_live: row slot 17, the
-- 'heat' column name and the top-level backtest. Every other byte equals the previous output for anon, an untied
-- authenticated user, an owner and service_role, across the BaT board fixture's identity-link states; the 17 named
-- columns both clients read by position are unchanged; grants are unchanged.
\set ON_ERROR_STOP on
\ir test_market_pulse_live_anon_plan.sql

DO $copy$
DECLARE def text:=pg_get_functiondef('public.market_pulse_live()'::regprocedure);
BEGIN
 ASSERT strpos(def,'stable_episodes AS MATERIALIZED')>0 AND strpos(def,'heat_of(')>0,'fixture carries the 20261116036000 body';
 EXECUTE replace(def,'FUNCTION public.market_pulse_live()','FUNCTION pg_temp.market_pulse_live_with_heat()');
END $copy$;
CREATE TEMP TABLE trim_acl AS SELECT proacl FROM pg_proc WHERE oid='public.market_pulse_live()'::regprocedure;
-- The previous output with only the retired parts removed.
CREATE FUNCTION pg_temp.without_heat(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE AS $f$
 SELECT jsonb_set((p - 'backtest')||CASE WHEN jsonb_typeof(p->'columns')='array'
   THEN jsonb_build_object('columns',(p->'columns')-'heat') ELSE '{}'::jsonb END,
  '{auctions}',coalesce((SELECT jsonb_agg(a - 17 ORDER BY o) FROM jsonb_array_elements(p->'auctions') WITH ORDINALITY x(a,o)),'[]'::jsonb)) $f$;

\ir ../migrations/20261116038000_market_pulse_live_drop_retired_heat.sql
\ir ../migrations/20261116038000_market_pulse_live_drop_retired_heat.sql

SELECT assert_contract((SELECT proacl FROM pg_proc WHERE oid='public.market_pulse_live()'::regprocedure)
 IS NOT DISTINCT FROM (SELECT proacl FROM trim_acl),'grants unchanged');
SELECT assert_contract(strpos(pg_get_functiondef('public.market_pulse_live()'::regprocedure),'heat_of(')=0,'no verdict computed');

CREATE OR REPLACE FUNCTION pg_temp.trim_same(p_state text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE r record; a jsonb; b jsonb;
BEGIN
 FOR r IN SELECT * FROM plan_viewers LOOP
  PERFORM set_config('request.jwt.claims',CASE WHEN r.sub IS NULL THEN jsonb_build_object('role',r.role)
   ELSE jsonb_build_object('role',r.role,'sub',r.sub) END::text,true);
  PERFORM set_config('request.jwt.claim.sub',coalesce(r.sub,''),true);
  PERFORM set_config('request.jwt.claim.role',r.role,true);
  EXECUTE format('SET LOCAL ROLE %I',r.role);
  SELECT public.market_pulse_live(),pg_temp.market_pulse_live_with_heat() INTO a,b;
  RESET ROLE;
  IF a::text IS DISTINCT FROM pg_temp.without_heat(b)::text THEN
   RAISE EXCEPTION 'market_pulse_live changed beyond the verdict for % in state %',r.label,p_state;
  END IF;
  IF a ? 'backtest' OR a->'columns' ? 'heat' OR EXISTS(SELECT FROM jsonb_array_elements(a->'auctions') x WHERE jsonb_array_length(x)>17)
   OR jsonb_array_length(a->'columns')<>17 THEN
   RAISE EXCEPTION 'retired verdict still sent for % in state %: backtest=% heat=% columns=% row lengths=%',r.label,p_state,
    a ? 'backtest',a->'columns' ? 'heat',jsonb_array_length(a->'columns'),
    (SELECT jsonb_agg(DISTINCT jsonb_array_length(x)) FROM jsonb_array_elements(a->'auctions') x);
  END IF;
  IF NOT (b ? 'backtest' AND b->'columns' ? 'heat') THEN RAISE EXCEPTION 'fixture lacks the verdict in state %',p_state; END IF;
  IF jsonb_array_length(a->'auctions')=0 THEN RAISE EXCEPTION 'empty board in state %',p_state; END IF;
 END LOOP;
END $$;
GRANT EXECUTE ON FUNCTION pg_temp.without_heat(jsonb) TO anon,authenticated,service_role;

BEGIN; SELECT pg_temp.trim_same('applied alias'); COMMIT;
-- A second inventory locator on the same lot.
UPDATE market_pulse_live_snapshot SET payload=jsonb_set(payload,'{auctions}',(payload->'auctions')||
 (SELECT jsonb_agg(jsonb_set(a,'{0}','"00000000-0000-0000-0000-000000000399"')) FROM jsonb_array_elements(payload->'auctions') a WHERE right(a->>0,6)='000317'));
BEGIN; SELECT pg_temp.trim_same('ambiguous inventory locator'); COMMIT;
SELECT 'market pulse live drop retired heat contract passed' AS result;
