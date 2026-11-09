-- Vehicle support producer: a profile is derived from its evidence and dissolves when none of it is its own.
--
-- Owner note: photo / document / library / merge code is Codex's lane. This file is a draft for Codex review.
--
-- Model
--   * Support components per vehicle: VIN anchor, title document, own listing (vehicles.listing_url, bat_listings,
--     external_listings, or a vehicle_events URL/lot), and eligible photos (not superseded, not flagged duplicate,
--     not held/rejected by the vision gate).
--   * A component is SHADOWED when the same evidence (same file_hash or duplicate_of photo, same normalised VIN,
--     same listing URL - or platform+lot when no URL) also backs a live vehicle that OUTRANKS this one AND is the
--     same car by identity (identity guard below).
--   * Outranks = (has VIN, has title, has listing, photo count) compared lexicographically; ties go to the older
--     profile, then the lower id. VIN/title always win.
--   * dissolve  : 100% of support is shadowed (independent support = 0), there is a stronger sharer to resolve to,
--                 and the profile is older than 14 days. Thin single-listing vehicles never dissolve for being thin:
--                 their own URL/lot is an independent anchor unless a stronger same-car profile holds that exact URL.
--   * restore   : a currently dissolved profile whose evidence is independent again.
--   * unsupported_empty : no evidence at all; flagged only, never dissolved by this producer.
--   * shadowed_in_grace : fully shadowed but younger than 14 days; flagged only.
--
-- Identity guard: never shadow across a different year, make, VIN (both >= 6 chars and different), or model family
--   (no shared significant model token). Pre-1981 chassis numbers of 6+ characters count as a VIN.
--
-- Safety
--   * Dry run by default. Every run is recorded and signed (sha256 of the canonical decision payload).
--   * Per-run change cap (default 50): if dissolve+restore decisions exceed it the run halts, writes nothing to
--     vehicles, and is flagged 'halted_over_cap'.
--   * Never deletes. Dissolving sets vehicles.derived_status = 'dissolved' with the run id; vehicle_support_revert_run
--     restores the prior value for rows that run still owns.
--   * Incremental: statement-level triggers enqueue only vehicles whose evidence keys changed into
--     vehicle_support_dirty. vehicle_support_run drains a bounded slice of that queue plus one hop of neighbours.
--     There is no full-table recompute path on writes.

BEGIN;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS derived_status text,
  ADD COLUMN IF NOT EXISTS derived_status_run_id uuid,
  ADD COLUMN IF NOT EXISTS derived_status_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'vehicles_derived_status_check') THEN
    ALTER TABLE public.vehicles ADD CONSTRAINT vehicles_derived_status_check
      CHECK (derived_status IS NULL OR derived_status = 'dissolved') NOT VALID;
  END IF;
END $$;

COMMENT ON COLUMN public.vehicles.derived_status IS
  'Derived by vehicle_support_run. NULL = active; ''dissolved'' = no independent supporting evidence. Never a delete; revert with vehicle_support_revert_run.';

CREATE INDEX IF NOT EXISTS idx_vehicles_derived_status ON public.vehicles (derived_status) WHERE derived_status IS NOT NULL;

-- Platform + lot lookup without a vehicle_id prefix (listing match falls back to it when an event has no URL).
CREATE INDEX IF NOT EXISTS idx_vehicle_events_platform_lot
  ON public.vehicle_events (source_platform, source_listing_id) WHERE source_listing_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.vehicle_support_runs (
  run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor text,
  dry_run boolean NOT NULL,
  cap integer NOT NULL,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL CHECK (status IN ('dry_run', 'halted_over_cap', 'applied', 'reverted')),
  n_evaluated integer NOT NULL DEFAULT 0,
  n_dissolve integer NOT NULL DEFAULT 0,
  n_restore integer NOT NULL DEFAULT 0,
  signed_payload jsonb NOT NULL,
  signature text NOT NULL,
  reverted_at timestamptz,
  reverted_by text
);

