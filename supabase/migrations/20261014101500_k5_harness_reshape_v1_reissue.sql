-- Re-issue of 20261014093000 (failed on apply 2026-10-14 08:15Z, rolled back, nothing written: the signal key slug
-- folded ETH_TX+ and ETH_TX- into one key). Signal keys are now the net code itself, unique like the net code.
-- The K5's decided wires, reshaped into the harness tables (signal -> net -> segment). Case ledger 13.12.2.
--
-- Source rows: the 390 live, decided vehicle_custom_circuits of vehicle e08bf694 (the K5) and their 891-row family in
-- wire_termination_specs. Measured 2026-10-14: 245 wires end at two wire ends, 56 cross the 61-pin connector (four
-- ends), 50 pass one other junction (three ends), 2 have six, 15 have one end and 22 have none; all 390 are uncut.
-- The 138 concept wires (the April 2026 plan, unreviewed, no wire ends) stay in the legacy table as candidates.
--
-- Rules (v1):
-- * A segment is one physical wire between two wire ends. A wire is split at every terminating pass-through (door
--   pass-through plugs, the retired body bulkheads, the CAN bus node). The 61-pin's cabin and engine halves are a mate,
--   not a wire, so a crossing wire becomes two segments. A grommet (FIREWALL-GROMMET, AMP-PASS, the generic "Firewall")
--   does not terminate the wire and does not split it. A missing end stays NULL.
-- * Ends are ordered from the wire's from-end. At the 61-pin, the half on the from-end's side comes first.
-- * A net is the set of wires joined through a splice (SPL-*), a ground bank or ground point, or a battery stud; every
--   other wire is its own net. One signal per net.
-- * A wire that becomes one segment keeps its whole-wire planned length; a split wire's segments carry NULL with the
--   reason, because the estimate was never split.
-- * wire_part_id keys the catalog where the exact M22759 part number exists (spec-gauge-colour code, MIL-STD-681 digits).
-- * Testimony: each row keeps its legacy source, event time and trust; method names this reshape. Per-field citations
--   are not carried yet (v2). harness_segments gains vehicle_custom_circuit_id, the legacy row it came from.
BEGIN;
SET LOCAL statement_timeout='60s'; SET LOCAL lock_timeout='2s';

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM public.harness_segments WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e') THEN
    RAISE EXCEPTION 'K5 harness segments already exist';
  END IF;
  IF EXISTS (SELECT 1 FROM public.vehicle_custom_circuits c JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id
             WHERE o.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT coalesce(c.is_superseded, false)
               AND c.design_status = 'decided' AND coalesce(c.build_state, 'uncut') <> 'uncut') THEN
    RAISE EXCEPTION 'a decided K5 wire is no longer uncut; review the build-state mapping first';
  END IF;
END $guard$;

-- A wire whose ends were never recorded still exists: both ends unknown. The first harness migration's check
-- (from_termination_id IS DISTINCT FROM to_termination_id) treats two unknown ends as the same end; compare only known ends.
DO $c$
DECLARE r record;
BEGIN
  FOR r IN SELECT conname FROM pg_constraint
           WHERE conrelid = 'public.harness_segments'::regclass AND contype = 'c'
             AND pg_get_constraintdef(oid) LIKE '%IS DISTINCT FROM%' LOOP
    EXECUTE format('ALTER TABLE public.harness_segments DROP CONSTRAINT %I', r.conname);
  END LOOP;
END $c$;
ALTER TABLE public.harness_segments ADD CONSTRAINT harness_segments_distinct_ends
  CHECK (from_termination_id IS NULL OR to_termination_id IS NULL OR from_termination_id <> to_termination_id);

ALTER TABLE public.harness_segments ADD COLUMN vehicle_custom_circuit_id uuid REFERENCES public.vehicle_custom_circuits(id);
COMMENT ON COLUMN public.harness_segments.vehicle_custom_circuit_id IS 'The legacy wire row this segment was reshaped from (parity and supersession trail).';
CREATE INDEX harness_segments_legacy_wire ON public.harness_segments (vehicle_custom_circuit_id);

-- The decided wires.
CREATE TEMP TABLE k5_w ON COMMIT DROP AS
SELECT c.id, c.circuit_code, c.circuit_name, c.wire_gauge_awg, c.wire_type, c.wire_color, c.planned_length_ft,
       c.from_endpoint_id, c.to_endpoint_id, c.fuse_rating_amps,
       coalesce(c.source, 'vehicle_custom_circuits') AS source, coalesce(c.observed_at, c.created_at) AS observed_at,
       coalesce(c.trust, 'T3') AS trust
