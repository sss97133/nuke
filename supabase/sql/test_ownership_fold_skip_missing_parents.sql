-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_ownership_fold_orphans -f this-file.sql
-- Contract for 20261020350000_ownership_fold_skip_missing_parents.sql, on top of the owner-period fold contract
-- (test_ownership_periods_fold.sql), whose tables carry the live foreign keys: vehicle_ownerships.vehicle_id -> vehicles,
-- owner_identity_id -> external_identities, and no foreign key from auction_events.vehicle_id or its identity ids (as live).
-- Synthetic rows only; never production.
--   * before the migration, an apply over sold lots whose vehicle is gone fails with the foreign key violation seen live;
--   * the migration applies twice and keeps the grants (service_role only);
--   * a dry run reports the lots and vehicles skipped for a missing vehicle and the identities missing, and writes nothing;
--   * the apply completes with no foreign key error, writes the rest of the chunk, writes no period for a missing vehicle
--     and none for a missing identity (that side reads as unkeyed, with party_unkeyed on the neighbouring period);
--   * a re-run is idempotent.
\ir test_ownership_periods_fold.sql

-- fixtures: V30 a normal chain; V31 a winner whose identity id is not in external_identities; V90 and V91 are not in vehicles
INSERT INTO public.vehicles (id, is_public) SELECT pg_temp.u(1, n), true FROM generate_series(30, 31) n;
INSERT INTO public.external_identities (id, platform, handle) SELECT pg_temp.u(2, n), 'bat', 'synthetic_handle_' || n FROM generate_series(71, 76) n;
SELECT pg_temp.lot(60, 30, 'v30-a', 'sold', '2024-01-10 20:00+00', 71, 72);
SELECT pg_temp.lot(61, 30, 'v30-b', 'sold', '2024-06-10 20:00+00', 72, 73);
SELECT pg_temp.lot(62, 31, 'v31-a', 'sold', '2024-01-10 20:00+00', 74, 99);
SELECT pg_temp.lot(63, 31, 'v31-b', 'sold', '2024-08-10 20:00+00', 75, 76);
SELECT pg_temp.lot(64, 90, 'v90-a', 'sold', '2024-01-10 20:00+00', 71, 72);
SELECT pg_temp.lot(65, 90, 'v90-b', 'no_sale', '2024-03-10 20:00+00', 71, NULL);
SELECT pg_temp.lot(66, 91, 'v91-a', 'sold', '2024-01-10 20:00+00', 73, 74);

-- the failure seen live, before the migration
DO $$ BEGIN
  BEGIN
    PERFORM public.fold_vehicle_ownership_periods(NULL, 1000, true);
    RAISE EXCEPTION 'Contract failed: the old writer should have hit the foreign key';
  EXCEPTION WHEN foreign_key_violation THEN
    RAISE NOTICE 'PASS before the fix an apply over a lot of a missing vehicle fails with the foreign key violation (%)', SQLERRM;
  END;
END $$;
SELECT pg_temp.ok('and the failed apply wrote nothing of the chunk',
  NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id IN (pg_temp.u(1, 30), pg_temp.u(1, 31))));

\ir ../migrations/20261020350000_ownership_fold_skip_missing_parents.sql
\ir ../migrations/20261020350000_ownership_fold_skip_missing_parents.sql