CREATE TABLE IF NOT EXISTS public.vehicle_support_scores (
  run_id uuid NOT NULL REFERENCES public.vehicle_support_runs (run_id),
  vehicle_id uuid NOT NULL,
  has_vin boolean, has_title boolean, has_listing boolean,
  n_img integer, n_img_indep integer, n_dup_copies integer,
  vin_indep boolean, listing_indep boolean,
  support_total integer, support_independent integer,
  decision text NOT NULL,
  resolves_to uuid,
  prior_derived_status text,
  applied boolean NOT NULL DEFAULT false,
  PRIMARY KEY (run_id, vehicle_id)
);
CREATE INDEX IF NOT EXISTS idx_vehicle_support_scores_vehicle ON public.vehicle_support_scores (vehicle_id);

CREATE TABLE IF NOT EXISTS public.vehicle_support_dirty (
  vehicle_id uuid PRIMARY KEY,
  reason text,
  enqueued_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.vehicle_support_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_support_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_support_dirty ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.vehicle_support_runs, public.vehicle_support_scores, public.vehicle_support_dirty FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON public.vehicle_support_runs, public.vehicle_support_scores, public.vehicle_support_dirty FROM anon, authenticated';
  END IF;
END $$;

-- Significant model tokens (lower case, >= 3 chars, body-style words dropped).
CREATE OR REPLACE FUNCTION public.vehicle_model_tokens(p_model text)
RETURNS text[] LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT COALESCE(array_agg(DISTINCT t), '{}'::text[])
    FROM regexp_split_to_table(lower(COALESCE(p_model, '')), '[^a-z0-9]+') t
   WHERE length(t) >= 3
     AND t NOT IN ('custom','door','convertible','coupe','sedan','hardtop','roadster','pickup','truck','wagon','the','and','with')
$$;

-- Same car by identity? Unknown fields never block; known, different fields always block.
CREATE OR REPLACE FUNCTION public.vehicle_identity_compatible(
  a_year integer, a_make text, a_vin text, a_model text,
  b_year integer, b_make text, b_vin text, b_model text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT (a_year IS NULL OR b_year IS NULL OR a_year = b_year)
     AND (nullif(lower(btrim(a_make)), '') IS NULL OR nullif(lower(btrim(b_make)), '') IS NULL
          OR lower(btrim(a_make)) = lower(btrim(b_make)))
     AND (length(COALESCE(btrim(a_vin), '')) < 6 OR length(COALESCE(btrim(b_vin), '')) < 6
          OR upper(btrim(a_vin)) = upper(btrim(b_vin)))
     AND (cardinality(public.vehicle_model_tokens(a_model)) = 0 OR cardinality(public.vehicle_model_tokens(b_model)) = 0
          OR public.vehicle_model_tokens(a_model) && public.vehicle_model_tokens(b_model))
$$;

-- Read-only assessment of a candidate set. Index paths: vehicle_images by vehicle_id and file_hash/pkey,
-- vehicles by upper(btrim(vin)), vehicle_events by vehicle_id, source_url, and (source_platform, source_listing_id).
CREATE OR REPLACE FUNCTION public.vehicle_support_assess(p_ids uuid[])
RETURNS TABLE (
  vehicle_id uuid, is_live boolean, has_vin boolean, has_title boolean, has_listing boolean,
  n_img integer, n_img_indep integer, n_dup_copies integer, vin_indep boolean, listing_indep boolean,
  support_total integer, support_independent integer, resolves_to uuid, decision text, derived_status text)
LANGUAGE sql STABLE SET search_path = public AS $$
WITH cand AS (SELECT DISTINCT unnest(p_ids) AS vid),
img AS (SELECT i.vehicle_id AS vid, i.id, i.file_hash, COALESCE(i.is_duplicate, false) AS dup, i.duplicate_of
          FROM vehicle_images i JOIN cand c ON c.vid = i.vehicle_id
         WHERE COALESCE(i.is_superseded, false) = false
           AND COALESCE(i.vision_gate_status::text, '') NOT IN ('review_needed', 'rejected_misattributed', 'rejected_personal')),
img_other AS (
  SELECT im.vid, im.id, o.vehicle_id AS other
    FROM img im JOIN vehicle_images o ON o.file_hash = im.file_hash AND o.vehicle_id <> im.vid
     AND COALESCE(o.is_superseded, false) = false
     AND COALESCE(o.vision_gate_status::text, '') NOT IN ('review_needed', 'rejected_misattributed', 'rejected_personal')
   WHERE im.file_hash IS NOT NULL
  UNION
  SELECT im.vid, im.id, o.vehicle_id FROM img im JOIN vehicle_images o ON o.id = im.duplicate_of AND o.vehicle_id <> im.vid
   WHERE im.dup),
vin_other AS (
  SELECT c.vid, o.id AS other FROM cand c JOIN vehicles a ON a.id = c.vid
    JOIN vehicles o ON upper(btrim(o.vin)) = upper(btrim(a.vin)) AND o.id <> a.id
   WHERE length(btrim(a.vin)) >= 6),
lst AS (
  SELECT e.vehicle_id AS vid, e.source_platform AS p, e.source_listing_id AS lid, e.source_url AS url
    FROM vehicle_events e JOIN cand c ON c.vid = e.vehicle_id
   WHERE e.source_url IS NOT NULL OR e.source_listing_id IS NOT NULL),
lst_other AS (  -- URL first; platform+lot only when the event has no URL
  SELECT l.vid, l.p, l.lid, l.url, o.vehicle_id AS other FROM lst l
    JOIN vehicle_events o ON o.vehicle_id <> l.vid AND l.url IS NOT NULL AND o.source_url = l.url
  UNION
  SELECT l.vid, l.p, l.lid, l.url, o.vehicle_id FROM lst l
    JOIN vehicle_events o ON o.vehicle_id <> l.vid AND l.url IS NULL AND o.source_url IS NULL
     AND o.source_platform = l.p AND o.source_listing_id = l.lid),
nb AS (SELECT other AS vid FROM img_other UNION SELECT other FROM vin_other UNION SELECT other FROM lst_other),
allv AS (SELECT vid FROM cand UNION SELECT vid FROM nb WHERE vid IS NOT NULL),
strength AS (
  SELECT a.vid,
         (v.id IS NOT NULL AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
            AND v.status IS DISTINCT FROM 'merged' AND v.status IS DISTINCT FROM 'deleted') AS is_live,
         v.derived_status, v.created_at, v.year AS yr, v.make AS mk, v.vin AS vn, v.model AS mdl,
         COALESCE(length(btrim(v.vin)) >= 6, false) AS has_vin,
         EXISTS (SELECT 1 FROM vehicle_documents d WHERE d.vehicle_id = a.vid AND d.document_type ILIKE '%title%') AS has_title,
         (nullif(v.listing_url, '') IS NOT NULL
          OR EXISTS (SELECT 1 FROM bat_listings b WHERE b.vehicle_id = a.vid)
          OR EXISTS (SELECT 1 FROM external_listings x WHERE x.vehicle_id = a.vid)) AS own_listing,
         EXISTS (SELECT 1 FROM vehicle_events e WHERE e.vehicle_id = a.vid
                   AND (e.source_listing_id IS NOT NULL OR e.source_url IS NOT NULL)) AS event_listing,
         (SELECT count(*) FROM vehicle_images i WHERE i.vehicle_id = a.vid AND COALESCE(i.is_superseded, false) = false
             AND COALESCE(i.is_duplicate, false) = false
             AND COALESCE(i.vision_gate_status::text, '') NOT IN ('review_needed', 'rejected_misattributed', 'rejected_personal'))::int AS n_img
    FROM allv a LEFT JOIN vehicles v ON v.id = a.vid),
-- o outranks v (and is the same car): VIN, title, listing, photos, then older, then lower id.
beats AS (
  SELECT v.vid, o.vid AS other FROM strength v JOIN strength o ON o.vid <> v.vid
     AND o.is_live AND o.derived_status IS NULL
     AND public.vehicle_identity_compatible(v.yr, v.mk, v.vn, v.mdl, o.yr, o.mk, o.vn, o.mdl)
   WHERE (o.has_vin::int, o.has_title::int, (o.own_listing OR o.event_listing)::int, o.n_img)
         > (v.has_vin::int, v.has_title::int, (v.own_listing OR v.event_listing)::int, v.n_img)
      OR ((o.has_vin::int, o.has_title::int, (o.own_listing OR o.event_listing)::int, o.n_img)
          = (v.has_vin::int, v.has_title::int, (v.own_listing OR v.event_listing)::int, v.n_img)
          AND (o.created_at, o.vid) < (v.created_at, v.vid))),
img_sh AS (
  SELECT im.vid, im.id, im.dup, bool_or(b.other IS NOT NULL) AS shadowed, bool_or(x.other IS NOT NULL) AS shared
    FROM img im LEFT JOIN img_other x ON x.id = im.id LEFT JOIN beats b ON b.vid = x.vid AND b.other = x.other
   GROUP BY im.vid, im.id, im.dup),
img_cnt AS (
  SELECT vid, count(*) FILTER (WHERE NOT dup AND NOT shadowed)::int AS n_img_indep,
         count(*) FILTER (WHERE dup AND shared)::int AS n_dup_copies
    FROM img_sh GROUP BY vid),
vin_sh AS (SELECT DISTINCT x.vid FROM vin_other x JOIN beats b ON b.vid = x.vid AND b.other = x.other),
lst_sh AS (
  SELECT l.vid, bool_or(b.other IS NOT NULL) AS shadowed
    FROM lst l LEFT JOIN lst_other x ON x.vid = l.vid AND x.p IS NOT DISTINCT FROM l.p
         AND x.lid IS NOT DISTINCT FROM l.lid AND x.url IS NOT DISTINCT FROM l.url
    LEFT JOIN beats b ON b.vid = x.vid AND b.other = x.other
   GROUP BY l.vid, l.p, l.lid, l.url),
lst_cnt AS (SELECT vid, count(*) FILTER (WHERE NOT shadowed)::int AS n_lst_indep FROM lst_sh GROUP BY vid),
own_url_sh AS (  -- vehicles.listing_url shadowed only by a stronger same-car profile with the same URL
  SELECT DISTINCT s.vid FROM strength s JOIN vehicles v ON v.id = s.vid
    JOIN vehicles o ON o.listing_url = v.listing_url AND o.id <> v.id
    JOIN beats b ON b.vid = s.vid AND b.other = o.id
   WHERE nullif(v.listing_url, '') IS NOT NULL),
own_other AS (  -- own listing rows other than vehicles.listing_url are never shared keys; they are independent
  SELECT s.vid FROM strength s WHERE EXISTS (SELECT 1 FROM bat_listings b WHERE b.vehicle_id = s.vid)
     OR EXISTS (SELECT 1 FROM external_listings x WHERE x.vehicle_id = s.vid)),
shadow_by AS (
  SELECT DISTINCT ON (p.vid) p.vid, p.other
    FROM (SELECT vid, other FROM img_other UNION SELECT vid, other FROM vin_other UNION SELECT vid, other FROM lst_other) p
    JOIN beats b ON b.vid = p.vid AND b.other = p.other JOIN strength o ON o.vid = p.other
   ORDER BY p.vid, o.has_vin DESC, o.has_title DESC, (o.own_listing OR o.event_listing) DESC, o.n_img DESC, o.created_at, o.vid),
a AS (
  SELECT s.vid, s.is_live, s.derived_status, s.created_at, s.has_vin, s.has_title,
         (s.own_listing OR s.event_listing) AS has_listing, s.n_img,
         COALESCE(ic.n_dup_copies, 0) AS n_dup_copies,
         (s.has_vin AND s.vid NOT IN (SELECT vid FROM vin_sh)) AS vin_indep,
         (s.vid IN (SELECT vid FROM own_other)
          OR (nullif((SELECT listing_url FROM vehicles WHERE id = s.vid), '') IS NOT NULL AND s.vid NOT IN (SELECT vid FROM own_url_sh))
          OR COALESCE(lc.n_lst_indep, 0) > 0) AS listing_indep,
         COALESCE(ic.n_img_indep, 0) AS n_img_indep,
         sb.other AS resolves_to
    FROM strength s
    LEFT JOIN img_cnt ic ON ic.vid = s.vid LEFT JOIN lst_cnt lc ON lc.vid = s.vid LEFT JOIN shadow_by sb ON sb.vid = s.vid
   WHERE s.vid IN (SELECT vid FROM cand))
SELECT a.vid, a.is_live, a.has_vin, a.has_title, a.has_listing, a.n_img, a.n_img_indep, a.n_dup_copies,
       a.vin_indep, a.listing_indep,
       (a.has_vin::int + a.has_title::int + a.has_listing::int + a.n_img + a.n_dup_copies) AS support_total,
       (a.vin_indep::int + a.has_title::int + a.listing_indep::int + a.n_img_indep) AS support_independent,
       a.resolves_to,
       CASE WHEN NOT COALESCE(a.is_live, false) THEN 'not_live'
            WHEN (a.has_vin::int + a.has_title::int + a.has_listing::int + a.n_img + a.n_dup_copies) = 0 THEN 'unsupported_empty'
            WHEN (a.vin_indep::int + a.has_title::int + a.listing_indep::int + a.n_img_indep) = 0 AND a.resolves_to IS NOT NULL
                 AND a.created_at < now() - interval '14 days'
              THEN CASE WHEN a.derived_status = 'dissolved' THEN 'dissolved_unchanged' ELSE 'dissolve' END
            WHEN (a.vin_indep::int + a.has_title::int + a.listing_indep::int + a.n_img_indep) = 0 THEN 'shadowed_in_grace'
            WHEN a.derived_status = 'dissolved' THEN 'restore'
            ELSE 'supported' END,
       a.derived_status
  FROM a
$$;

-- One hop of neighbours: vehicles that share a photo file, VIN, or listing key with any input vehicle.
CREATE OR REPLACE FUNCTION public.vehicle_support_neighbours(p_ids uuid[])
RETURNS SETOF uuid LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT DISTINCT o.vehicle_id FROM vehicle_images i JOIN vehicle_images o ON o.file_hash = i.file_hash
   WHERE i.vehicle_id = ANY (p_ids) AND i.file_hash IS NOT NULL AND o.vehicle_id IS NOT NULL AND o.vehicle_id <> ALL (p_ids)
  UNION
  SELECT o.id FROM vehicles a JOIN vehicles o ON upper(btrim(o.vin)) = upper(btrim(a.vin)) AND o.id <> a.id
   WHERE a.id = ANY (p_ids) AND length(btrim(a.vin)) >= 6
  UNION
  SELECT o.vehicle_id FROM vehicle_events e JOIN vehicle_events o ON o.source_url = e.source_url AND o.vehicle_id <> e.vehicle_id
   WHERE e.vehicle_id = ANY (p_ids) AND e.source_url IS NOT NULL
  UNION
  SELECT o.vehicle_id FROM vehicle_events e JOIN vehicle_events o
      ON o.source_platform = e.source_platform AND o.source_listing_id = e.source_listing_id
     AND o.source_url IS NULL AND o.vehicle_id <> e.vehicle_id
   WHERE e.vehicle_id = ANY (p_ids) AND e.source_url IS NULL AND e.source_listing_id IS NOT NULL
$$;

-- The producer. Dry run by default; p_ids = NULL drains up to p_limit vehicles from vehicle_support_dirty.
CREATE OR REPLACE FUNCTION public.vehicle_support_run(
  p_ids uuid[] DEFAULT NULL, p_dry_run boolean DEFAULT true, p_cap integer DEFAULT 50,
  p_limit integer DEFAULT 200, p_actor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_run uuid := gen_random_uuid();
  v_seed uuid[];
  v_ids uuid[];
  v_status text;
  v_payload jsonb;
  v_sig text;
  v_n int; v_dis int; v_res int;
BEGIN
  IF p_cap IS NULL OR p_cap < 0 THEN RAISE EXCEPTION 'cap must be >= 0'; END IF;
  IF NOT pg_try_advisory_xact_lock(hashtext('vehicle_support_run')) THEN
    RAISE EXCEPTION 'another vehicle_support_run is in progress';
  END IF;

  IF p_ids IS NULL THEN
    SELECT array_agg(vehicle_id) INTO v_seed FROM (
      SELECT vehicle_id FROM vehicle_support_dirty ORDER BY enqueued_at LIMIT GREATEST(p_limit, 0)
      FOR UPDATE SKIP LOCKED) d;
  ELSE
    v_seed := p_ids;
  END IF;
  v_seed := COALESCE(v_seed, '{}'::uuid[]);
  SELECT array_agg(DISTINCT x) INTO v_ids FROM (
    SELECT unnest(v_seed) x UNION SELECT public.vehicle_support_neighbours(v_seed)) s WHERE x IS NOT NULL;
  v_ids := COALESCE(v_ids, '{}'::uuid[]);

  CREATE TEMP TABLE IF NOT EXISTS pg_temp.vs_eval (LIKE public.vehicle_support_scores) ON COMMIT DROP;
  TRUNCATE pg_temp.vs_eval;
  INSERT INTO pg_temp.vs_eval (run_id, vehicle_id, has_vin, has_title, has_listing, n_img, n_img_indep, n_dup_copies,
                               vin_indep, listing_indep, support_total, support_independent, decision, resolves_to,
                               prior_derived_status, applied)
  SELECT v_run, s.vehicle_id, s.has_vin, s.has_title, s.has_listing, s.n_img, s.n_img_indep, s.n_dup_copies,
         s.vin_indep, s.listing_indep, s.support_total, s.support_independent, s.decision, s.resolves_to,
         s.derived_status, false
    FROM public.vehicle_support_assess(v_ids) s;

  SELECT count(*), count(*) FILTER (WHERE decision = 'dissolve'), count(*) FILTER (WHERE decision = 'restore')
    INTO v_n, v_dis, v_res FROM pg_temp.vs_eval;

  v_status := CASE WHEN v_dis + v_res > p_cap THEN 'halted_over_cap'
                   WHEN p_dry_run THEN 'dry_run' ELSE 'applied' END;

  v_payload := jsonb_build_object(
    'run_id', v_run, 'dry_run', p_dry_run, 'cap', p_cap, 'status', v_status, 'actor', p_actor,
    'seed', to_jsonb(v_seed),
    'changes', COALESCE((SELECT jsonb_agg(jsonb_build_object('v', vehicle_id, 'd', decision, 'to', resolves_to,
                                                            'prior', prior_derived_status) ORDER BY vehicle_id)
                           FROM pg_temp.vs_eval WHERE decision IN ('dissolve', 'restore')), '[]'::jsonb));
  v_sig := encode(sha256(convert_to(v_payload::text, 'UTF8')), 'hex');

  INSERT INTO vehicle_support_runs (run_id, actor, dry_run, cap, params, status, n_evaluated, n_dissolve, n_restore,
                                    signed_payload, signature)
  VALUES (v_run, p_actor, p_dry_run, p_cap, jsonb_build_object('limit', p_limit, 'seed_n', cardinality(v_seed)),
          v_status, v_n, v_dis, v_res, v_payload, v_sig);

  IF v_status = 'applied' THEN
    UPDATE vehicles v SET derived_status = 'dissolved', derived_status_run_id = v_run, derived_status_at = now()
      FROM pg_temp.vs_eval e WHERE e.vehicle_id = v.id AND e.decision = 'dissolve';
    UPDATE vehicles v SET derived_status = NULL, derived_status_run_id = v_run, derived_status_at = now()
      FROM pg_temp.vs_eval e WHERE e.vehicle_id = v.id AND e.decision = 'restore';
    UPDATE pg_temp.vs_eval SET applied = true WHERE decision IN ('dissolve', 'restore');
    DELETE FROM vehicle_support_dirty WHERE vehicle_id = ANY (v_seed);
  END IF;

  INSERT INTO vehicle_support_scores SELECT * FROM pg_temp.vs_eval;

  RETURN jsonb_build_object('run_id', v_run, 'status', v_status, 'evaluated', v_n, 'dissolve', v_dis,
                            'restore', v_res, 'cap', p_cap, 'signature', v_sig,
                            'flagged', v_status = 'halted_over_cap');
END $$;

CREATE OR REPLACE FUNCTION public.vehicle_support_revert_run(p_run uuid, p_actor text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_status text; v_n int;
BEGIN
  SELECT status INTO v_status FROM vehicle_support_runs WHERE run_id = p_run FOR UPDATE;
  IF v_status IS NULL THEN RAISE EXCEPTION 'unknown run %', p_run; END IF;
  IF v_status <> 'applied' THEN
    RETURN jsonb_build_object('run_id', p_run, 'status', v_status, 'reverted', 0);
  END IF;
  -- only rows this run still owns; a later run's decision is never overwritten
  UPDATE vehicles v SET derived_status = s.prior_derived_status, derived_status_run_id = NULL, derived_status_at = now()
    FROM vehicle_support_scores s
   WHERE s.run_id = p_run AND s.applied AND s.vehicle_id = v.id AND v.derived_status_run_id = p_run;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  UPDATE vehicle_support_runs SET status = 'reverted', reverted_at = now(), reverted_by = p_actor WHERE run_id = p_run;
  RETURN jsonb_build_object('run_id', p_run, 'status', 'reverted', 'reverted', v_n);
END $$;

-- Dirty tracking: statement-level, transition tables, evidence-key changes only.
CREATE OR REPLACE FUNCTION public.vehicle_support_mark_dirty()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF TG_TABLE_NAME = 'vehicle_images' THEN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO vehicle_support_dirty (vehicle_id, reason)
        SELECT DISTINCT vehicle_id, 'images_insert' FROM new_rows WHERE vehicle_id IS NOT NULL ON CONFLICT DO NOTHING;
    ELSIF TG_OP = 'DELETE' THEN
      INSERT INTO vehicle_support_dirty (vehicle_id, reason)
        SELECT DISTINCT vehicle_id, 'images_delete' FROM old_rows WHERE vehicle_id IS NOT NULL ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO vehicle_support_dirty (vehicle_id, reason)
        SELECT DISTINCT x.vid, 'images_update' FROM new_rows n JOIN old_rows o ON o.id = n.id
          CROSS JOIN LATERAL (VALUES (n.vehicle_id), (o.vehicle_id)) x(vid)
         WHERE x.vid IS NOT NULL
           AND (n.vehicle_id IS DISTINCT FROM o.vehicle_id OR n.file_hash IS DISTINCT FROM o.file_hash
                OR n.is_superseded IS DISTINCT FROM o.is_superseded OR n.is_duplicate IS DISTINCT FROM o.is_duplicate
                OR n.duplicate_of IS DISTINCT FROM o.duplicate_of
                OR n.vision_gate_status IS DISTINCT FROM o.vision_gate_status)
        ON CONFLICT DO NOTHING;
    END IF;
  ELSIF TG_TABLE_NAME = 'vehicle_events' THEN
    IF TG_OP = 'INSERT' THEN
      INSERT INTO vehicle_support_dirty (vehicle_id, reason)
        SELECT DISTINCT vehicle_id, 'events_insert' FROM new_rows WHERE vehicle_id IS NOT NULL ON CONFLICT DO NOTHING;
    ELSIF TG_OP = 'DELETE' THEN
      INSERT INTO vehicle_support_dirty (vehicle_id, reason)
        SELECT DISTINCT vehicle_id, 'events_delete' FROM old_rows WHERE vehicle_id IS NOT NULL ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO vehicle_support_dirty (vehicle_id, reason)
        SELECT DISTINCT x.vid, 'events_update' FROM new_rows n JOIN old_rows o ON o.id = n.id
          CROSS JOIN LATERAL (VALUES (n.vehicle_id), (o.vehicle_id)) x(vid)
         WHERE x.vid IS NOT NULL
           AND (n.vehicle_id IS DISTINCT FROM o.vehicle_id OR n.source_url IS DISTINCT FROM o.source_url
                OR n.source_listing_id IS DISTINCT FROM o.source_listing_id OR n.source_platform IS DISTINCT FROM o.source_platform)
        ON CONFLICT DO NOTHING;
    END IF;
  ELSIF TG_TABLE_NAME = 'vehicle_documents' THEN
    IF TG_OP = 'DELETE' THEN
      INSERT INTO vehicle_support_dirty (vehicle_id, reason)
        SELECT DISTINCT vehicle_id, 'documents' FROM old_rows WHERE vehicle_id IS NOT NULL ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO vehicle_support_dirty (vehicle_id, reason)
        SELECT DISTINCT vehicle_id, 'documents' FROM new_rows WHERE vehicle_id IS NOT NULL ON CONFLICT DO NOTHING;
    END IF;
  ELSIF TG_TABLE_NAME = 'vehicles' THEN
    -- identity / liveness changes only; derived_status writes by the producer itself never re-enqueue
    INSERT INTO vehicle_support_dirty (vehicle_id, reason)
      SELECT n.id, 'vehicle_identity' FROM new_rows n JOIN old_rows o ON o.id = n.id
       WHERE n.vin IS DISTINCT FROM o.vin OR n.year IS DISTINCT FROM o.year OR n.make IS DISTINCT FROM o.make
          OR n.model IS DISTINCT FROM o.model OR n.listing_url IS DISTINCT FROM o.listing_url
          OR n.deleted_at IS DISTINCT FROM o.deleted_at OR n.status IS DISTINCT FROM o.status
          OR n.merged_into_vehicle_id IS DISTINCT FROM o.merged_into_vehicle_id
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_vs_dirty_images_ins ON public.vehicle_images;
DROP TRIGGER IF EXISTS trg_vs_dirty_images_upd ON public.vehicle_images;
DROP TRIGGER IF EXISTS trg_vs_dirty_images_del ON public.vehicle_images;
CREATE TRIGGER trg_vs_dirty_images_ins AFTER INSERT ON public.vehicle_images REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_support_mark_dirty();
CREATE TRIGGER trg_vs_dirty_images_upd AFTER UPDATE ON public.vehicle_images REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_support_mark_dirty();
CREATE TRIGGER trg_vs_dirty_images_del AFTER DELETE ON public.vehicle_images REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_support_mark_dirty();

DROP TRIGGER IF EXISTS trg_vs_dirty_events_ins ON public.vehicle_events;
DROP TRIGGER IF EXISTS trg_vs_dirty_events_upd ON public.vehicle_events;
DROP TRIGGER IF EXISTS trg_vs_dirty_events_del ON public.vehicle_events;
CREATE TRIGGER trg_vs_dirty_events_ins AFTER INSERT ON public.vehicle_events REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_support_mark_dirty();
CREATE TRIGGER trg_vs_dirty_events_upd AFTER UPDATE ON public.vehicle_events REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_support_mark_dirty();
CREATE TRIGGER trg_vs_dirty_events_del AFTER DELETE ON public.vehicle_events REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_support_mark_dirty();

DROP TRIGGER IF EXISTS trg_vs_dirty_documents_ins ON public.vehicle_documents;
DROP TRIGGER IF EXISTS trg_vs_dirty_documents_upd ON public.vehicle_documents;
DROP TRIGGER IF EXISTS trg_vs_dirty_documents_del ON public.vehicle_documents;
CREATE TRIGGER trg_vs_dirty_documents_ins AFTER INSERT ON public.vehicle_documents REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_support_mark_dirty();
CREATE TRIGGER trg_vs_dirty_documents_upd AFTER UPDATE ON public.vehicle_documents REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_support_mark_dirty();
CREATE TRIGGER trg_vs_dirty_documents_del AFTER DELETE ON public.vehicle_documents REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_support_mark_dirty();

DROP TRIGGER IF EXISTS trg_vs_dirty_vehicles_upd ON public.vehicles;
CREATE TRIGGER trg_vs_dirty_vehicles_upd AFTER UPDATE ON public.vehicles REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.vehicle_support_mark_dirty();

REVOKE ALL ON FUNCTION public.vehicle_support_run(uuid[], boolean, integer, integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vehicle_support_revert_run(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vehicle_support_assess(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vehicle_support_neighbours(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vehicle_support_mark_dirty() FROM PUBLIC;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.vehicle_support_run(uuid[], boolean, integer, integer, text) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.vehicle_support_revert_run(uuid, text) TO service_role';
    EXECUTE 'GRANT EXECUTE ON FUNCTION public.vehicle_support_assess(uuid[]) TO service_role';
  END IF;
END $$;

COMMIT;
