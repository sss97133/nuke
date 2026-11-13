-- Writer gate, third piece: a visual_work_v1 record that cites a photo cites what the model
-- already holds about that photo.
-- Read on the proof vehicle 2026-11-12 02:12 UTC: 31 current records, 23 of them citing a photo
-- that already has a keyed claim in the database (41 citations). Every one of those citations
-- carries a fresh caption and none names a keyed claim, so the same photo is described again in
-- new words and the keyed rows are never connected to the work they witness.
-- From this migration on, a visual_sources entry whose photo has a keyed claim on the same
-- vehicle carries keyed_claim_ids: the ids of those claims it relies on, at least one. Every id
-- listed must be a current keyed observation of this vehicle that the photo witnesses. The
-- caption stays (the reader requires it); a photo with no keyed claim is not affected. Stored
-- rows are not touched or re-checked.
BEGIN;
SET LOCAL lock_timeout='3s';
SET LOCAL statement_timeout='10s';

DO $guard$ BEGIN
 IF to_regprocedure('public.visual_work_uncited_keyed_photos(uuid,jsonb)') IS NOT NULL
  OR to_regprocedure('public.visual_work_unplaced_part_keys(jsonb)') IS NULL
  OR to_regprocedure('public.visual_work_unplaced_system_keys(jsonb)') IS NULL
  OR NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='public.vehicle_observations'::regclass
       AND tgname='guard_visual_work_keys_insert' AND NOT tgisinternal) THEN
  RAISE EXCEPTION 'visual work key guard owner drifted; inspect current definitions';
 END IF;
END $guard$;

-- The cited photos of a record that are not tied to the model's keyed claims: a photo that has
-- keyed claims and cites none, or a photo whose entry lists an id that is not a current keyed
-- claim of this vehicle witnessed by that photo. Empty means every citation is connected.
CREATE FUNCTION public.visual_work_uncited_keyed_photos(p_vehicle_id uuid,p_doc jsonb)
RETURNS text[] LANGUAGE sql STABLE SECURITY DEFINER SET search_path=''
AS $fn$
 WITH refs AS (
  SELECT lower(v.ref->>'image_id') AS image_id,
   CASE WHEN jsonb_typeof(v.ref->'keyed_claim_ids')='array' THEN v.ref->'keyed_claim_ids' ELSE '[]'::jsonb END AS cited
  FROM jsonb_array_elements(
    CASE WHEN jsonb_typeof(p_doc->'visual_sources')='array' THEN p_doc->'visual_sources' ELSE '[]'::jsonb END) v(ref)
  WHERE coalesce(v.ref->>'image_id','') ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'),
 keyed AS (
  SELECT r.image_id,k.id::text AS claim_id
  FROM (SELECT DISTINCT image_id FROM refs) r
  JOIN public.observation_witnesses w ON w.image_id=r.image_id::uuid
  JOIN public.vehicle_observations k ON k.id=w.observation_id
  WHERE k.vehicle_id=p_vehicle_id AND k.is_superseded IS NOT TRUE
   AND (k.descriptor_id IS NOT NULL OR k.property_id IS NOT NULL))
 SELECT coalesce(array_agg(DISTINCT r.image_id ORDER BY r.image_id),'{}'::text[])
 FROM refs r
 WHERE (jsonb_array_length(r.cited)=0 AND EXISTS(SELECT 1 FROM keyed k WHERE k.image_id=r.image_id))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.cited) c
    WHERE jsonb_typeof(c.value) IS DISTINCT FROM 'string'
     OR NOT EXISTS(SELECT 1 FROM keyed k WHERE k.image_id=r.image_id AND k.claim_id=c.value#>>'{}'));
$fn$;
REVOKE ALL ON FUNCTION public.visual_work_uncited_keyed_photos(uuid,jsonb) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.visual_work_uncited_keyed_photos(uuid,jsonb) TO service_role;
COMMENT ON FUNCTION public.visual_work_uncited_keyed_photos(uuid,jsonb) IS
'Photos cited in a visual_work_v1 record''s visual_sources that are not tied to the model''s keyed claims: the photo has a current keyed observation on this vehicle (descriptor_id or property_id set, witnessed through observation_witnesses) and the entry''s keyed_claim_ids is empty, or keyed_claim_ids lists an id that is not such a claim on that photo. Empty means every cited photo is connected.';

CREATE OR REPLACE FUNCTION public.guard_visual_work_keys()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=''
AS $fn$
DECLARE missing text[];
BEGIN
 missing:=public.visual_work_unplaced_system_keys(NEW.structured_data);
 IF cardinality(missing)>0 THEN
  -- The writer returns only the message, so the legal moves are in it.
  RAISE EXCEPTION 'unregistered_system_key: %. Use a subject_taxonomy.category already in use, or declare each new key in structured_data.key_proposals as {"kind":"system","key":...,"nearest_existing":<a category in use, or "none">,"reason":...}',
   array_to_string(missing,', ') USING ERRCODE='23514';
 END IF;
 missing:=public.visual_work_unplaced_part_keys(NEW.structured_data);
 IF cardinality(missing)>0 THEN
  RAISE EXCEPTION 'unregistered_part_key: %. Every materials and operations line needs part_key, the part of the vehicle it is about: a subject_taxonomy.subject_key in use (the keyed photo claims on this vehicle use the same keys in structured_data.part_key), "not_a_part" for a consumable or a charge, "cannot_tell", or a new key declared in structured_data.key_proposals as {"kind":"part","key":...,"nearest_existing":<a subject_key in use, or "none">,"reason":...}. physical_material_key stays the line id.',
   array_to_string(missing,', ') USING ERRCODE='23514';
 END IF;
 missing:=public.visual_work_uncited_keyed_photos(NEW.vehicle_id,NEW.structured_data);
 IF cardinality(missing)>0 THEN
  RAISE EXCEPTION 'uncited_keyed_claim: photos %. Each of these photos already has keyed claims on this vehicle, or its entry lists an id that is not one. In its visual_sources entry set keyed_claim_ids to the ids of the claims the record relies on (at least one): vehicle_observations rows of this vehicle, not superseded, with descriptor_id or property_id set, joined to the photo through observation_witnesses.image_id. The caption stays.',
   array_to_string(missing,', ') USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.guard_visual_work_keys() FROM PUBLIC,anon,authenticated;
COMMIT;
