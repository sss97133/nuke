-- The proof question as a reader: a named part, optionally a named state, returned as vehicles
-- with the photos that witness it.
-- The photo direction's acceptance is three questions of this shape ("Mustangs whose window felts
-- were replaced", "a Porsche that has a specific imperfection", "that imperfection was repaired").
-- Until now nothing in the repository asked it: the only code that read a part key was the writer
-- gate and the keys dry run. Asked by hand on the proof vehicle 2026-11-13 03:01 UTC the rows
-- answer: 446 keyed condition rows with a photo, 364 naming a part, 157 state-and-part pairs; and
-- across all vehicles one part resolves through the existing GIN index in 0.7 s (35 hits).
--
-- What it returns: for the part, one entry per vehicle; inside it one claim per state and capture
-- day with every photo behind it (the fold of the photo direction), and the vehicle's days for that
-- part in order, so a different state on a later day can be read as a change. The day is the
-- witnessed photo's taken_at; a sighting whose photo has no capture time is its own claim with a
-- null day. The side of the car (structured_data.part_side) is part of a claim's identity.
-- What it does not do: it does not decide that two states are a repair, it does not call anything
-- proven (nothing records agreement, a receipt or the owner's word), and it reads the part from
-- structured_data.part_key as landed; rows that carry vehicle_observations.component_subject_id
-- and no part_key are not found yet.
-- Read-only, service role only. No new table, trigger or reader of photos: it reads keyed
-- observations and their existing witness rows.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';

DO $guard$ BEGIN
 IF to_regprocedure('public.keyed_claims_by_part(text,text,uuid)') IS NOT NULL
  OR to_regclass('public.observation_witnesses') IS NULL OR to_regclass('public.condition_taxonomy') IS NULL THEN
  RAISE EXCEPTION 'keyed claim reader owner drifted; inspect current definitions';
 END IF;
END $guard$;

CREATE FUNCTION public.keyed_claims_by_part(p_part_key text,p_state_key text DEFAULT NULL,p_vehicle_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 WITH want AS MATERIALIZED (
  -- The requested state resolved once, before any row is read: a condition key, or property=value.
  SELECT (SELECT ct.descriptor_id FROM public.condition_taxonomy ct WHERE ct.canonical_key=p_state_key) AS descriptor_id,
   (SELECT p.id FROM public.observation_properties p WHERE position('=' in coalesce(p_state_key,''))>0
      AND p.property_key=split_part(p_state_key,'=',1)) AS property_id,
   CASE WHEN position('=' in coalesce(p_state_key,''))>0 THEN split_part(p_state_key,'=',1) END AS property_key,
   CASE WHEN position('=' in coalesce(p_state_key,''))>0 THEN substr(p_state_key,position('=' in p_state_key)+1) END AS property_value),
 hits AS MATERIALIZED (
  -- The containment test is what idx_vobs_structured_data_gin answers; keep it first and literal.
  -- The state filter is applied here, so the row cap bounds the requested population, not the part's.
  SELECT o.id,o.vehicle_id,o.descriptor_id,o.property_id,o.structured_data
  FROM public.vehicle_observations o CROSS JOIN want
  WHERE nullif(btrim(p_part_key),'') IS NOT NULL
   AND o.structured_data @> jsonb_build_object('part_key',p_part_key)
   AND o.is_superseded IS NOT TRUE AND (o.descriptor_id IS NOT NULL OR o.property_id IS NOT NULL)
   AND o.vehicle_id IS NOT NULL AND (p_vehicle_id IS NULL OR o.vehicle_id=p_vehicle_id)
   AND (p_state_key IS NULL
     OR (want.descriptor_id IS NOT NULL AND o.descriptor_id=want.descriptor_id)
     OR (want.property_id IS NOT NULL AND o.property_id=want.property_id
         AND o.structured_data->>want.property_key=want.property_value))
  LIMIT 5000),
 keyed AS (
  SELECT h.id,h.vehicle_id,nullif(btrim(h.structured_data->>'part_side'),'') AS part_side,
   coalesce(ct.canonical_key,p.property_key||'='||coalesce(h.structured_data->>p.property_key,'')) AS state_key,
   ct.descriptor_type
  FROM hits h
  LEFT JOIN public.condition_taxonomy ct ON ct.descriptor_id=h.descriptor_id
  LEFT JOIN public.observation_properties p ON p.id=h.property_id),
 witnessed AS (
  SELECT k.vehicle_id,k.state_key,k.part_side,k.descriptor_type,k.id AS observation_id,i.id AS image_id,i.image_url,
   CASE WHEN i.taken_at IS NOT NULL AND isfinite(i.taken_at) THEN (i.taken_at AT TIME ZONE 'UTC')::date END AS capture_day
  FROM keyed k
  JOIN public.observation_witnesses w ON w.observation_id=k.id
  JOIN public.vehicle_images i ON i.id=w.image_id AND i.vehicle_id=k.vehicle_id
  WHERE k.state_key IS NOT NULL AND (p_state_key IS NULL OR k.state_key=p_state_key)
   AND public.vehicle_image_gallery_eligible(i)),
 claims AS (
  -- One claim per vehicle, state, side and capture day. A sighting whose photo has no capture time
  -- folds with nothing: when it happened relative to the others is unknown, so it stands alone.
  SELECT vehicle_id,state_key,part_side,min(descriptor_type) AS descriptor_type,capture_day,
   count(DISTINCT observation_id) AS n_rows,count(DISTINCT image_id) AS n_photos,
   jsonb_agg(DISTINCT jsonb_build_object('image_id',image_id,'image_url',image_url)) AS photos,
   jsonb_agg(DISTINCT observation_id) AS observation_ids
  FROM witnessed
  GROUP BY vehicle_id,state_key,part_side,capture_day,CASE WHEN capture_day IS NULL THEN observation_id END),
 per_vehicle AS (
  SELECT c.vehicle_id,
   jsonb_agg(jsonb_build_object('state_key',c.state_key,'part_side',c.part_side,'kind',c.descriptor_type,'capture_day',c.capture_day,
     'rows',c.n_rows,'photo_count',c.n_photos,'photos',c.photos,'observation_ids',c.observation_ids)
     ORDER BY c.capture_day NULLS LAST,c.state_key,c.part_side NULLS FIRST,c.observation_ids::text) AS claims,
   (SELECT jsonb_agg(jsonb_build_object('capture_day',d.capture_day,'part_side',d.part_side,'states',d.states)
       ORDER BY d.capture_day,d.part_side NULLS FIRST)
     FROM (SELECT c2.capture_day,c2.part_side,jsonb_agg(DISTINCT c2.state_key) AS states FROM claims c2
       WHERE c2.vehicle_id=c.vehicle_id AND c2.capture_day IS NOT NULL GROUP BY c2.capture_day,c2.part_side) d) AS days,
   count(DISTINCT c.capture_day) AS n_days,sum(c.n_photos) AS photo_citations
  FROM claims c GROUP BY c.vehicle_id)
 SELECT jsonb_build_object(
  'as_of',statement_timestamp(),'logic_version','keyed_claims_by_part/20261116061000',
  'part_key',p_part_key,'state_key',p_state_key,
  'part_in_registry',EXISTS(SELECT 1 FROM public.subject_taxonomy t WHERE t.subject_key=p_part_key AND t.is_active IS NOT FALSE),
  -- A state is a live condition key, or property=value on a registered property.
  'state_in_registry',CASE WHEN p_state_key IS NULL THEN NULL ELSE
     EXISTS(SELECT 1 FROM public.condition_taxonomy ct WHERE ct.canonical_key=p_state_key AND ct.deprecated_at IS NULL)
     OR EXISTS(SELECT 1 FROM want WHERE want.property_id IS NOT NULL) END,
  'vehicles',(SELECT count(*) FROM per_vehicle pv JOIN public.vehicles v ON v.id=pv.vehicle_id AND v.deleted_at IS NULL),
  'claims',(SELECT count(*) FROM claims c JOIN public.vehicles v ON v.id=c.vehicle_id AND v.deleted_at IS NULL),
  'proven',0,'proven_basis','no store records reader agreement, receipt support or an owner decision on a claim',
  'limits','part read from structured_data.part_key; at most 5000 keyed rows of the requested part and state per call; photos are gallery-eligible only',
  'results',coalesce((SELECT jsonb_agg(jsonb_build_object('vehicle_id',pv.vehicle_id,'year',v.year,'make',v.make,'model',v.model,
     'days_seen',pv.n_days,'days',coalesce(pv.days,'[]'::jsonb),'claims',pv.claims)
     ORDER BY pv.photo_citations DESC,pv.vehicle_id)
    FROM per_vehicle pv JOIN public.vehicles v ON v.id=pv.vehicle_id AND v.deleted_at IS NULL),'[]'::jsonb));
$fn$;
REVOKE ALL ON FUNCTION public.keyed_claims_by_part(text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.keyed_claims_by_part(text,text,uuid) TO service_role;
COMMENT ON FUNCTION public.keyed_claims_by_part(text,text,uuid) IS
'For a part key, and optionally a state key and a vehicle: the vehicles whose keyed, witnessed observations name that part, each with one claim per state and capture day and every photo behind it, and the part''s days in order on that vehicle. The photo direction''s proof question as a reader. Decides no change or repair and calls nothing proven. Service role only.';
COMMIT;
