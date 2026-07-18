-- 20260524000200_image_origin_consistency_trigger.sql
--
-- Shape rule: an owner-source photo cannot be attached to a vehicle whose
-- existing photos are entirely listing-source.
--
-- This prevents the "owner photos on a BaT-listing-anchored vehicle" pollution
-- class quad's anchor system was built to detect. Once enforced at insert time,
-- the violation can't be created — the detective function for this case
-- becomes redundant.
--
-- Direction: only owner→listing is blocked. The reverse (listing photo onto
-- an owner-anchored vehicle) is left as-is — a 3rd-party listing photo of
-- the user's vehicle is a legitimate observation, not contamination.

CREATE OR REPLACE FUNCTION public.enforce_image_origin_consistency()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  v_new_origin TEXT;
  v_owner_cnt INT;
  v_listing_cnt INT;
  v_total INT;
BEGIN
  IF NEW.vehicle_id IS NULL THEN RETURN NEW; END IF;

  v_new_origin := classify_image_origin(NEW.source, NEW.image_url);

  -- Only owner-source inserts are gated
  IF v_new_origin <> 'owner' THEN RETURN NEW; END IF;

  SELECT
    count(*) FILTER (WHERE classify_image_origin(source, image_url) = 'owner'),
    count(*) FILTER (WHERE classify_image_origin(source, image_url) = 'listing'),
    count(*)
  INTO v_owner_cnt, v_listing_cnt, v_total
  FROM vehicle_images
  WHERE vehicle_id = NEW.vehicle_id
    AND id <> NEW.id;

  -- First photo (or no listing siblings) — allowed
  IF v_total = 0 OR v_listing_cnt = 0 THEN RETURN NEW; END IF;

  -- Mixed already exists — let it through (historical state, cleanup separate)
  IF v_owner_cnt > 0 THEN RETURN NEW; END IF;

  -- Pure listing-anchored vehicle — reject
  RAISE EXCEPTION
    'cannot attach owner-source photo (source=%) to listing-anchored vehicle % (% listing photos, 0 owner photos)',
    NEW.source, NEW.vehicle_id, v_listing_cnt
    USING HINT = 'Fork the listing vehicle: create a new owner-anchored vehicle row for these photos, then merge via merge_proposals if same chassis.';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_image_origin_consistency ON public.vehicle_images;
CREATE TRIGGER trg_enforce_image_origin_consistency
  BEFORE INSERT ON public.vehicle_images
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_image_origin_consistency();

COMMENT ON FUNCTION public.enforce_image_origin_consistency() IS
'Shape rule: rejects insertion of an owner-source photo onto a vehicle whose existing photos are entirely listing-source. Prevents the anchor-violation class without needing a detective function.';
