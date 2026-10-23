-- Empty disposable PG17 only: psql -X -v ON_ERROR_STOP=1 -d dm_refinement_relabel_by_evidence -f this-file.sql
-- Contract for 20261020360000_relabel_auction_transfers_by_evidence.sql, on top of the owner-period fold contract
-- (test_ownership_periods_fold.sql), whose fold output (periods and relist flags) the relabel reads. Synthetic rows only.
--   * the migration applies twice;
--   * hammer only and "the winner listed the car next" become recorded_unconfirmed, a sale the same seller relisted becomes
--     cancelled with cancelled_at the relisting lot's event clock; open milestones become not_observable;
--   * a transfer with a user on either side, a milestone beyond agreement_reached, a communication, a close or another
--     trigger is never touched;
--   * a dry run writes nothing and counts per class; a re-run finds nothing;
--   * every change has a before-image; the revert puts status, cancelled_at and the milestones back (overdue when the
--     deadline passed, else pending), skips a transfer that moved on its own, and a reverted transfer can be relabelled again;
--   * anon and authenticated reach neither function nor the before-image table.
\ir test_ownership_periods_fold.sql
\ir ../migrations/20261020360000_relabel_auction_transfers_by_evidence.sql
\ir ../migrations/20261020360000_relabel_auction_transfers_by_evidence.sql

-- state left by the fold contract: tr1 and tr6 relabelled by the earlier function (no before-image), tr7 (lot 40) and tr8 (lot 1) held back
INSERT INTO public.ownership_transfers (id, vehicle_id, trigger_table, trigger_id, status, to_user_id) VALUES
  (pg_temp.u(5, 9), pg_temp.u(1, 16), 'auction_events', pg_temp.u(3, 49), 'in_progress', NULL),   -- hammer only
  (pg_temp.u(5, 10), pg_temp.u(1, 14), 'auction_events', pg_temp.u(3, 44), 'in_progress', NULL),  -- winner listed next
  (pg_temp.u(5, 11), pg_temp.u(1, 13), 'auction_events', pg_temp.u(3, 42), 'in_progress', NULL),  -- seller relisted
  (pg_temp.u(5, 12), pg_temp.u(1, 15), 'auction_events', pg_temp.u(3, 46), 'in_progress', pg_temp.u(4, 1)),  -- a user on a side
  (pg_temp.u(5, 13), pg_temp.u(1, 12), 'listing', pg_temp.u(3, 40), 'in_progress', NULL);         -- not seeded from a lot
INSERT INTO public.transfer_milestones (transfer_id, milestone_type, status, deadline_at)
SELECT t, m, CASE WHEN m = 'agreement_reached' THEN 'completed'::public.milestone_status WHEN m = 'deposit_sent' THEN 'overdue' ELSE 'pending' END,
       CASE WHEN m = 'deposit_sent' THEN timestamptz '2024-02-01' ELSE timestamptz '2099-01-01' END
  FROM (VALUES (pg_temp.u(5, 9)), (pg_temp.u(5, 10)), (pg_temp.u(5, 11)), (pg_temp.u(5, 12)), (pg_temp.u(5, 13))) t(t)
  CROSS JOIN (VALUES ('agreement_reached'), ('contact_exchanged'), ('deposit_sent')) m(m);
UPDATE public.transfer_milestones SET deadline_at = CASE WHEN status = 'overdue' THEN timestamptz '2024-02-01' ELSE timestamptz '2099-01-01' END
 WHERE transfer_id IN (pg_temp.u(5, 7), pg_temp.u(5, 8));

CREATE TEMP TABLE _r_snap AS SELECT t.id, t.status::text AS status, t.cancelled_at,
  (SELECT string_agg(m.status::text, ',' ORDER BY m.milestone_type) FROM public.transfer_milestones m WHERE m.transfer_id = t.id) AS ms FROM public.ownership_transfers t;
CREATE TEMP TABLE _r_dry AS SELECT public.relabel_auction_transfers_recorded_unconfirmed(NULL, 100, false) AS r;
SELECT pg_temp.ok('the dry run counts per class and writes nothing: two relisted, two winner-listed-next, one hammer only',
  (SELECT (r ->> 'transfers')::int = 5 AND (r -> 'by_reason') = '{"hammer_only": 1, "confirmed_next_lot": 2, "relist_same_seller": 2}'::jsonb
          AND (r ->> 'cancelled')::int = 2 AND (r ->> 'recorded_unconfirmed')::int = 3 AND (r ->> 'milestones_closed')::int = 8 FROM _r_dry)
  AND NOT EXISTS (SELECT 1 FROM public.ownership_transfer_relabels)
  AND NOT EXISTS (SELECT 1 FROM public.ownership_transfers t JOIN _r_snap s USING (id)
                   WHERE t.status::text <> s.status OR t.cancelled_at IS DISTINCT FROM s.cancelled_at));

