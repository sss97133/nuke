-- vehicle_card_images: the card photo is never one the vision gate rejected or holds, for any caller.
--
-- Measured 2026-10-19 on Viva! Las Vegas Autos (organizations c433d27e-…): the card reader mirrored the vehicle_images row
-- policies, and those let the owner and every active contributor read every row of their vehicles. So for a signed-in team
-- member the gate rule ("not rejected_personal, rejected_misattributed or review_needed; not superseded") applied only to a
-- public vehicle seen by a stranger, and a card could be a photo the gate had already thrown out. The dealer's linked vehicles
-- hold 2,193 review_needed photos (average attribution confidence 0.23) and 2,511 rejected_misattributed ones; the owner's
-- photos on them alone: 1,228 rejected_misattributed, 720 review_needed. Signed in, the card was the earliest of all of those,
-- ungated first. The vehicle's own gallery is where the owner reviews held photos; a card is a claim about what the car looks like.
--
-- Change: the gate and the superseded flag apply to every caller, in both probes. Who may see which vehicle is unchanged
-- (own image, own vehicle, a vehicle of an organization the caller actively contributes to, a public vehicle's non-sensitive
-- image). The ordering is unchanged, so the index probes and their cost are unchanged. A vehicle whose only photos are gated
-- now has no card photo (the page shows its placeholder), which is what a stranger already saw.
-- Contract: supabase/sql/test_vehicle_card_images.sql (adds the owner and member cases with a gated primary).
BEGIN;
SET LOCAL statement_timeout = '30s';
SET LOCAL lock_timeout = '2s';

CREATE OR REPLACE FUNCTION public.vehicle_card_images(p_vehicle_ids uuid[])
 RETURNS TABLE(vehicle_id uuid, thumbnail_url text, medium_url text, image_url text, variants jsonb, is_primary boolean, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH me AS (SELECT (SELECT auth.uid()) AS uid),
  ids AS (
    SELECT DISTINCT u.id
    FROM unnest(p_vehicle_ids) AS u(id)
    WHERE u.id IS NOT NULL
    LIMIT 1000
  ),
  veh AS (
    SELECT v.id, v.is_public,
           me.uid,
           (me.uid IS NOT NULL AND (
              v.user_id = me.uid OR v.uploaded_by = me.uid OR v.owner_id = me.uid
              OR EXISTS (SELECT 1
                         FROM organization_vehicles ov
                         JOIN organization_contributors oc ON oc.organization_id = ov.organization_id
                         WHERE ov.vehicle_id = v.id AND oc.user_id = me.uid AND oc.status = 'active')
           )) AS mine
    FROM ids
    JOIN vehicles v ON v.id = ids.id
    CROSS JOIN me
  )
  SELECT best.vehicle_id, best.thumbnail_url, best.medium_url, best.image_url, best.variants, best.is_primary, best.created_at
  FROM veh
  CROSS JOIN LATERAL (
    -- the primary image if the caller can see one, else the earliest the caller can see
    (SELECT i.vehicle_id, i.thumbnail_url, i.medium_url, i.image_url, i.variants, i.is_primary, i.created_at
       FROM vehicle_images i
      WHERE i.vehicle_id = veh.id
        AND i.is_primary
        AND i.is_superseded IS NOT TRUE
        AND (i.vision_gate_status IS NULL
             OR i.vision_gate_status NOT IN ('rejected_personal', 'rejected_misattributed', 'review_needed'))
        AND (veh.mine OR i.user_id = veh.uid
             OR (veh.is_public AND NOT i.is_sensitive))
      ORDER BY i.created_at ASC
      LIMIT 1)
    UNION ALL
    (SELECT i.vehicle_id, i.thumbnail_url, i.medium_url, i.image_url, i.variants, i.is_primary, i.created_at
       FROM vehicle_images i
      WHERE i.vehicle_id = veh.id
        AND i.is_superseded IS NOT TRUE
        AND (i.vision_gate_status IS NULL
             OR i.vision_gate_status NOT IN ('rejected_personal', 'rejected_misattributed', 'review_needed'))
        AND (veh.mine OR i.user_id = veh.uid
             OR (veh.is_public AND NOT i.is_sensitive))
      ORDER BY i.created_at ASC
      LIMIT 1)
    LIMIT 1
  ) best
$function$;

REVOKE ALL ON FUNCTION public.vehicle_card_images(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_card_images(uuid[]) TO anon, authenticated, service_role;

COMMIT;
