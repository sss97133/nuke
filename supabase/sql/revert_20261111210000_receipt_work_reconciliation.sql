-- Revert 20261111210000_receipt_work_reconciliation. Normal undo of a producer run is by run id
-- (rollback_garage_derivation_run / rollback_evidence_judgment_run); this removes the department's schema itself.
-- Refuses while active receipt_work_correlation rows exist (supersede them by run first).
SET lock_timeout = '5s';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.garage_derivation_evidence WHERE kind = 'receipt_work_correlation' AND superseded_at IS NULL) THEN
    RAISE EXCEPTION 'active receipt_work_correlation rows: roll their runs back first';
  END IF;
END $$;
DROP FUNCTION IF EXISTS public.rollback_evidence_judgment_run(uuid, text, boolean);
DROP TABLE IF EXISTS public.evidence_judgment_requests;
DROP FUNCTION IF EXISTS public.receipt_work_lines(uuid, int, int);
DROP FUNCTION IF EXISTS public.image_photo_end(text, text);
DROP FUNCTION IF EXISTS public.image_photo_zones(text, text, text, text[]);
DROP FUNCTION IF EXISTS public.receipt_line_photo_end(text);
DROP FUNCTION IF EXISTS public.receipt_line_kind(text, text, numeric, numeric, date, text);
-- first readings, as in 20261111090000
CREATE OR REPLACE FUNCTION public.receipt_line_photo_zone(p_description text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN d ~* '\m(dash|cluster|gauge|tach|clock|speedo|instrument|glove ?box|console|radio|steering|horn|shifter|bezel|heater control|ash ?tray|lighter)' THEN 'dashboard'
    WHEN d ~* '\m(seat|upholst|foam|headrest|carpet|headliner|door panel|sill plate|kick panel|visor|dome light|arm ?rest)' THEN 'interior'
    WHEN d ~* '\m(engine|carb|intake|valve cover|header|manifold|distributor|alternator|water pump|radiator|starter|spark|plug wire|pulley|air cleaner|fuel pump|oil pan|timing|thermostat|piston|cylinder|crank|cam|lifter|rocker|gasket|bore|hone)' THEN 'engine'
    WHEN d ~* '\m(wheel|tire|rim|hub ?cap|lug|center cap)' THEN 'wheel'
  END
  FROM (SELECT coalesce(p_description, '') AS d) s
$$;
CREATE OR REPLACE FUNCTION public.receipt_zone_labels(p_zone text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE p_zone
    WHEN 'dashboard' THEN ARRAY['dashboard']
    WHEN 'interior'  THEN ARRAY['seat', 'dashboard']
    WHEN 'engine'    THEN ARRAY['engine_vehicle', 'engine']
    WHEN 'wheel'     THEN ARRAY['wheel', 'rim', 'tire']
  END
$$;
-- kind check: superseded rows of the kind stay as history, so the old check is re-added NOT VALID
ALTER TABLE public.garage_derivation_evidence DROP CONSTRAINT IF EXISTS garage_derivation_evidence_kind_check;
ALTER TABLE public.garage_derivation_evidence ADD CONSTRAINT garage_derivation_evidence_kind_check
  CHECK (kind IN ('scene_label', 'place_match', 'place_exemplar', 'sign_read', 'duplicate_judgment', 'seller_history_match', 'relationship_role')) NOT VALID;