SELECT public.relabel_auction_transfers_recorded_unconfirmed(NULL, 100, true);
SELECT pg_temp.ok('hammer only and winner-listed-next become recorded_unconfirmed',
  (SELECT array_agg(id ORDER BY id) FROM public.ownership_transfers WHERE status = 'recorded_unconfirmed' AND id IN (pg_temp.u(5, 8), pg_temp.u(5, 9), pg_temp.u(5, 10)))
    = ARRAY[pg_temp.u(5, 8), pg_temp.u(5, 9), pg_temp.u(5, 10)]);
SELECT pg_temp.ok('a sale the same seller relisted becomes cancelled at the relisting lot''s event clock',
  (SELECT status::text FROM public.ownership_transfers WHERE id = pg_temp.u(5, 7)) = 'cancelled'
  AND (SELECT cancelled_at FROM public.ownership_transfers WHERE id = pg_temp.u(5, 7)) = '2024-03-10 20:00+00'
  AND (SELECT status::text FROM public.ownership_transfers WHERE id = pg_temp.u(5, 11)) = 'cancelled'
  AND (SELECT cancelled_at FROM public.ownership_transfers WHERE id = pg_temp.u(5, 11)) = '2024-05-10 20:00+00');
SELECT pg_temp.ok('a transfer with a user, another trigger, observed progress, a communication or a close is untouched',
  (SELECT status::text FROM public.ownership_transfers WHERE id = pg_temp.u(5, 12)) = 'in_progress'
  AND (SELECT status::text FROM public.ownership_transfers WHERE id = pg_temp.u(5, 13)) = 'in_progress'
  AND (SELECT status::text FROM public.ownership_transfers WHERE id = pg_temp.u(5, 2)) = 'in_progress'
  AND (SELECT status::text FROM public.ownership_transfers WHERE id = pg_temp.u(5, 3)) = 'in_progress'
  AND (SELECT status::text FROM public.ownership_transfers WHERE id = pg_temp.u(5, 4)) = 'in_progress'
  AND (SELECT status::text FROM public.ownership_transfers WHERE id = pg_temp.u(5, 5)) = 'completed'
  AND NOT EXISTS (SELECT 1 FROM public.ownership_transfers t JOIN _r_snap s USING (id)
                   WHERE t.id IN (pg_temp.u(5, 2), pg_temp.u(5, 3), pg_temp.u(5, 4), pg_temp.u(5, 5), pg_temp.u(5, 12), pg_temp.u(5, 13))
                     AND (t.status::text <> s.status OR t.cancelled_at IS DISTINCT FROM s.cancelled_at))
  AND (SELECT string_agg(m.status::text, ',' ORDER BY m.milestone_type) FROM public.transfer_milestones m WHERE m.transfer_id = pg_temp.u(5, 12))
        = (SELECT ms FROM _r_snap WHERE id = pg_temp.u(5, 12)));
SELECT pg_temp.ok('open milestones of the relabelled become not_observable; the hammer stays completed',
  (SELECT count(*) FROM public.transfer_milestones WHERE transfer_id IN (pg_temp.u(5, 7), pg_temp.u(5, 8), pg_temp.u(5, 9), pg_temp.u(5, 10), pg_temp.u(5, 11)) AND status = 'not_observable') = 8
  AND (SELECT count(*) FROM public.transfer_milestones WHERE transfer_id IN (pg_temp.u(5, 7), pg_temp.u(5, 8), pg_temp.u(5, 9), pg_temp.u(5, 10), pg_temp.u(5, 11)) AND milestone_type = 'agreement_reached' AND status = 'completed') = 5);
SELECT pg_temp.ok('every change has a before-image with its class, lot and evidence lot',
  (SELECT count(*) FROM public.ownership_transfer_relabels WHERE reverted_at IS NULL) = 5
  AND (SELECT bool_and(previous_status = 'in_progress') FROM public.ownership_transfer_relabels)
  AND (SELECT sum(milestones_closed) FROM public.ownership_transfer_relabels) = 8
  AND (SELECT milestones_closed FROM public.ownership_transfer_relabels WHERE transfer_id = pg_temp.u(5, 10)) = 2
  AND EXISTS (SELECT 1 FROM public.ownership_transfer_relabels WHERE transfer_id = pg_temp.u(5, 7) AND new_status = 'cancelled' AND reason = 'relist_same_seller'
              AND auction_event_id = pg_temp.u(3, 40) AND evidence_lot_id = pg_temp.u(3, 41))
  AND EXISTS (SELECT 1 FROM public.ownership_transfer_relabels WHERE transfer_id = pg_temp.u(5, 10) AND new_status = 'recorded_unconfirmed' AND reason = 'confirmed_next_lot' AND evidence_lot_id IS NULL)
  AND EXISTS (SELECT 1 FROM public.ownership_transfer_relabels WHERE transfer_id = pg_temp.u(5, 9) AND new_status = 'recorded_unconfirmed' AND reason = 'hammer_only'));