FROM public.vehicle_custom_circuits c
JOIN public.vehicle_wiring_overlays o ON o.id = c.overlay_id
WHERE o.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e'
  AND NOT coalesce(c.is_superseded, false) AND c.design_status = 'decided';

-- The K5's live plugs, with the two roles that matter here.
CREATE TEMP TABLE k5_e ON COMMIT DROP AS
SELECT e.id, e.code, e.name, e.endpoint_type, e.location_zone,
       (e.code LIKE 'SPL-%' OR e.endpoint_type IN ('splice', 'ground') OR e.code LIKE '%-STUD') AS joins_net,
       (e.code ILIKE '%GROMMET%' OR e.code IN ('AMP-PASS', 'Firewall')) AS is_grommet
FROM public.harness_endpoints e
JOIN public.harness_designs d ON d.id = e.design_id
WHERE d.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT coalesce(e.is_superseded, false);

-- Wire ends, with their role on the wire.
CREATE TEMP TABLE k5_t ON COMMIT DROP AS
SELECT t.id AS term_id, w.id AS wire_id, e.code, e.location_zone AS zone, coalesce(e.is_grommet, false) AS is_grommet,
       CASE WHEN t.endpoint_id = w.from_endpoint_id THEN 'F' WHEN t.endpoint_id = w.to_endpoint_id THEN 'T' ELSE 'M' END AS role
FROM public.wire_termination_specs t
JOIN k5_w w ON w.id = t.circuit_id
LEFT JOIN k5_e e ON e.id = t.endpoint_id
WHERE NOT coalesce(t.is_superseded, false);

-- Which side of the firewall each wire starts on.
CREATE TEMP TABLE k5_side ON COMMIT DROP AS
SELECT w.id AS wire_id,
       CASE WHEN fe.location_zone IN ('engine', 'chassis') THEN true
            WHEN fe.location_zone IN ('cabin', 'rear') THEN false
            WHEN te.location_zone IN ('engine', 'chassis') THEN false
            ELSE false END AS from_engine
FROM k5_w w LEFT JOIN k5_e fe ON fe.id = w.from_endpoint_id LEFT JOIN k5_e te ON te.id = w.to_endpoint_id;

-- Nets: connected components of wires joined through splices, ground points and studs.
CREATE TEMP TABLE k5_wm ON COMMIT DROP AS
SELECT DISTINCT w.id AS wire_id, e.id AS ep_id, e.code, e.endpoint_type
FROM k5_w w JOIN k5_e e ON e.joins_net AND e.id IN (w.from_endpoint_id, w.to_endpoint_id)
UNION
SELECT DISTINCT t.wire_id, e.id, e.code, e.endpoint_type
FROM k5_t t JOIN public.wire_termination_specs s ON s.id = t.term_id JOIN k5_e e ON e.joins_net AND e.id = s.endpoint_id;

CREATE TEMP TABLE k5_comp ON COMMIT DROP AS
WITH RECURSIVE pairs AS (
  SELECT DISTINCT a.wire_id AS x, b.wire_id AS y FROM k5_wm a JOIN k5_wm b ON a.ep_id = b.ep_id),
reach(root, wire) AS (
  SELECT id, id FROM k5_w
  UNION
  SELECT r.root, p.y FROM reach r JOIN pairs p ON p.x = r.wire)
SELECT wire AS wire_id, min(root::text)::uuid AS comp FROM reach GROUP BY wire;

CREATE TEMP TABLE k5_net ON COMMIT DROP AS
SELECT k.comp,
       coalesce(min(m.code), min(w.circuit_code)) AS net_code,
       count(DISTINCT k.wire_id) AS wires,
       bool_or(m.endpoint_type = 'ground') AS is_ground,
       bool_or(m.code LIKE '%-STUD') AS is_stud,
       min(w.observed_at) AS observed_at,
       CASE WHEN count(DISTINCT k.wire_id) = 1 THEN min(w.circuit_name) ELSE coalesce(min(m.code), min(w.circuit_name)) END AS name,
       CASE WHEN count(DISTINCT k.wire_id) = 1 THEN min(w.fuse_rating_amps) END AS fuse_a,
       CASE WHEN count(DISTINCT k.wire_id) = 1 THEN min(w.source) ELSE 'vehicle_custom_circuits (' || count(DISTINCT k.wire_id) || ' wires)' END AS source
