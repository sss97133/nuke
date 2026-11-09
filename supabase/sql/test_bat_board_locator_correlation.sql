-- Execute every existing anonymous identity/privacy/clock/terminal contract
-- against the fenced readers, including migration replay and budget/ACL checks.
\set ON_ERROR_STOP on
\set test_bat_locator_correlation true
\ir test_bat_relisted_native_board.sql
SELECT assert_contract((SELECT bool_and(strpos(pg_get_functiondef(p.oid),E' OFFSET 0\n ) bound ON true')>0 AND NOT p.prosecdef)
 FROM pg_proc p WHERE p.oid IN('public.market_pulse_live()'::regprocedure,'public.market_lot_activity(uuid[],integer)'::regprocedure)),
 'both locator lookups remain correlated and security invoker');
