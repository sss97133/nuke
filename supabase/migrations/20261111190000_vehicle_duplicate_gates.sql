-- Duplicate / mixed-record gates. Nothing here merges or moves anything.
--  1. normalize_vehicle_model_family(model): chassis codes and trim words dropped, so 'K15 Suburban' = 'Suburban',
--     'K5 Blazer' = 'Jimmy' (one blazer-jimmy family). Conservative: unknown models normalize to themselves.
--  2. find_vehicle_duplicate_candidates(vehicle): READ-ONLY candidates for a review queue. Same user relation, same
--     make, year within 1, same model family, VINs compatible (either missing, or equal). Never auto-merges.
--  3. vehicle_image_filing_gate: BEFORE INSERT / UPDATE OF vehicle_id on vehicle_images. When the flag
--     platform_config 'vehicle_image_filing_gate' {"enabled": true} is on and the image's own year / model
--     (vehicle_images.vehicle_year, else ai_detected_vehicle) contradicts the target vehicle (year more than 3 apart,
--     or a different model family, used as the generation proxy since no generation table exists), the image is
--     filed with image_vehicle_match_status = 'mismatch' (readers already hide 'mismatch') for review, instead of
--     silently. OFF by default. Testimony is untouched: only the status is set; the claim stays on the row.
-- Rollback: drop the two triggers, the three functions and the config row.
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '5s';

CREATE FUNCTION public.normalize_vehicle_model_family(p_model text)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $fn$
DECLARE s text; s0 text;
BEGIN
  s0 := lower(btrim(coalesce(p_model, '')));
  IF s0 = '' THEN RETURN NULL; END IF;
  s0 := regexp_replace(s0, '[^a-z0-9 ]', ' ', 'g');
  s := regexp_replace(s0, '\m[ckrv][0-9]{1,2}\M', ' ', 'g');                       -- chassis codes k15, c10, k5
  s := regexp_replace(s, '\m[0-9]{3,4}\M', ' ', 'g');                              -- 1500, 2500
  s := regexp_replace(s, '\m(series|truck|pickup|sport|utility|wagon|4x4|4wd|2wd|custom|deluxe)\M', ' ', 'g');
  s := btrim(regexp_replace(s, '\s+', ' ', 'g'));
  IF s ~ '\msuburban\M' THEN RETURN 'suburban'; END IF;
  IF s ~ '\m(jimmy|blazer)\M' THEN RETURN 'blazer-jimmy'; END IF;
  IF s = '' THEN
    RETURN CASE WHEN s0 ~ '\m[ckrv][0-9]{2}\M' THEN 'ck-truck' END;
  END IF;
  RETURN s;
END
$fn$;

CREATE FUNCTION public.find_vehicle_duplicate_candidates(p_vehicle uuid)
RETURNS TABLE(candidate_vehicle_id uuid, score numeric, year_diff integer, model_family text, vin_state text,
              shared_user_ids uuid[], reasons jsonb)
LANGUAGE sql STABLE SET search_path = public
AS $fn$
  WITH t AS (
    SELECT v.id, v.year, lower(btrim(v.make)) AS mk, v.model, public.normalize_vehicle_model_family(v.model) AS fam,
           nullif(upper(btrim(v.vin)), '') AS vin
      FROM vehicles v WHERE v.id = p_vehicle AND v.deleted_at IS NULL AND v.merged_into_vehicle_id IS NULL
  ),
  tu AS (  -- accounts with a relation to the target
    SELECT v.user_id AS uid FROM vehicles v, t WHERE v.id = t.id AND v.user_id IS NOT NULL
    UNION SELECT d.user_id FROM vehicle_relationship_derivations d WHERE d.vehicle_id = p_vehicle AND d.superseded_at IS NULL
    UNION SELECT p.user_id FROM vehicle_user_permissions p WHERE p.vehicle_id = p_vehicle AND p.revoked_at IS NULL
  ),
  rel AS (  -- other vehicles those accounts relate to, with the shared accounts
    SELECT x.vid, array_agg(DISTINCT x.uid) AS uids FROM tu CROSS JOIN LATERAL (
      SELECT v2.id AS vid, tu.uid FROM vehicles v2 WHERE v2.user_id = tu.uid
      UNION ALL SELECT d.vehicle_id, tu.uid FROM vehicle_relationship_derivations d
        WHERE d.user_id = tu.uid AND d.superseded_at IS NULL
      UNION ALL SELECT p.vehicle_id, tu.uid FROM vehicle_user_permissions p
        WHERE p.user_id = tu.uid AND p.revoked_at IS NULL) x
    WHERE x.vid <> p_vehicle GROUP BY x.vid
  )
  SELECT c.id, least(1, 0.50
           + CASE WHEN c.year = t.year THEN 0.15 ELSE 0.05 END
           + CASE WHEN t.vin IS NOT NULL AND t.vin = nullif(upper(btrim(c.vin)), '') THEN 0.30 ELSE 0 END
           + CASE WHEN lower(btrim(c.model)) = lower(btrim(t.model)) THEN 0.05 ELSE 0 END
           + least(0.10, 0.05 * (cardinality(rel.uids) - 1)))::numeric(4,2),
         abs(c.year - t.year), t.fam,
         CASE WHEN t.vin IS NULL AND nullif(btrim(c.vin), '') IS NULL THEN 'both_missing'
              WHEN t.vin IS NULL OR nullif(btrim(c.vin), '') IS NULL THEN 'one_missing' ELSE 'equal' END,
         rel.uids,
         jsonb_build_object('target_year', t.year, 'candidate_year', c.year, 'make', t.mk, 'model_family', t.fam,
           'target_model', t.model, 'candidate_model', c.model, 'shared_accounts', cardinality(rel.uids))
    FROM t JOIN rel ON true JOIN vehicles c ON c.id = rel.vid
   WHERE c.deleted_at IS NULL AND c.merged_into_vehicle_id IS NULL
     AND lower(btrim(c.make)) = t.mk
     AND t.year IS NOT NULL AND c.year IS NOT NULL AND abs(c.year - t.year) <= 1
     AND t.fam IS NOT NULL AND public.normalize_vehicle_model_family(c.model) = t.fam
     AND (t.vin IS NULL OR nullif(btrim(c.vin), '') IS NULL OR t.vin = upper(btrim(c.vin)))
   ORDER BY 2 DESC, 1 LIMIT 50;