FROM k5_comp k JOIN k5_w w ON w.id = k.wire_id LEFT JOIN k5_wm m ON m.wire_id = k.wire_id
GROUP BY k.comp;

CREATE TEMP TABLE k5_net_ids ON COMMIT DROP AS
SELECT comp, gen_random_uuid() AS net_id, gen_random_uuid() AS signal_id FROM k5_net;

INSERT INTO public.harness_signals (id, vehicle_id, signal_key, name, signal_type, source, method, observed_at, trust)
SELECT i.signal_id, 'e08bf694-970f-4cbe-8a74-8715158a0f2e',
       n.net_code, n.name,
       CASE WHEN n.is_ground THEN 'ground' WHEN n.is_stud THEN 'power' END,
       n.source, 'reshaped v1 from vehicle_custom_circuits (case 13.12.2); one signal per net', n.observed_at, 'T3'
FROM k5_net n JOIN k5_net_ids i ON i.comp = n.comp;

INSERT INTO public.harness_nets (id, vehicle_id, net_code, signal_id, function, protection_setting_a, source, method, observed_at, trust)
SELECT i.net_id, 'e08bf694-970f-4cbe-8a74-8715158a0f2e', n.net_code, i.signal_id, n.name, n.fuse_a,
       n.source, 'reshaped v1 from vehicle_custom_circuits (case 13.12.2): one net per wire, merged through splices, ground points and studs',
       n.observed_at, 'T3'
FROM k5_net n JOIN k5_net_ids i ON i.comp = n.comp;

-- Segments: order each wire's ends, bracket with NULL where the from- or to-end is missing, pair consecutive ends,
-- and skip the step between the 61-pin's two halves.
CREATE TEMP TABLE k5_seq ON COMMIT DROP AS
WITH ends AS (
  SELECT t.wire_id, t.term_id, t.role, t.code,
         CASE WHEN t.role = 'F' THEN 0 WHEN t.role = 'T' THEN 100
              WHEN t.code = 'FIREWALL-CABIN' THEN CASE WHEN s.from_engine THEN 60 ELSE 40 END
              WHEN t.code = 'FIREWALL-ENGINE' THEN CASE WHEN s.from_engine THEN 40 ELSE 60 END
              ELSE 50 END AS ord
  FROM k5_t t JOIN k5_side s ON s.wire_id = t.wire_id
  WHERE NOT t.is_grommet
),
bounds AS (
  SELECT w.id AS wire_id, NULL::uuid AS term_id, 'F'::text AS role, NULL::text AS code, -1 AS ord
  FROM k5_w w WHERE NOT EXISTS (SELECT 1 FROM ends e WHERE e.wire_id = w.id AND e.role = 'F')
  UNION ALL
  SELECT w.id, NULL::uuid, 'T', NULL, 101
  FROM k5_w w WHERE NOT EXISTS (SELECT 1 FROM ends e WHERE e.wire_id = w.id AND e.role = 'T')
),
all_ends AS (SELECT * FROM ends UNION ALL SELECT * FROM bounds)
SELECT wire_id, term_id, code, ord,
       lead(term_id) OVER (PARTITION BY wire_id ORDER BY ord, code NULLS FIRST, term_id) AS next_term,
       lead(code) OVER (PARTITION BY wire_id ORDER BY ord, code NULLS FIRST, term_id) AS next_code,
       lead(ord) OVER (PARTITION BY wire_id ORDER BY ord, code NULLS FIRST, term_id) AS next_ord
FROM all_ends;

CREATE TEMP TABLE k5_seg ON COMMIT DROP AS
SELECT q.wire_id, q.term_id AS from_term, q.next_term AS to_term
FROM k5_seq q
WHERE q.next_ord IS NOT NULL
  AND NOT (coalesce(q.code, '') IN ('FIREWALL-CABIN', 'FIREWALL-ENGINE')
           AND coalesce(q.next_code, '') IN ('FIREWALL-CABIN', 'FIREWALL-ENGINE')
           AND q.code <> q.next_code);