SELECT pg_temp.ok('the replacements keep the grants: service_role only',
  has_function_privilege('service_role', 'public.fold_vehicle_ownership_periods(uuid,integer,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.ownership_fold_plan(uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.fold_vehicle_ownership_periods(uuid,integer,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.fold_vehicle_ownership_periods(uuid,integer,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.ownership_fold_plan(uuid[])', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.ownership_fold_plan(uuid[])', 'EXECUTE'));

CREATE TEMP TABLE _o_before AS SELECT count(*) AS n FROM public.vehicle_ownerships;
CREATE TEMP TABLE _o_dry AS SELECT public.fold_vehicle_ownership_periods(NULL, 1000, false) AS r;
SELECT pg_temp.ok('a dry run counts the lots and vehicles skipped for a missing vehicle (sold lots apart) and the identities missing',
  (SELECT (r ->> 'lots_skipped_missing_vehicle')::int = 3 AND (r ->> 'sold_lots_skipped_missing_vehicle')::int = 2
          AND (r ->> 'vehicles_skipped_missing_vehicle')::int = 2
          AND (r ->> 'lots_with_missing_identity')::int = 1 AND (r ->> 'identities_missing')::int = 1 FROM _o_dry)
  AND (SELECT count(*) FROM public.vehicle_ownerships) = (SELECT n FROM _o_before));
SELECT pg_temp.ok('the dry run would insert only the periods of the vehicles that exist: V30 three, V31 three',
  (SELECT (r ->> 'would_insert')::int = 6 AND (r ->> 'would_supersede')::int = 0 FROM _o_dry));

CREATE TEMP TABLE _o_apply AS SELECT public.fold_vehicle_ownership_periods(NULL, 1000, true) AS r;
SELECT pg_temp.ok('the apply completes with no foreign key error and writes the rest of the chunk',
  (SELECT (r ->> 'applied')::boolean AND (r ->> 'would_insert')::int = 6 FROM _o_apply)
  AND (SELECT count(*) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 30) AND basis IS NOT NULL) = 3
  AND (SELECT count(*) FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 31) AND basis IS NOT NULL) = 3);
SELECT pg_temp.ok('no period names a missing vehicle, and none names the missing identity',
  NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id IN (pg_temp.u(1, 90), pg_temp.u(1, 91)))
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE owner_identity_id = pg_temp.u(2, 99))
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships o WHERE o.owner_identity_id IS NOT NULL
                    AND NOT EXISTS (SELECT 1 FROM public.external_identities e WHERE e.id = o.owner_identity_id)));
SELECT pg_temp.ok('the missing winner reads as unkeyed: the seller of the next lot is flagged party_unkeyed with the earlier lot, the sale holds no winner period',
  EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 31) AND owner_identity_id = pg_temp.u(2, 75)
          AND start_unknown AND chain_flag = 'party_unkeyed' AND chain_peer_lot_id = pg_temp.u(3, 62))
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE acquired_via_lot_id = pg_temp.u(3, 62))
  AND EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 31) AND owner_identity_id = pg_temp.u(2, 76) AND is_current));

CREATE TEMP TABLE _o_rows1 AS SELECT id, fold_hash, superseded_at FROM public.vehicle_ownerships WHERE basis IS NOT NULL;
CREATE TEMP TABLE _o_rerun AS SELECT public.fold_vehicle_ownership_periods(NULL, 1000, true) AS r;
SELECT pg_temp.ok('a re-run writes nothing and still reports the same skips',
  (SELECT (r ->> 'would_insert')::int = 0 AND (r ->> 'would_supersede')::int = 0 AND (r ->> 'unchanged')::int = (r ->> 'periods')::int
          AND (r ->> 'vehicles_skipped_missing_vehicle')::int = 2 AND (r ->> 'identities_missing')::int = 1 FROM _o_rerun)
  AND (SELECT count(*) FROM public.vehicle_ownerships WHERE basis IS NOT NULL) = (SELECT count(*) FROM _o_rows1)
  AND NOT EXISTS (SELECT 1 FROM public.vehicle_ownerships v JOIN _o_rows1 b USING (id) WHERE v.superseded_at IS DISTINCT FROM b.superseded_at));

-- the identity appears later: the fold picks the lot up (supersedes the unkeyed reading)
INSERT INTO public.external_identities (id, platform, handle) VALUES (pg_temp.u(2, 99), 'bat', 'synthetic_handle_99');
CREATE TEMP TABLE _o_late AS SELECT public.fold_vehicle_ownership_periods(NULL, 1000, true) AS r;
SELECT pg_temp.ok('an identity that appears later is folded in on the next run, superseding the unkeyed reading and keeping its rows',
  EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 31) AND owner_identity_id = pg_temp.u(2, 99) AND superseded_at IS NULL AND acquired_via_lot_id = pg_temp.u(3, 62))
  AND EXISTS (SELECT 1 FROM public.vehicle_ownerships WHERE vehicle_id = pg_temp.u(1, 31) AND owner_identity_id = pg_temp.u(2, 75) AND superseded_at IS NOT NULL AND superseded_reason = 'inputs_changed')
  AND (SELECT (r ->> 'identities_missing')::int = 0 FROM _o_late));
