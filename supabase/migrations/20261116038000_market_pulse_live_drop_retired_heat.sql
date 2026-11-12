-- market_pulse_live: stop sending the retired hot/cold verdict (row slot 17, the 'heat' column) and its backtest.
--
-- WHY. The home panel downloads 738 KB for the board. The verdict was retired from both clients by the owner's
-- 2026-10-24 review (apps/nuke-capture-ios LiveBoard.swift showsHeatVerdict=false: the tag did not separate
-- outcomes). Its slot is 75 KB of the payload, its backtest 2 KB; nothing renders either.
-- Readers searched on 2026-11-12 (git grep over nuke_frontend, apps/nuke-capture-ios, supabase/functions including
-- mcp-connector, scripts, tools; plus pg_proc bodies and cron.job commands on prod):
--   slot 17 / serverHeat: decoded in nuke_frontend useMarketPulse.ts (serverHeatOf(r[17])) and read by no component;
--     iOS reads 17 named columns by position (BoardContract.swift) and computes its own heat, hidden;
--     scripts/market/live-finish.py names the columns from the payload and never reads 'heat';
--     record_live_board_snapshot() reads slot 4 (the bid) only.
--   backtest: decoded in useMarketPulse.ts, read by no component; iOS mentions it in a comment only.
--   Both clients accept a payload with 17 named columns (assertPulseColumns, BoardContract: a prefix of 17) and
--   a missing backtest (null). identity_links and native_state stay: they are the provenance of the slot-0 relink
--   and the native overlay rows, asserted by the BaT board contracts.
--
-- WHAT. native rows no longer compute heat_of; snapshot rows drop element 17; columns drop 'heat'; the top-level
-- backtest key is removed. Everything else is unchanged: on prod, 2026-11-12, the new output equals the old output
-- with exactly that removal, for anon, an untied authenticated user and an owner (one statement, same clocks).
-- Firebird board: 739,346 -> 654,448 characters.
-- CONTRACT: supabase/sql/test_market_pulse_live_drop_retired_heat.sql.
-- Reversal: restore the 20261116036000 body (the patch below is fragment-for-fragment).

BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';
DO $patch$
DECLARE def text; change record;
BEGIN
 def:=pg_get_functiondef('public.market_pulse_live()'::regprocedure);
 IF strpos(def,'Slot 17, the hot/cold verdict, is retired')>0 THEN RETURN; END IF;
 FOR change IN SELECT * FROM (VALUES
  ($old$hp.comp_count,
     public.heat_of(n.native_bid::float8,hp.predicted_hammer::float8,hp.price_tier,n.ends_at,now())) a$old$,
   $new$hp.comp_count) a$new$),
  ($old$     THEN jsonb_set(a,'{0}',to_jsonb(link.canonical_vehicle_id::text)) ELSE a END a$old$,
   $new$     THEN jsonb_set(a,'{0}',to_jsonb(link.canonical_vehicle_id::text)) ELSE a END
     -- Slot 17, the hot/cold verdict, is retired (owner review 2026-10-24): no reader takes it.
     - 17 a$new$),
  ($old$ SELECT jsonb_set(p,'{auctions}',$old$,
   $new$ SELECT jsonb_set((p - 'backtest')||CASE WHEN jsonb_typeof(p->'columns')='array'
     THEN jsonb_build_object('columns',(p->'columns')-'heat') ELSE '{}'::jsonb END,'{auctions}',$new$)
 ) changes(old_text,new_text) LOOP
  IF (length(def)-length(replace(def,change.old_text,'')))/length(change.old_text)<>1 THEN
   RAISE EXCEPTION 'market_pulse_live anchor drifted: %',left(change.old_text,80);
  END IF;
  def:=replace(def,change.old_text,change.new_text);
 END LOOP;
 EXECUTE def;
END $patch$;
NOTIFY pgrst,'reload schema';
COMMIT;