INSERT INTO public.harness_segments (vehicle_id, net_id, from_termination_id, to_termination_id, wire_part_id, gauge_awg,
  colour, planned_length_ft, planned_length_method, build_state, source, method, observed_at, trust, vehicle_custom_circuit_id)
SELECT 'e08bf694-970f-4cbe-8a74-8715158a0f2e', i.net_id, g.from_term, g.to_term, p.id, w.wire_gauge_awg, w.wire_color,
       CASE WHEN n.segs = 1 AND w.planned_length_ft > 0 THEN w.planned_length_ft END,
       CASE WHEN n.segs = 1 THEN 'whole-wire zone estimate from the legacy row (cut list v4.2 basis)'
            ELSE 'unknown: the whole-wire estimate (' || coalesce(w.planned_length_ft::text, 'none') || ' ft) was never split at its junctions' END,
       'uncut', w.source,
       'reshaped v1 from vehicle_custom_circuits (case 13.12.2): split at terminating pass-throughs, the 61-pin halves as a mate, grommets not splitting; field citations not yet carried',
       w.observed_at, w.trust, w.id
FROM k5_seg g
JOIN k5_w w ON w.id = g.wire_id
JOIN k5_comp k ON k.wire_id = w.id
JOIN k5_net_ids i ON i.comp = k.comp
JOIN (SELECT wire_id, count(*) AS segs FROM k5_seg GROUP BY wire_id) n ON n.wire_id = g.wire_id
LEFT JOIN LATERAL (
  SELECT cp.id FROM public.catalog_parts cp
  WHERE w.wire_type ~ '^M22759/(16|32)$'
    AND cp.part_number = w.wire_type || '-' || w.wire_gauge_awg || '-' || (
      SELECT string_agg(CASE x WHEN 'black' THEN '0' WHEN 'brown' THEN '1' WHEN 'red' THEN '2' WHEN 'orange' THEN '3'
                                 WHEN 'yellow' THEN '4' WHEN 'green' THEN '5' WHEN 'blue' THEN '6' WHEN 'violet' THEN '7'
                                 WHEN 'gray' THEN '8' WHEN 'white' THEN '9' END, '' ORDER BY ord)
      FROM unnest(string_to_array(lower(w.wire_color), '/')) WITH ORDINALITY AS u(x, ord))
  ORDER BY cp.id LIMIT 1) p ON true;

-- The 61-pin's halves mate.
UPDATE public.harness_endpoints h SET mates_with_endpoint_id = o.id
FROM k5_e a JOIN k5_e o ON (a.code, o.code) IN (('FIREWALL-CABIN', 'FIREWALL-ENGINE'), ('FIREWALL-ENGINE', 'FIREWALL-CABIN'))
WHERE h.id = a.id AND h.mates_with_endpoint_id IS DISTINCT FROM o.id;

-- Parity: every decided wire has a segment; every non-grommet wire end is used; every net has a segment.
DO $check$
DECLARE missing_wires int; unused_ends int; empty_nets int; n_seg int; n_net int;
BEGIN
  SELECT count(*) INTO missing_wires FROM k5_w w
   WHERE NOT EXISTS (SELECT 1 FROM public.harness_segments s WHERE s.vehicle_custom_circuit_id = w.id);
  SELECT count(*) INTO unused_ends FROM k5_t t
   WHERE NOT t.is_grommet AND NOT EXISTS (SELECT 1 FROM public.harness_segments s
     WHERE s.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND t.term_id IN (s.from_termination_id, s.to_termination_id));
  SELECT count(*) INTO empty_nets FROM public.harness_nets n
   WHERE n.vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e' AND NOT EXISTS (SELECT 1 FROM public.harness_segments s WHERE s.net_id = n.id);
  SELECT count(*) INTO n_seg FROM public.harness_segments WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
  SELECT count(*) INTO n_net FROM public.harness_nets WHERE vehicle_id = 'e08bf694-970f-4cbe-8a74-8715158a0f2e';
  IF missing_wires > 0 OR unused_ends > 0 OR empty_nets > 0 THEN
    RAISE EXCEPTION 'parity failed: % wires without a segment, % wire ends unused, % empty nets', missing_wires, unused_ends, empty_nets;
  END IF;
  RAISE NOTICE 'K5 reshape v1: % wires -> % nets, % segments', (SELECT count(*) FROM k5_w), n_net, n_seg;
END $check$;

COMMIT;