$fn$;
COMMENT ON FUNCTION public.find_vehicle_duplicate_candidates(uuid) IS
  'Read-only duplicate candidates for a review queue: same account relation, same make, year within 1, same model family, VINs compatible. Score = 0.50 + year (0.15 same, 0.05 off by one) + VIN equal 0.30 + identical model text 0.05 + 0.05 per extra shared account (max 0.10). Never merges.';
REVOKE ALL ON FUNCTION public.find_vehicle_duplicate_candidates(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.find_vehicle_duplicate_candidates(uuid) TO service_role;

INSERT INTO public.platform_config(config_key, config_value, description)
VALUES ('vehicle_image_filing_gate', '{"enabled": false, "max_year_gap": 3, "min_ai_confidence": 0.5}',
        'Feature flag. When enabled, vehicle_image_filing_gate files an image whose own year/model contradicts the target vehicle as image_vehicle_match_status = mismatch (review) instead of silently.')
ON CONFLICT (config_key) DO NOTHING;

CREATE FUNCTION public.vehicle_image_filing_gate() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $fn$
DECLARE
  cfg jsonb; j jsonb; t record; gap int; conf numeric; yrs text[]; lo int; hi int; img_fam text;
BEGIN
  SELECT pc.config_value INTO cfg FROM platform_config pc WHERE pc.config_key = 'vehicle_image_filing_gate';
  IF NOT coalesce((cfg->>'enabled')::boolean, false) OR NEW.vehicle_id IS NULL THEN RETURN NEW; END IF;
  gap := coalesce((cfg->>'max_year_gap')::int, 3);
  j := to_jsonb(NEW);
  conf := nullif(j->'ai_detected_vehicle'->>'confidence', '')::numeric;
  IF conf IS NOT NULL AND conf < coalesce((cfg->>'min_ai_confidence')::numeric, 0.5) THEN RETURN NEW; END IF;
  SELECT v.year, v.model INTO t FROM vehicles v WHERE v.id = NEW.vehicle_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- the image's own year: vehicle_year, else ai year, else the ends of ai year_range
  yrs := ARRAY(SELECT m[1] FROM regexp_matches(
           coalesce(nullif(j->>'vehicle_year', ''), j->'ai_detected_vehicle'->>'year', j->'ai_detected_vehicle'->>'year_range', ''),
           '((?:18|19|20)[0-9]{2})', 'g') m);
  IF cardinality(yrs) > 0 THEN
    SELECT min(y::int), max(y::int) INTO lo, hi FROM unnest(yrs) y;
    IF t.year IS NOT NULL AND (t.year < lo - gap OR t.year > hi + gap) THEN
      NEW.image_vehicle_match_status := 'mismatch'; RETURN NEW;
    END IF;
  END IF;
  img_fam := public.normalize_vehicle_model_family(j->'ai_detected_vehicle'->>'model');
  IF img_fam IS NOT NULL AND public.normalize_vehicle_model_family(t.model) IS NOT NULL
     AND img_fam <> public.normalize_vehicle_model_family(t.model) THEN
    NEW.image_vehicle_match_status := 'mismatch';
  END IF;
  RETURN NEW;
END
$fn$;

CREATE TRIGGER zz_vehicle_images_filing_gate_ins BEFORE INSERT ON public.vehicle_images
  FOR EACH ROW WHEN (NEW.vehicle_id IS NOT NULL) EXECUTE FUNCTION public.vehicle_image_filing_gate();
CREATE TRIGGER zz_vehicle_images_filing_gate_upd BEFORE UPDATE OF vehicle_id ON public.vehicle_images
  FOR EACH ROW WHEN (NEW.vehicle_id IS NOT NULL AND OLD.vehicle_id IS DISTINCT FROM NEW.vehicle_id)
  EXECUTE FUNCTION public.vehicle_image_filing_gate();
COMMIT;