CREATE TEMP TABLE _r_none AS SELECT public.relabel_auction_transfers_recorded_unconfirmed(NULL, 100, true) AS r;
SELECT pg_temp.ok('a re-run finds nothing', (SELECT (r ->> 'transfers')::int = 0 FROM _r_none));

-- revert
CREATE TEMP TABLE _r_rev_dry AS SELECT public.revert_auction_transfer_relabels(ARRAY[pg_temp.u(5, 7), pg_temp.u(5, 10), pg_temp.u(5, 12)], false) AS r;
SELECT pg_temp.ok('the revert dry run reports two to revert and one skipped (never relabelled) and writes nothing',
  (SELECT (r ->> 'reverted')::int = 2 AND (r ->> 'skipped')::int = 1 FROM _r_rev_dry)
  AND (SELECT status::text FROM public.ownership_transfers WHERE id = pg_temp.u(5, 7)) = 'cancelled');
SELECT public.revert_auction_transfer_relabels(ARRAY[pg_temp.u(5, 7), pg_temp.u(5, 10), pg_temp.u(5, 12)], true);
SELECT pg_temp.ok('a reverted transfer has its status back, cancelled_at cleared, milestones overdue or pending by deadline, and its relabel marked reverted',
  (SELECT status::text FROM public.ownership_transfers WHERE id = pg_temp.u(5, 7)) = 'in_progress'
  AND (SELECT cancelled_at FROM public.ownership_transfers WHERE id = pg_temp.u(5, 7)) IS NULL
  AND (SELECT status::text FROM public.ownership_transfers WHERE id = pg_temp.u(5, 10)) = 'in_progress'
  AND (SELECT string_agg(m.milestone_type || ':' || m.status::text, ',' ORDER BY m.milestone_type) FROM public.transfer_milestones m WHERE m.transfer_id = pg_temp.u(5, 10))
        = 'agreement_reached:completed,contact_exchanged:pending,deposit_sent:overdue'
  AND (SELECT count(*) FROM public.ownership_transfer_relabels WHERE reverted_at IS NOT NULL) = 2
  AND (SELECT status::text FROM public.ownership_transfers WHERE id = pg_temp.u(5, 11)) = 'cancelled');
-- a transfer that moved on its own is left alone
UPDATE public.ownership_transfers SET status = 'in_progress' WHERE id = pg_temp.u(5, 9);
CREATE TEMP TABLE _r_rev2 AS SELECT public.revert_auction_transfer_relabels(ARRAY[pg_temp.u(5, 9)], true) AS a,
  public.revert_auction_transfer_relabels(ARRAY[pg_temp.u(5, 7), pg_temp.u(5, 10)], true) AS b;
SELECT pg_temp.ok('a transfer whose status is no longer the relabelled one is skipped by the revert, and a second revert does nothing',
  (SELECT (a ->> 'reverted')::int = 0 AND (b ->> 'reverted')::int = 0 FROM _r_rev2)
  AND (SELECT count(*) FROM public.ownership_transfer_relabels WHERE reverted_at IS NULL) = 3);
CREATE TEMP TABLE _r_again AS SELECT public.relabel_auction_transfers_recorded_unconfirmed(NULL, 100, true) AS r;
SELECT pg_temp.ok('a reverted transfer can be relabelled again, with a new before-image, the open relabel stays unique, and a transfer whose relabel still stands is not taken twice',
  (SELECT (r ->> 'transfers')::int = 2 FROM _r_again)
  AND (SELECT status::text FROM public.ownership_transfers WHERE id = pg_temp.u(5, 7)) = 'cancelled'
  AND (SELECT count(*) FROM public.ownership_transfer_relabels WHERE transfer_id = pg_temp.u(5, 7)) = 2
  AND (SELECT count(*) FROM public.ownership_transfer_relabels WHERE transfer_id = pg_temp.u(5, 7) AND reverted_at IS NULL) = 1);

SELECT pg_temp.ok('anon and authenticated reach neither function nor the before-image table; service_role holds them',
  NOT has_function_privilege('anon', 'public.relabel_auction_transfers_recorded_unconfirmed(uuid,integer,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.relabel_auction_transfers_recorded_unconfirmed(uuid,integer,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.revert_auction_transfer_relabels(uuid[],boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.revert_auction_transfer_relabels(uuid[],boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.relabel_auction_transfers_recorded_unconfirmed(uuid,integer,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.revert_auction_transfer_relabels(uuid[],boolean)', 'EXECUTE')
  AND NOT has_table_privilege('anon', 'public.ownership_transfer_relabels', 'SELECT')
  AND NOT has_table_privilege('authenticated', 'public.ownership_transfer_relabels', 'SELECT')
  AND has_table_privilege('service_role', 'public.ownership_transfer_relabels', 'SELECT'));
