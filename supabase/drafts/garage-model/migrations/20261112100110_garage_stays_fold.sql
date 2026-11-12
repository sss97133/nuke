-- DRAFT — NOT APPLIED. Do not move into supabase/migrations without Skylar's approval.
--
-- Garage model, migration 02 (PRESENCE lane): the stay fold. Turns the signals of migration 01 into
-- garage_vehicle_stays + garage_stay_evidence. Design: docs/garage-model/SPEC.md section 4, docs/garage-model/PRESENCE.md.
--
--   garage_stays_dry_run(garage, version, as_of)   READ-ONLY. Returns the stays (with their citations as jsonb) and writes nothing.
--   garage_fold_stays(garage, version, as_of, allow_past)   The writer. Rebuilds the stays of ONE garage from the dry run.
--
-- Rules (SPEC 4.1-4.4, every one tested in supabase/sql/test_garage_presence.sql):
--   * a stay = one vehicle (terminal record) in one garage for one continuous interval with ONE relationship.
--   * arrived_at = first location-proving (class A) sighting; last_seen_at = last class A sighting.
--   * a car's class A sightings split into separate stays at an unseen gap > gap_days (180 in v1) and at any exit
--     signal between two sightings (a sale, a listing, a member's "left", a "not here"). A returning car is a second stay.
--   * a stay ends (departed_at + departure_basis) at the FIRST exit dated at or after its last sighting and before the next
--     stay; with no exit but a later stay, it ends at its own last sighting with basis 'unseen_gap' (the earliest it could have left).
--   * record deleted, or a merge chain that cannot be resolved: the car's LAST stay ends with basis 'record_deleted_or_merged'
--     whatever the date (departed_at is clamped up to last_seen_at; the citation keeps the real date). A merge to a live record
--     is not an exit: history moves to the terminal record (migration 01).
--   * a car with only class B evidence (an org link, a session, a receipt, a sighting at an unconfirmed site) gets one stay with
--     last_seen_at = arrived_at = its earliest evidence and NO class A citation: garage_now reads that as never_seen_here.
--     Exits do not close such a stay (a car never seen here cannot have left), except 'gone'.
--   * relationship per stay = the strongest hint in force at the stay's end: an assertion (rank 3) beats an organization link
--     (2) beats a member's permission / contributor row (1); ties by weight, then latest. No hint: 'unknown'.
--     CONTRIBUTION NEVER IMPLIES 'owned' (migration 01 only hints owned from an operator org link, or an owner permission held by a
--     manager-or-above member).
--   * confidence (numeric(3,2)) is a labelled JUDGMENT of the v1 fold, not a measurement:
--       with location evidence:  0.30 + 0.50 * (1 - 1/(1 + sum of class A weights)) + 0.10 if more than one originator
--                                + 0.05 if relationship known + 0.05 if a member asserted "here"      (capped 0.99)
--       without:                 0.10 + 0.15 * (1 - 1/(1 + sum of class B weights))
--   * idempotent: stay ids are a hash of (garage, vehicle, arrived_at), so a re-run keeps ids, leaves unchanged rows untouched
--     (derived_at moves only when a row's content changed) and recorded_at of a citation is never rewritten.
--   * confined: the writer inserts, updates and deletes ONLY garage_vehicle_stays and garage_stay_evidence (and works in
--     pg_temp). It never touches testimony, assertions, members, sites, or any non-garage table.
--
-- Depends on 20261112100000_garage_core.sql and 20261112100100_garage_presence_signals.sql.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- Deterministic id for a stay.
CREATE OR REPLACE FUNCTION public.garage_stay_id(p_garage uuid, p_vehicle uuid, p_arrived timestamptz)
RETURNS uuid
LANGUAGE sql IMMUTABLE PARALLEL SAFE
AS $$
  SELECT md5(p_garage::text || '|' || p_vehicle::text || '|' || to_char(p_arrived AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'))::uuid
$$;

-- ---------------------------------------------------------------------------------------------------------------
-- DRY RUN: the stays the fold would write, and the citations behind each (jsonb), as of p_as_of. Writes nothing.
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.garage_stays_dry_run(p_garage uuid, p_version text DEFAULT 'v1', p_as_of timestamptz DEFAULT now())
RETURNS TABLE (stay_id uuid, vehicle_id uuid, relationship text, organization_id uuid, arrived_at timestamptz,
               last_seen_at timestamptz, departed_at timestamptz, departure_basis text, confidence numeric,
               evidence_count integer, has_location_evidence boolean, evidence jsonb)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  WITH
  prm AS (SELECT * FROM public.garage_derivation_versions WHERE version = p_version),
  sig AS MATERIALIZED (SELECT * FROM public.garage_presence_signals(p_garage, p_as_of, p_version)),
  gone AS (
    SELECT DISTINCT ON (s.vehicle_id) s.vehicle_id, s.observed_at, s.signal, s.source_table, s.source_id
    FROM sig s WHERE s.signal = 'record_deleted_or_merged' ORDER BY s.vehicle_id, s.observed_at, s.source_id
  ),
  exits AS (SELECT * FROM sig s WHERE s.signal_class = 'C' AND s.signal <> 'record_deleted_or_merged'),
  a_ord AS (
    SELECT s.*, lag(s.observed_at) OVER w AS prev_t
    FROM sig s WHERE s.signal_class = 'A'
    WINDOW w AS (PARTITION BY s.vehicle_id ORDER BY s.observed_at, s.signal, s.source_id)
  ),
  a_num AS (
    SELECT o.*, sum(CASE
        WHEN o.prev_t IS NULL THEN 1
        WHEN o.observed_at - o.prev_t > make_interval(days => (SELECT gap_days FROM prm)) THEN 1
        WHEN EXISTS (SELECT 1 FROM exits e WHERE e.vehicle_id = o.vehicle_id AND e.observed_at >= o.prev_t AND e.observed_at < o.observed_at) THEN 1
        ELSE 0 END) OVER (PARTITION BY o.vehicle_id ORDER BY o.observed_at, o.signal, o.source_id ROWS UNBOUNDED PRECEDING)::integer AS n
    FROM a_ord o
  ),
  a_stay AS (
    SELECT vehicle_id, n, min(observed_at) AS arrived, max(observed_at) AS last_seen FROM a_num GROUP BY vehicle_id, n
  ),
  a_stay2 AS (
    SELECT s.*, lead(s.arrived) OVER (PARTITION BY s.vehicle_id ORDER BY s.n) AS next_arrived,
           (s.n = max(s.n) OVER (PARTITION BY s.vehicle_id)) AS is_last
    FROM a_stay s
  ),
  b_only AS (
    SELECT s.vehicle_id, min(s.observed_at) AS arrived
    FROM sig s WHERE s.signal_class = 'B' AND s.vehicle_id NOT IN (SELECT vehicle_id FROM a_stay)
    GROUP BY s.vehicle_id
  ),
  stays0 AS (
    SELECT vehicle_id, n, arrived, last_seen, next_arrived, is_last, true AS has_a FROM a_stay2
    UNION ALL
    SELECT vehicle_id, 1, arrived, arrived, NULL::timestamptz, true, false FROM b_only
  ),
  close_exit AS (
    SELECT DISTINCT ON (s.vehicle_id, s.n) s.vehicle_id, s.n, e.observed_at, e.signal, e.source_table, e.source_id
    FROM stays0 s JOIN exits e ON e.vehicle_id = s.vehicle_id AND e.observed_at >= s.last_seen
                              AND (s.next_arrived IS NULL OR e.observed_at < s.next_arrived)
    WHERE s.has_a
    ORDER BY s.vehicle_id, s.n, e.observed_at, e.weight DESC, e.source_id
  ),
  stays1 AS (
    SELECT s.vehicle_id, s.n, s.arrived, s.last_seen, s.next_arrived, s.has_a,
           CASE WHEN g.vehicle_id IS NOT NULL AND s.is_last THEN greatest(g.observed_at, s.last_seen)
                WHEN ce.vehicle_id IS NOT NULL THEN ce.observed_at
                WHEN s.next_arrived IS NOT NULL THEN s.last_seen END AS departed_at,
           CASE WHEN g.vehicle_id IS NOT NULL AND s.is_last THEN 'record_deleted_or_merged'
                WHEN ce.vehicle_id IS NOT NULL THEN ce.signal
                WHEN s.next_arrived IS NOT NULL THEN 'unseen_gap' END AS departure_basis,
           CASE WHEN g.vehicle_id IS NOT NULL AND s.is_last THEN g.signal ELSE ce.signal END AS close_signal,
           CASE WHEN g.vehicle_id IS NOT NULL AND s.is_last THEN g.source_table ELSE ce.source_table END AS close_table,
           CASE WHEN g.vehicle_id IS NOT NULL AND s.is_last THEN g.source_id ELSE ce.source_id END AS close_id,
           public.garage_stay_id(p_garage, s.vehicle_id, s.arrived) AS stay_id
    FROM stays0 s
    LEFT JOIN gone g ON g.vehicle_id = s.vehicle_id
    LEFT JOIN close_exit ce ON ce.vehicle_id = s.vehicle_id AND ce.n = s.n
  ),
  stays2 AS (  -- end_bound: how late a supporting record or a hint can be and still belong to the stay
    SELECT s.*, CASE WHEN s.departure_basis = 'unseen_gap' THEN s.next_arrived ELSE s.departed_at END AS end_bound
    FROM stays1 s
  ),
  a_att AS (
    SELECT st.stay_id, n.signal, n.signal_class, n.source_table, n.source_id, n.observed_at, n.originator_user_id,
           n.originator_external_identity_id, n.weight, n.note, n.relationship_hint
    FROM a_num n JOIN stays2 st ON st.vehicle_id = n.vehicle_id AND st.n = n.n AND st.has_a
  ),
  b_att AS (
    SELECT pick.stay_id, g.signal, g.signal_class, g.source_table, g.source_id, g.observed_at, g.originator_user_id,
           g.originator_external_identity_id, g.weight, g.note, g.relationship_hint
    FROM sig g
    JOIN LATERAL (
      SELECT st.stay_id, st.end_bound
      FROM stays2 st
      WHERE st.vehicle_id = g.vehicle_id
        AND (st.arrived <= g.observed_at OR g.observed_at >= st.arrived - make_interval(days => (SELECT gap_days FROM prm)))
      ORDER BY (st.arrived <= g.observed_at) DESC, CASE WHEN st.arrived <= g.observed_at THEN st.arrived END DESC NULLS LAST, st.arrived
      LIMIT 1
    ) pick ON true
    WHERE g.signal_class = 'B' AND (pick.end_bound IS NULL OR g.observed_at <= pick.end_bound)
  ),
  hint_cand AS (
    SELECT st.stay_id, g.relationship_hint, g.organization_id, g.signal, g.source_table, g.source_id, g.observed_at,
           g.originator_user_id, g.originator_external_identity_id, g.weight, g.signal_class, g.note,
           CASE WHEN g.signal = 'member_assertion' THEN 3 WHEN g.source_table = 'organization_vehicles' THEN 2 ELSE 1 END AS prio
    FROM sig g JOIN stays2 st ON st.vehicle_id = g.vehicle_id
    WHERE g.relationship_hint IN ('owned', 'dealer_inventory', 'consignment', 'customer_work', 'storage', 'passing_through')
      AND (st.end_bound IS NULL OR g.observed_at <= st.end_bound)
  ),
  hint AS (
    SELECT DISTINCT ON (h.stay_id) h.*
    FROM hint_cand h ORDER BY h.stay_id, h.prio DESC, h.weight DESC, h.observed_at DESC, h.relationship_hint, h.source_id
  ),
  close_att AS (  -- the exit that ended the stay is cited, so "why did it leave" has an answer
    SELECT st.stay_id, g.signal, g.signal_class, g.source_table, g.source_id, g.observed_at, g.originator_user_id,
           g.originator_external_identity_id, g.weight, g.note, g.relationship_hint
    FROM stays2 st JOIN sig g ON g.vehicle_id = st.vehicle_id AND g.signal = st.close_signal
                              AND g.source_table = st.close_table AND g.source_id = st.close_id
    WHERE st.close_signal IS NOT NULL
  ),
  ev AS (
    SELECT * FROM a_att
    UNION SELECT * FROM b_att
    UNION SELECT stay_id, signal, signal_class, source_table, source_id, observed_at, originator_user_id,
                 originator_external_identity_id, weight, note, relationship_hint FROM hint_cand   -- every hint in force is cited, not only the winner
    UNION SELECT * FROM close_att
  ),
  evagg AS (
    SELECT e.stay_id,
           count(*)::integer AS n_ev,
           coalesce(sum(e.weight) FILTER (WHERE e.signal_class = 'A'), 0) AS a_w,
           coalesce(sum(e.weight) FILTER (WHERE e.signal_class = 'B'), 0) AS b_w,
           count(DISTINCT coalesce(e.originator_user_id::text, e.originator_external_identity_id::text))
             FILTER (WHERE e.signal_class = 'A') AS n_orig,
           bool_or(e.signal = 'member_assertion' AND e.signal_class = 'A') AS here_assert,
           jsonb_agg(jsonb_build_object('signal', e.signal, 'signal_class', e.signal_class, 'source_table', e.source_table,
                       'source_id', e.source_id, 'observed_at', e.observed_at, 'originator_user_id', e.originator_user_id,
                       'originator_external_identity_id', e.originator_external_identity_id, 'weight', e.weight, 'note', e.note,
                       'relationship_hint', e.relationship_hint)
                     ORDER BY e.observed_at, e.signal, e.source_id) AS evidence
    FROM ev e GROUP BY e.stay_id
  )
  SELECT st.stay_id, st.vehicle_id, coalesce(h.relationship_hint, 'unknown'), h.organization_id,
         st.arrived, st.last_seen, st.departed_at, st.departure_basis,
         (CASE WHEN st.has_a
               THEN least(0.99, 0.30 + 0.50 * (1 - 1 / (1 + ea.a_w)) + (CASE WHEN ea.n_orig > 1 THEN 0.10 ELSE 0 END)
                          + (CASE WHEN h.relationship_hint IS NOT NULL THEN 0.05 ELSE 0 END) + (CASE WHEN ea.here_assert THEN 0.05 ELSE 0 END))
               ELSE 0.10 + 0.15 * (1 - 1 / (1 + ea.b_w)) END)::numeric(3, 2),
         ea.n_ev, EXISTS (SELECT 1 FROM a_att aa WHERE aa.stay_id = st.stay_id), ea.evidence
  FROM stays2 st
  JOIN evagg ea ON ea.stay_id = st.stay_id
  LEFT JOIN hint h ON h.stay_id = st.stay_id
  ORDER BY st.vehicle_id, st.arrived
$fn$;
COMMENT ON FUNCTION public.garage_stays_dry_run(uuid, text, timestamptz) IS
  'Read-only. The stays garage_fold_stays would write for this garage as of p_as_of, each with its citations as jsonb. service_role only.';

-- ---------------------------------------------------------------------------------------------------------------
-- THE WRITER. Rebuilds the stays of one garage; idempotent; confined to the two derived tables.
-- p_as_of in the past is refused unless p_allow_past (it would replace the current fold with a historical one).
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.garage_fold_stays(
  p_garage uuid, p_version text DEFAULT 'v1', p_as_of timestamptz DEFAULT now(), p_allow_past boolean DEFAULT false)
RETURNS TABLE (stays_total integer, stays_inserted integer, stays_updated integer, stays_deleted integer, stays_unchanged integer,
               citations_total integer)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
#variable_conflict use_column
DECLARE
  v_status text;
  n_ins integer := 0; n_upd integer := 0; n_del integer := 0; n_tot integer := 0; n_ev integer := 0; k integer;
BEGIN
  SELECT g.status INTO v_status FROM public.garages g WHERE g.id = p_garage;
  IF NOT FOUND THEN RAISE EXCEPTION 'garage % does not exist', p_garage USING ERRCODE = '02000'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.garage_derivation_versions WHERE version = p_version) THEN
    RAISE EXCEPTION 'unknown derivation version %', p_version USING ERRCODE = '22023';
  END IF;
  IF p_as_of < now() - interval '1 minute' AND NOT p_allow_past THEN
    RAISE EXCEPTION 'refusing to replace the current fold with an as-of % fold; read garage_stays_dry_run instead, or pass p_allow_past', p_as_of
      USING ERRCODE = '55000';
  END IF;
  IF v_status = 'closed' THEN   -- SPEC 2.3: a closed garage keeps its history and derives no new stays
    RAISE NOTICE 'garage % is closed; no stays derived', p_garage;
    RETURN QUERY SELECT 0, 0, 0, 0, 0, 0; RETURN;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('garage_fold:' || p_garage::text, 0));

  DROP TABLE IF EXISTS pg_temp._gf_stays;
  CREATE TEMP TABLE _gf_stays ON COMMIT DROP AS SELECT * FROM public.garage_stays_dry_run(p_garage, p_version, p_as_of);

  -- 1. stays that the evidence no longer supports (their citations go with them: ON DELETE CASCADE)
  DELETE FROM public.garage_vehicle_stays s
   WHERE s.garage_id = p_garage AND NOT EXISTS (SELECT 1 FROM _gf_stays t WHERE t.stay_id = s.id);
  GET DIAGNOSTICS n_del = ROW_COUNT;

  -- 2. changed stays. Two passes so a stay closing is applied before another one on the same car re-opens.
  UPDATE public.garage_vehicle_stays s
     SET relationship = t.relationship, organization_id = t.organization_id, last_seen_at = t.last_seen_at,
         departed_at = t.departed_at, departure_basis = t.departure_basis, confidence = t.confidence,
         evidence_count = t.evidence_count, derivation_version = p_version, derived_at = now()
    FROM _gf_stays t
   WHERE s.id = t.stay_id AND s.garage_id = p_garage AND t.departed_at IS NOT NULL
     AND (s.relationship, s.organization_id, s.last_seen_at, s.departed_at, s.departure_basis, s.confidence, s.evidence_count, s.derivation_version)
         IS DISTINCT FROM (t.relationship, t.organization_id, t.last_seen_at, t.departed_at, t.departure_basis, t.confidence, t.evidence_count, p_version);
  GET DIAGNOSTICS k = ROW_COUNT; n_upd := n_upd + k;
  UPDATE public.garage_vehicle_stays s
     SET relationship = t.relationship, organization_id = t.organization_id, last_seen_at = t.last_seen_at,
         departed_at = t.departed_at, departure_basis = t.departure_basis, confidence = t.confidence,
         evidence_count = t.evidence_count, derivation_version = p_version, derived_at = now()
    FROM _gf_stays t
   WHERE s.id = t.stay_id AND s.garage_id = p_garage AND t.departed_at IS NULL
     AND (s.relationship, s.organization_id, s.last_seen_at, s.departed_at, s.departure_basis, s.confidence, s.evidence_count, s.derivation_version)
         IS DISTINCT FROM (t.relationship, t.organization_id, t.last_seen_at, t.departed_at, t.departure_basis, t.confidence, t.evidence_count, p_version);
  GET DIAGNOSTICS k = ROW_COUNT; n_upd := n_upd + k;

  -- 3. new stays
  INSERT INTO public.garage_vehicle_stays (id, garage_id, vehicle_id, relationship, organization_id, arrived_at, last_seen_at,
                                           departed_at, departure_basis, confidence, evidence_count, derivation_version)
  SELECT t.stay_id, p_garage, t.vehicle_id, t.relationship, t.organization_id, t.arrived_at, t.last_seen_at,
         t.departed_at, t.departure_basis, t.confidence, t.evidence_count, p_version
  FROM _gf_stays t WHERE NOT EXISTS (SELECT 1 FROM public.garage_vehicle_stays s WHERE s.id = t.stay_id)
  ORDER BY t.vehicle_id, t.arrived_at;
  GET DIAGNOSTICS n_ins = ROW_COUNT;

  -- 4. citations: drop the ones no longer derived, add or refresh the rest. recorded_at (the knowledge clock) is never rewritten.
  DROP TABLE IF EXISTS pg_temp._gf_ev;
  CREATE TEMP TABLE _gf_ev ON COMMIT DROP AS
  SELECT t.stay_id, x.signal, x.signal_class, x.source_table, x.source_id, x.observed_at, x.originator_user_id,
         x.originator_external_identity_id, x.weight, x.note, x.relationship_hint
  FROM _gf_stays t
  CROSS JOIN LATERAL jsonb_to_recordset(t.evidence) AS x(signal text, signal_class text, source_table text, source_id text,
       observed_at timestamptz, originator_user_id uuid, originator_external_identity_id uuid, weight numeric, note text,
       relationship_hint text);

  DELETE FROM public.garage_stay_evidence e
   USING public.garage_vehicle_stays s
   WHERE e.stay_id = s.id AND s.garage_id = p_garage
     AND NOT EXISTS (SELECT 1 FROM _gf_ev x WHERE x.stay_id = e.stay_id AND x.signal = e.signal
                       AND x.source_table = e.source_table AND x.source_id = e.source_id);

  INSERT INTO public.garage_stay_evidence (stay_id, signal, signal_class, source_table, source_id, observed_at,
                                           originator_user_id, originator_external_identity_id, weight, note, relationship_hint)
  SELECT x.stay_id, x.signal, x.signal_class, x.source_table, x.source_id, x.observed_at, x.originator_user_id,
         x.originator_external_identity_id, x.weight, x.note, x.relationship_hint
  FROM _gf_ev x
  ON CONFLICT (stay_id, signal, source_table, source_id) DO UPDATE
     SET observed_at = EXCLUDED.observed_at, signal_class = EXCLUDED.signal_class, weight = EXCLUDED.weight, note = EXCLUDED.note,
         relationship_hint = EXCLUDED.relationship_hint, originator_user_id = EXCLUDED.originator_user_id, originator_external_identity_id = EXCLUDED.originator_external_identity_id
   WHERE (public.garage_stay_evidence.observed_at, public.garage_stay_evidence.signal_class, public.garage_stay_evidence.weight,
          public.garage_stay_evidence.note, public.garage_stay_evidence.relationship_hint, public.garage_stay_evidence.originator_user_id,
          public.garage_stay_evidence.originator_external_identity_id)
         IS DISTINCT FROM (EXCLUDED.observed_at, EXCLUDED.signal_class, EXCLUDED.weight, EXCLUDED.note, EXCLUDED.relationship_hint,
                           EXCLUDED.originator_user_id, EXCLUDED.originator_external_identity_id);

  SELECT count(*) INTO n_tot FROM _gf_stays;
  SELECT count(*) INTO n_ev FROM _gf_ev;
  RETURN QUERY SELECT n_tot, n_ins, n_upd, n_del, greatest(n_tot - n_ins - n_upd, 0), n_ev;
END
$fn$;
COMMENT ON FUNCTION public.garage_fold_stays(uuid, text, timestamptz, boolean) IS
  'Rebuilds garage_vehicle_stays and garage_stay_evidence for ONE garage from garage_presence_signals. Idempotent, deterministic ids, writes nothing outside those two garage_* tables. service_role only; run by hand first (SPEC 10.1 step 2).';

REVOKE EXECUTE ON FUNCTION public.garage_stay_id(uuid, uuid, timestamptz), public.garage_stays_dry_run(uuid, text, timestamptz),
  public.garage_fold_stays(uuid, text, timestamptz, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.garage_stay_id(uuid, uuid, timestamptz), public.garage_stays_dry_run(uuid, text, timestamptz),
  public.garage_fold_stays(uuid, text, timestamptz, boolean) TO service_role;
