-- DRAFT — NOT APPLIED. Do not move into supabase/migrations without Skylar's approval.
--
-- Garage model, migration 03 (PRESENCE lane): real bodies for garage_now, garage_timeline and garage_stay_evidence_read
-- (the core migration shipped them as STUBs). Same signatures and return shapes as the core / CONTRACT.md.
-- State is COMPUTED AT READ TIME from the stays and their citations as of p_as_of; it is never stored (CONTRACT.md).
--
--   garage_state_at(garage, as_of)   internal, service_role only: every vehicle's state as of a date, no visibility gate.
--   garage_now(garage, as_of)        member read. rank >= 80 sees every car; a lower rank sees the cars
--                                    can_see_vehicle_via_garage() allows (VISIBILITY owns that body; the core stub fails closed).
--   garage_timeline(...)             member read, counts per bucket, each with its basis (jsonb).
--   garage_stay_evidence_read(stay)  member read, ids only (originator and affiliation stay separate).
--
-- State rules, in SPEC 4.3's order. "A" = location-proving citations, observed_at <= p_as_of:
--   1 a member's "here" is newer than every other A and every exit                      -> here        (basis member_assertion)
--   2 a member's "left" is newer than the last A                                         -> left        (basis member_assertion)
--   3 the record was deleted or its merge chain cannot be resolved                       -> gone
--   4 an exit (sale, listing, "not here") is dated at or after the last A                -> left        (departure_basis = that exit)
--   5 no A at all (related by org link / session / receipt / unconfirmed site only)      -> never_seen_here
--   6 last A <= here_days old -> here;  <= probable_days -> probably_here;  older -> stale   (thresholds: garage_derivation_versions)
-- A car is read from the NEWEST stay that had begun by p_as_of. An 'unseen_gap' close is not yet known before the next stay
-- arrives, so as of a date inside the gap the car is still on its earlier, open stay (SPEC 4.3 "unseen-gap split").
--
-- Known consequence of rule 1 (SPEC's order, kept literally): a member's "here" outranks the age thresholds, so an old
-- assertion keeps a car at 'here' until something newer arrives. Raised as an open question in PRESENCE.md.
--
-- Depends on migrations 00, 01 and 02.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.garage_state_at(p_garage uuid, p_as_of timestamptz DEFAULT now())
RETURNS TABLE (stay_id uuid, vehicle_id uuid, state text, relationship text, last_seen_at timestamptz, arrived_at timestamptz,
               departed_at timestamptz, departure_basis text, evidence_count integer, proving_evidence jsonb,
               derivation_version text)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH
  cur AS (
    SELECT DISTINCT ON (s.vehicle_id) s.*
    FROM public.garage_vehicle_stays s
    WHERE s.garage_id = p_garage AND s.arrived_at <= p_as_of
    ORDER BY s.vehicle_id, s.arrived_at DESC
  ),
  ev AS (
    SELECT e.stay_id, e.signal, e.signal_class, e.source_table, e.source_id, e.observed_at, e.recorded_at,
           e.originator_user_id, e.originator_external_identity_id, e.weight, e.note, e.relationship_hint,
           CASE WHEN e.signal = 'member_assertion' THEN a.kind END AS akind
    FROM public.garage_stay_evidence e
    JOIN cur c ON c.id = e.stay_id
    LEFT JOIN public.garage_stay_assertions a ON e.source_table = 'garage_stay_assertions' AND a.id::text = e.source_id
    WHERE e.observed_at <= p_as_of
  ),
  agg AS (
    SELECT e.stay_id,
           count(*)::integer AS n_ev,
           max(e.observed_at) FILTER (WHERE e.signal_class = 'A') AS last_a,
           max(e.observed_at) FILTER (WHERE e.signal_class = 'A' AND e.akind IS DISTINCT FROM 'here') AS last_a_other,
           max(e.observed_at) FILTER (WHERE e.akind = 'here') AS here_assert,
           max(e.observed_at) FILTER (WHERE e.akind = 'left') AS left_assert,
           max(e.observed_at) FILTER (WHERE e.signal_class = 'C' AND e.signal <> 'record_deleted_or_merged') AS last_exit,
           bool_or(e.signal = 'record_deleted_or_merged') AS is_gone
    FROM ev e GROUP BY e.stay_id
  ),
  st AS (
    SELECT c.*, v.here_days, v.probable_days, coalesce(g.n_ev, 0) AS n_ev, g.last_a, g.here_assert, g.left_assert, g.last_exit,
           coalesce(g.is_gone, false) AS is_gone,
           CASE
             WHEN g.here_assert IS NOT NULL AND g.here_assert > coalesce(g.last_a_other, '-infinity'::timestamptz)
                  AND g.here_assert > coalesce(g.last_exit, '-infinity'::timestamptz)                    THEN 'here'
             WHEN g.left_assert IS NOT NULL AND g.left_assert > coalesce(g.last_a, '-infinity'::timestamptz) THEN 'left'
             WHEN coalesce(g.is_gone, false)                                                              THEN 'gone'
             WHEN g.last_exit IS NOT NULL AND g.last_exit >= coalesce(g.last_a, '-infinity'::timestamptz)  THEN 'left'
             WHEN g.last_a IS NULL                                                                        THEN 'never_seen_here'
             WHEN p_as_of - g.last_a <= make_interval(days => v.here_days)                                THEN 'here'
             WHEN p_as_of - g.last_a <= make_interval(days => v.probable_days)                            THEN 'probably_here'
             ELSE 'stale'
           END AS state
    FROM cur c
    JOIN public.garage_derivation_versions v ON v.version = c.derivation_version
    LEFT JOIN agg g ON g.stay_id = c.id
  ),
  rel AS (  -- a relationship assertion in force at p_as_of beats the folded relationship (an assertion outranks derivation)
    SELECT DISTINCT ON (a.vehicle_id) a.vehicle_id, a.value ->> 'relationship' AS relationship
    FROM public.garage_stay_assertions a
    LEFT JOIN public.garage_stay_assertions sup ON sup.id = a.superseded_by
    WHERE a.garage_id = p_garage AND a.kind = 'relationship' AND a.asserted_at <= p_as_of
      AND (a.superseded_by IS NULL OR sup.asserted_at > p_as_of)
      AND (a.value ->> 'relationship') IN ('owned', 'dealer_inventory', 'consignment', 'customer_work', 'storage', 'passing_through', 'unknown')
    ORDER BY a.vehicle_id, a.asserted_at DESC
  )
  SELECT st.id, st.vehicle_id, st.state,
         coalesce(r.relationship, rh.relationship_hint, 'unknown'),   -- as of p_as_of: assertion in force, else the best cited hint then
         CASE WHEN st.last_a IS NOT NULL THEN st.last_a END,
         st.arrived_at,
         CASE WHEN st.departure_basis = 'unseen_gap' THEN NULL         -- not known until the next stay arrives
              WHEN st.departed_at <= p_as_of THEN st.departed_at END,
         CASE WHEN st.departure_basis = 'unseen_gap' THEN NULL
              WHEN st.departed_at <= p_as_of THEN st.departure_basis END,
         st.n_ev,
         proof.p,
         st.derivation_version
  FROM st
  LEFT JOIN rel r ON r.vehicle_id = st.vehicle_id
  LEFT JOIN LATERAL (
    SELECT x.relationship_hint FROM ev x
    WHERE x.stay_id = st.id AND x.relationship_hint IS NOT NULL
    ORDER BY CASE WHEN x.signal = 'member_assertion' THEN 3 WHEN x.source_table = 'organization_vehicles' THEN 2 ELSE 1 END DESC,
             x.weight DESC, x.observed_at DESC, x.relationship_hint
    LIMIT 1
  ) rh ON true
  LEFT JOIN LATERAL (
    SELECT jsonb_build_object('basis', x.proof_basis, 'signal', x.signal, 'signal_class', x.signal_class,
             'source_table', x.source_table, 'source_id', x.source_id, 'observed_at', x.observed_at,
             'originator_user_id', x.originator_user_id, 'originator_external_identity_id', x.originator_external_identity_id,
             'weight', x.weight, 'note', x.note) AS p
    FROM (
      SELECT e.*, CASE WHEN e.signal = 'member_assertion' THEN 'member_assertion' ELSE e.signal END AS proof_basis
      FROM ev e
      WHERE e.stay_id = st.id
        AND CASE st.state
              WHEN 'gone'            THEN e.signal = 'record_deleted_or_merged'
              WHEN 'never_seen_here' THEN e.signal_class = 'B'
              WHEN 'left'            THEN e.signal_class = 'C' AND e.signal <> 'record_deleted_or_merged'
                                          AND e.observed_at >= coalesce(st.last_a, '-infinity'::timestamptz)
              ELSE e.signal_class = 'A'
            END
      ORDER BY
        CASE WHEN st.state = 'left' THEN extract(epoch FROM e.observed_at) ELSE -extract(epoch FROM e.observed_at) END,  -- left: the first exit; otherwise the latest proof
        e.weight DESC, e.source_id
      LIMIT 1
    ) x
  ) proof ON true
$fn$;
COMMENT ON FUNCTION public.garage_state_at(uuid, timestamptz) IS
  'Internal. Every vehicle''s presence state as of a date, from stays and citations (never stored). No visibility gate: service_role only; garage_now / garage_timeline are the gated readers.';

-- ---------------------------------------------------------------------------------------------------------------
-- garage_now: one row per vehicle. Signature and shape are the core's.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.garage_now(p_garage uuid, p_as_of timestamptz DEFAULT now())
RETURNS TABLE (vehicle_id uuid, state text, relationship text, last_seen_at timestamptz, arrived_at timestamptz,
               departed_at timestamptz, evidence_count integer, proving_evidence jsonb, my_visibility text)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE v_rank integer := public.garage_member_rank(p_garage);
BEGIN
  IF v_rank < 10 THEN RAISE EXCEPTION 'garage_now: not a member of this garage' USING ERRCODE = '42501'; END IF;
  RETURN QUERY
  SELECT s.vehicle_id, s.state, s.relationship, s.last_seen_at, s.arrived_at, s.departed_at, s.evidence_count, s.proving_evidence,
         'full'::text
  FROM public.garage_state_at(p_garage, p_as_of) s
  WHERE v_rank >= 80 OR public.can_see_vehicle_via_garage(s.vehicle_id)
  ORDER BY CASE s.state WHEN 'here' THEN 1 WHEN 'probably_here' THEN 2 WHEN 'stale' THEN 3 WHEN 'never_seen_here' THEN 4
                        WHEN 'left' THEN 5 ELSE 6 END,
           s.last_seen_at DESC NULLS LAST, s.vehicle_id;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- garage_timeline: per bucket, evaluated at the bucket's last instant (or now, for the current bucket).
--   here_count     vehicles whose state then was here or probably_here
--   arrivals       stays whose first location-proving sighting fell inside the bucket
--   departures     stays that ended inside the bucket at a DATED exit (sale, listing, a member's word, a deleted record); the
--                  breakdown by basis is in basis. A stay closed only by an unseen gap is NOT counted: its departed_at is its last
--                  sighting, the earliest the car could have left, not a date it left; it is reported as basis.unseen_gap_closures.
--   unknown_count  vehicles related to the garage whose state then was stale or never_seen_here (the UI asks, it does not guess)
--   basis          {as_of, derivation_versions, states{...}, site_known, scope, departures_by_basis}
-- Months before any confirmed site read site_known=false: their counts are what the evidence says, not "the garage was empty".
-- rank < 80 counts only the cars can_see_vehicle_via_garage allows (scope 'visible_to_viewer'), never a hidden car.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.garage_timeline(p_garage uuid, p_from date, p_to date, p_bucket text DEFAULT 'month')
RETURNS TABLE (bucket date, here_count integer, arrivals integer, departures integer, unknown_count integer, basis jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_rank integer := public.garage_member_rank(p_garage);
  v_step interval;
  v_start date;
  v_last date;
BEGIN
  IF v_rank < 10 THEN RAISE EXCEPTION 'garage_timeline: not a member of this garage' USING ERRCODE = '42501'; END IF;
  IF p_bucket NOT IN ('day', 'week', 'month', 'quarter', 'year') THEN
    RAISE EXCEPTION 'garage_timeline: bucket must be day, week, month, quarter or year' USING ERRCODE = '22023';
  END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_to < p_from THEN
    RAISE EXCEPTION 'garage_timeline: need p_from <= p_to' USING ERRCODE = '22023';
  END IF;
  v_step := CASE p_bucket WHEN 'day' THEN interval '1 day' WHEN 'week' THEN interval '1 week' WHEN 'month' THEN interval '1 month'
                          WHEN 'quarter' THEN interval '3 months' ELSE interval '1 year' END;
  v_start := date_trunc(p_bucket, p_from::timestamp)::date;
  v_last := least(p_to, (now() AT TIME ZONE 'UTC')::date);     -- no buckets in the future
  IF (SELECT count(*) FROM generate_series(v_start::timestamp, v_last::timestamp, v_step)) > 800 THEN
    RAISE EXCEPTION 'garage_timeline: more than 800 buckets; use a coarser bucket' USING ERRCODE = '54000';
  END IF;

  RETURN QUERY
  WITH b AS (
    SELECT g.bs::date AS bstart, (g.bs AT TIME ZONE 'UTC') AS bstart_ts,
           ((g.bs + v_step) AT TIME ZONE 'UTC') AS bnext,
           least(((g.bs + v_step) AT TIME ZONE 'UTC') - interval '1 microsecond', now()) AS as_of
    FROM generate_series(v_start::timestamp, v_last::timestamp, v_step) AS g(bs)
  )
  SELECT b.bstart,
         x.here_c, coalesce(arr.n, 0), coalesce(dep.n, 0), x.unk_c,
         jsonb_build_object(
           'as_of', b.as_of,
           'bucket', p_bucket,
           'scope', CASE WHEN v_rank >= 80 THEN 'all_vehicles_in_garage' ELSE 'visible_to_viewer' END,
           'derivation_versions', coalesce((SELECT jsonb_agg(DISTINCT s.derivation_version) FROM public.garage_vehicle_stays s WHERE s.garage_id = p_garage), '[]'::jsonb),
           'states', x.states,
           'related_vehicles', x.total,
           'site_known', EXISTS (SELECT 1 FROM public.garage_sites gs
                                  WHERE gs.garage_id = p_garage AND gs.confirmed_at IS NOT NULL
                                    AND (gs.valid_from IS NULL OR gs.valid_from <= (b.as_of AT TIME ZONE 'UTC')::date)
                                    AND (gs.valid_to IS NULL OR gs.valid_to >= b.bstart)),
           'departures_by_basis', coalesce(dep.by_basis, '{}'::jsonb),
           'unseen_gap_closures', coalesce(dep.gap_closures, 0))
  FROM b
  CROSS JOIN LATERAL (
    SELECT count(*) FILTER (WHERE q.state IN ('here', 'probably_here'))::integer AS here_c,
           count(*) FILTER (WHERE q.state IN ('stale', 'never_seen_here'))::integer AS unk_c,
           count(*)::integer AS total,
           jsonb_build_object(
             'here', count(*) FILTER (WHERE q.state = 'here'), 'probably_here', count(*) FILTER (WHERE q.state = 'probably_here'),
             'stale', count(*) FILTER (WHERE q.state = 'stale'), 'left', count(*) FILTER (WHERE q.state = 'left'),
             'gone', count(*) FILTER (WHERE q.state = 'gone'), 'never_seen_here', count(*) FILTER (WHERE q.state = 'never_seen_here')) AS states
    FROM public.garage_state_at(p_garage, b.as_of) q
    WHERE v_rank >= 80 OR public.can_see_vehicle_via_garage(q.vehicle_id)
  ) x
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS n FROM public.garage_vehicle_stays s
    WHERE s.garage_id = p_garage AND s.arrived_at >= b.bstart_ts AND s.arrived_at < b.bnext
      AND EXISTS (SELECT 1 FROM public.garage_stay_evidence e WHERE e.stay_id = s.id AND e.signal_class = 'A')
      AND (v_rank >= 80 OR public.can_see_vehicle_via_garage(s.vehicle_id))
  ) arr ON true
  LEFT JOIN LATERAL (
    SELECT coalesce(sum(d.k) FILTER (WHERE d.basis <> 'unseen_gap'), 0)::integer AS n,
           jsonb_object_agg(d.basis, d.k) FILTER (WHERE d.basis <> 'unseen_gap') AS by_basis,
           coalesce(sum(d.k) FILTER (WHERE d.basis = 'unseen_gap'), 0)::integer AS gap_closures
    FROM (SELECT s.departure_basis AS basis, count(*) AS k FROM public.garage_vehicle_stays s
          WHERE s.garage_id = p_garage AND s.departed_at >= b.bstart_ts AND s.departed_at < b.bnext
            AND EXISTS (SELECT 1 FROM public.garage_stay_evidence e WHERE e.stay_id = s.id AND e.signal_class = 'A')
            AND (v_rank >= 80 OR public.can_see_vehicle_via_garage(s.vehicle_id))
          GROUP BY s.departure_basis) d
  ) dep ON true
  ORDER BY b.bstart;
END $$;

-- ---------------------------------------------------------------------------------------------------------------
-- garage_stay_evidence_read: the citations behind one stay. Ids only: the originator and the garage the evidence belongs to
-- are separate facts, and neither is a name. rank >= 80, or the car is visible to the viewer, sees all citations; anyone else
-- (an originator) sees only the citations they made.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.garage_stay_evidence_read(p_stay uuid)
RETURNS TABLE (signal text, source_table text, source_id text, observed_at timestamptz, recorded_at timestamptz,
               originator_user_id uuid, originator_external_identity_id uuid, weight numeric, affiliation_garage_id uuid)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
#variable_conflict use_column
DECLARE
  v_garage uuid; v_vehicle uuid; v_rank integer; v_all boolean;
BEGIN
  SELECT s.garage_id, s.vehicle_id INTO v_garage, v_vehicle FROM public.garage_vehicle_stays s WHERE s.id = p_stay;
  IF NOT FOUND THEN RETURN; END IF;
  v_rank := public.garage_member_rank(v_garage);
  IF v_rank < 10 THEN RAISE EXCEPTION 'garage_stay_evidence_read: not a member of this garage' USING ERRCODE = '42501'; END IF;
  v_all := v_rank >= 80 OR public.can_see_vehicle_via_garage(v_vehicle);
  RETURN QUERY
  SELECT e.signal, e.source_table, e.source_id, e.observed_at, e.recorded_at, e.originator_user_id,
         e.originator_external_identity_id, e.weight, v_garage
  FROM public.garage_stay_evidence e
  WHERE e.stay_id = p_stay AND (v_all OR e.originator_user_id = auth.uid())
  ORDER BY e.observed_at DESC, e.signal, e.source_id;
END $$;

REVOKE EXECUTE ON FUNCTION public.garage_state_at(uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.garage_state_at(uuid, timestamptz) TO service_role;
REVOKE EXECUTE ON FUNCTION public.garage_now(uuid, timestamptz), public.garage_timeline(uuid, date, date, text),
  public.garage_stay_evidence_read(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.garage_now(uuid, timestamptz), public.garage_timeline(uuid, date, date, text),
  public.garage_stay_evidence_read(uuid) TO authenticated, service_role;
