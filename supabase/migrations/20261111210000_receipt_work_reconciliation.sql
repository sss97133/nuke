-- Department: receipt-to-work evidence reconciliation (all vehicles; a vehicle is a case moving through it).
--
-- What this adds (additive; revert: supabase/sql/revert_20261111210000_receipt_work_reconciliation.sql):
--   receipt_line_kind(...)            what a receipt line is: part | labor | charge | backordered | kit_component | note
--   receipt_line_photo_zone(text)     second reading: adds 'exterior' and 'undercarriage', stops reading Camaro "CAM/" as a
--                                     camshaft and a tail-lamp bezel as a dash bezel (first match still wins)
--   receipt_line_photo_end(text)      'rear' | 'front' | null: which end of the car the line names
--   receipt_zone_labels(text)         labels for the two new zones (the day reader's install proof uses these)
--   image_photo_zones(...)            the receipt zones a frame shows, from what the pipelines already wrote on the frame
--                                     (classifier angle, promoted vehicle_zone, deep-analysis scene_type, on-device labels)
--   receipt_work_lines(vehicle)       the deterministic correlation: every linked receipt line (or the receipt itself when it
--                                     has no lines) x the vehicle's gate-approved, non-sensitive, non-duplicate photos by EXIF
--                                     day and zone, work_sessions and timeline_events on those days -> one conclusion per line,
--                                     a confidence, the cited ids, and whether a judgment is needed
--   garage_derivation_evidence.kind   + 'receipt_work_correlation' (the producer's signed conclusions)
--   evidence_judgment_requests        parameterized questions a trigger raises for a later agent/model to answer
--                                     (department, question_kind, subject, params, answer_schema); signed like evidence;
--                                     undo a run with rollback_evidence_judgment_run
-- Producer: scripts/receipt-work/reconcile-receipt-work.mjs (signs rows with <git sha>:<script>).
-- Contract: supabase/sql/test_receipt_work_reconciliation.sql.

SET lock_timeout = '5s';
SET statement_timeout = '120s';

-- ─── evidence kind ─────────────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.garage_derivation_evidence DROP CONSTRAINT IF EXISTS garage_derivation_evidence_kind_check;
ALTER TABLE public.garage_derivation_evidence ADD CONSTRAINT garage_derivation_evidence_kind_check
  CHECK (kind IN ('scene_label', 'place_match', 'place_exemplar', 'sign_read', 'duplicate_judgment', 'seller_history_match',
                  'relationship_role', 'receipt_work_correlation'));

-- ─── what a line is ────────────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.receipt_line_kind(p_description text, p_part_number text, p_total numeric, p_hours numeric,
                                                    p_line_date date, p_performer text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN d ~* '\m(shipping|freight|handling|delivery|sales tax|tax|discount|coupon|core charge|core exchange|core return|return|deposit|payment|surcharge|fee|subtotal|total)\M'
         OR coalesce(p_part_number, '') ~* '^\{?(shipping|freight|tax|handling)\}?$' THEN 'charge'
    WHEN d ~* 'back[- ]?order' OR d ~* 'qty shipped 0' THEN 'backordered'
    WHEN d ~* 'kit component' THEN 'kit_component'
    WHEN p_hours IS NOT NULL OR nullif(btrim(coalesce(p_performer, '')), '') IS NOT NULL
         OR (p_part_number IS NULL AND p_total IS NULL AND p_line_date IS NOT NULL) THEN 'labor'
    WHEN p_part_number IS NULL AND p_total IS NULL THEN 'note'
    ELSE 'part'
  END
  FROM (SELECT coalesce(p_description, '') AS d) s
$$;
COMMENT ON FUNCTION public.receipt_line_kind(text, text, numeric, numeric, date, text) IS
  'What a receipt line is: charge (shipping, tax, fees), backordered (nothing shipped), kit_component (priced on its kit line), labor (hours, a performer, or a dated unpriced work note), note (unpriced, no part number), else part. First match wins.';

-- ─── what a line''s words say a photo would show (second reading) ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.receipt_line_photo_zone(p_description text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE
    -- loose hardware and switches: a photo would not show them
    WHEN d ~* '\m(fstnrs|fasteners?|weatherstrip|switch)\M' OR d ~* '\m(screws?|bolts?|nuts|clips?)\M\s*(set|kit|\(|$)' THEN NULL
    -- steering and fuel hardware that lives under the car or in the engine bay, not on the dash
    WHEN d ~* '\m(steering (box|gear)|pitman|steering arm|tie rod|drag link|steering knuckle|in-tank|fuel tank|tank sending)' THEN 'undercarriage'
    WHEN d ~* '\m(power steering|steering pump|p/s pump)' THEN 'engine'
    -- lamps, lenses and their bezels are on the body ends, not the dash
    WHEN d ~* '\m(tail ?lamp|tail ?light|t/?l ?la?mp|head ?lamp|headlight|marker lamp|park(ing)? lamp|back ?up lamp)' THEN 'exterior'
    WHEN d ~* '\m(dash|cluster|gauge|tach|clock|speedo|instrument|glove ?box|glv box|console|radio|steering|horn|shifter|bezel|heater control|htr ctrl|ash ?tray|lighter|radio knobs?|am/fm)' THEN 'dashboard'
    WHEN d ~* '\m(seat|upholst|foam|headrest|carpet|headliner|door panel|door pnl|sill plate|kick panel|visor|dome light|arm ?rest|spe?a?ke?r shelf|spkr shlf|package tray|sill plte|cpt|uph|shi?ft boot|shft boot|grshft|shift tunnel|window crank|wndow crnk|door lock knob)' THEN 'interior'
    -- "CAM/FB" is a Camaro/Firebird fitment, not a camshaft
    WHEN d ~* '\m(engine|carb|intake|valve cover|header|manifold|distributor|alternator|water pump|radiator|rad support|rad core|starter|spark|plug wire|pulley|air cleaner|fuel pump|oil pan|timing|thermostat|piston|cylinder|crank|lifter|rocker arm|rockers|gasket|bore|hone|firewall|frwall|dipstick|cooling system|emission|water neck|pcv|sending uni|clnr|fan clutch|oil filter|battery|surface heads|cylinder heads?|valve job|block)'
         OR d ~* '\mcam(shaft)?\M(?!/)' THEN 'engine'
    WHEN d ~* '\m(wheel|tire|rim|hub ?cap|lug|center cap)' THEN 'wheel'
    WHEN d ~* '\m(exhaust|muffler|tail ?pipe|driveshaft|drive shaft|axle|leaf spring|shock|control arm|sway bar|frame rail|floor pan|fuel tank|brake line)' THEN 'undercarriage'
    WHEN d ~* '\m(bumper|spoiler|hood|tail panel|tail pnl|fender|quarter panel|qtr panel|grille|grill|mirror|emblem|letters|decal|stripe|header panel|rocker panel|deck lid|decklid|trunk|body panel|bdy pnl|deck|door shell|door skin|door hinge|dr hng|cowl|windshield|moulding|molding|sealed beam|wiper)' THEN 'exterior'
  END
  FROM (SELECT coalesce(p_description, '') AS d) s
$$;
COMMENT ON FUNCTION public.receipt_line_photo_zone(text) IS
  'The photo zone a receipt line''s printed description names: dashboard, interior, engine, wheel, undercarriage, exterior, or null when a photo would not show the part (hardware, fluids, shipping). Reviewed keywords, first match wins; lamps before dashboard so a tail-lamp bezel is not a dash bezel, dashboard before interior so a cluster lens is not a seat; "CAM/" is a fitment, not a camshaft.';

CREATE OR REPLACE FUNCTION public.receipt_line_photo_end(p_description text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN d ~* '\m(tail|rear|rr|deck|trunk|back ?up|qtr|quarter)\M' THEN 'rear'
    WHEN d ~* '\m(front|frt|head ?lamp|headlight|grille|grill|hood|header panel|fender)\M' THEN 'front'
  END
  FROM (SELECT coalesce(p_description, '') AS d) s
$$;

CREATE OR REPLACE FUNCTION public.receipt_zone_labels(p_zone text) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE p_zone
    WHEN 'dashboard'     THEN ARRAY['dashboard']
    WHEN 'interior'      THEN ARRAY['seat', 'dashboard']
    WHEN 'engine'        THEN ARRAY['engine_vehicle', 'engine']
    WHEN 'wheel'         THEN ARRAY['wheel', 'rim', 'tire']
    WHEN 'exterior'      THEN ARRAY['Bumper', 'bumper', 'license_plate', 'sportscar', 'Sportscar', 'Muscle Car']
    WHEN 'undercarriage' THEN ARRAY['undercarriage']
  END
$$;
COMMENT ON FUNCTION public.receipt_zone_labels(text) IS
  'The on-device photo labels (vehicle_images.apple_ml_labels) that show a zone from receipt_line_photo_zone. Null for an unknown zone.';

-- ─── what zones a frame shows ─────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.image_photo_zones(p_angle text, p_vehicle_zone text, p_scene text, p_labels text[]) RETURNS text[]
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  -- a frame a reader has placed (classifier angle, promoted zone, deep scene) is read from that placement only;
  -- the on-device labels speak only for a frame no reader has placed (an "engine_vehicle" label on an underside shot is not an engine photo)
  WITH f AS (SELECT p_angle AS a, p_vehicle_zone AS vz, p_scene AS sc,
                    CASE WHEN coalesce(p_angle, p_vehicle_zone, p_scene) IS NULL
                         THEN (SELECT array_agg(lower(l)) FROM unnest(coalesce(p_labels, '{}')) l) ELSE '{}' END AS lb)
  SELECT coalesce(array_agg(z ORDER BY z), '{}') FROM f, LATERAL (
    SELECT 'dashboard' AS z WHERE a = 'interior_dashboard' OR vz = 'int_dashboard' OR coalesce(lb, '{}') && ARRAY['dashboard', 'tachometer', 'dial']
    UNION SELECT 'interior' WHERE a = 'interior_dashboard' OR vz LIKE 'int\_%' OR sc = 'body_interior' OR coalesce(lb, '{}') && ARRAY['seat', 'car_seat']
    UNION SELECT 'engine' WHERE a = 'engine_bay' OR vz = 'mech_engine_bay' OR sc = 'engine_bay' OR coalesce(lb, '{}') && ARRAY['engine_vehicle']
    UNION SELECT 'wheel' WHERE vz LIKE 'wheel\_%' OR vz = 'mech_brakes' OR sc LIKE 'wheel\_assembly%'
    UNION SELECT 'undercarriage' WHERE a = 'undercarriage' OR vz IN ('ext_undercarriage', 'mech_drivetrain', 'mech_exhaust', 'mech_suspension') OR sc = 'undercarriage'
    UNION SELECT 'exterior' WHERE a LIKE 'exterior%' OR (vz LIKE 'ext\_%' AND vz <> 'ext_undercarriage') OR vz LIKE 'panel\_%' OR vz = 'detail_badge'
                              OR sc LIKE 'body\_exterior%' OR coalesce(lb, '{}') && ARRAY['bumper', 'license_plate']
  ) s
$$;
COMMENT ON FUNCTION public.image_photo_zones(text, text, text, text[]) IS
  'The receipt zones (receipt_line_photo_zone vocabulary) a frame shows, read from what the pipelines already wrote: classifier angle (ai_scan_metadata.classification.v2.angle), promoted vehicle_zone, deep-analysis scene_type, on-device labels. Wheel needs a wheel-specific zone or scene: a tire in a side shot is not a wheel photo.';

CREATE OR REPLACE FUNCTION public.image_photo_end(p_angle text, p_vehicle_zone text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog, public AS $$
  SELECT CASE
    WHEN p_angle = 'exterior_rear' OR p_vehicle_zone LIKE 'ext\_rear%' THEN 'rear'
    WHEN p_angle = 'exterior_front' OR p_vehicle_zone LIKE 'ext\_front%' OR p_vehicle_zone = 'panel_hood' THEN 'front'
  END
$$;

-- ─── the correlation ──────────────────────────────────────────────────────────────────────────────────────────
-- One row per linked receipt line (a receipt without lines is one row with item_id null). Clock: photo EXIF taken_at in
-- UTC; anchor = the line's own date, else the link's page date. Install window = anchor .. anchor + p_window_days.
-- Semantics: every row is a PROPOSED contextual relationship (a receipt line and photos that share a time window), with
-- its common source lineage (receipt, source document, line, link, cited image ids). It is never independent
-- corroboration, installation proof, payment proof or an owner Sign. Printed line dates, billed hours and performers are
-- claims attributed to the document, not account identity or labor duration: missing stays null, and a malformed value
-- is refused (reported in refused_fields, never used), not coerced.
DROP FUNCTION IF EXISTS public.receipt_work_lines(uuid, int, int);
CREATE FUNCTION public.receipt_work_lines(p_vehicle_id uuid, p_window_days int DEFAULT 90, p_max_images int DEFAULT 8)
RETURNS TABLE(
  vehicle_id uuid, user_id uuid, receipt_id uuid, item_id uuid, link_id uuid, link_basis text, link_confidence numeric,
  vendor_name text, document_kind text, line_number int, description text, part_number text, total_price numeric,
  line_kind text, zone text, end_hint text, anchor_date date, anchor_source text,
  conclusion text, confidence numeric, days_to_first_photo int,
  zone_photos_total int, zone_photos_in_window int, first_photo_day date, image_ids uuid[],
  day_photos int, work_session_ids uuid[], timeline_event_ids uuid[],
  judgment_needed boolean, logic_version text,
  relationship_status text, source_document_table text, source_document_id uuid, source_page int, refused_fields jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH v AS (SELECT id, coalesce(owner_id, user_id) AS uid FROM vehicles WHERE id = p_vehicle_id),
  raw AS (
    SELECT l.id AS link_id, l.basis, l.confidence AS link_conf, l.page_date AS page_date_raw, l.page_date_source, l.user_id AS link_user,
           r.id AS receipt_id, r.user_id AS receipt_user, r.vendor_name, r.document_kind::text AS document_kind,
           r.receipt_date AS receipt_date_raw, r.source_document_table, r.source_document_id,
           i.id AS item_id, i.line_number, i.description, i.part_number, i.total_price,
           i.line_date AS line_date_raw, i.hours AS hours_raw, nullif(btrim(i.performer), '') AS performer
      FROM receipt_vehicle_links l
      JOIN receipts r ON r.id = l.receipt_id
      LEFT JOIN receipt_items i ON i.receipt_id = r.id
     WHERE l.vehicle_id = p_vehicle_id AND l.status = 'linked' AND l.retired_at IS NULL
       AND r.is_superseded IS NOT TRUE AND r.duplicate_of IS NULL
  ),
  checked AS (  -- printed values are refused when malformed (impossible date, non-positive or absurd hours), never coerced
    SELECT w.*,
           CASE WHEN w.line_date_raw BETWEEN DATE '1900-01-01' AND current_date + 1 THEN w.line_date_raw END AS line_date,
           CASE WHEN w.page_date_raw BETWEEN DATE '1900-01-01' AND current_date + 1 THEN w.page_date_raw END AS page_date,
           CASE WHEN w.receipt_date_raw BETWEEN DATE '1900-01-01' AND current_date + 1 THEN w.receipt_date_raw END AS receipt_date,
           CASE WHEN w.hours_raw > 0 AND w.hours_raw <= 1000 THEN w.hours_raw END AS hours,
           jsonb_strip_nulls(jsonb_build_object(
             'line_date', CASE WHEN w.line_date_raw IS NOT NULL AND w.line_date_raw NOT BETWEEN DATE '1900-01-01' AND current_date + 1 THEN w.line_date_raw::text END,
             'page_date', CASE WHEN w.page_date_raw IS NOT NULL AND w.page_date_raw NOT BETWEEN DATE '1900-01-01' AND current_date + 1 THEN w.page_date_raw::text END,
             'receipt_date', CASE WHEN w.receipt_date_raw IS NOT NULL AND w.receipt_date_raw NOT BETWEEN DATE '1900-01-01' AND current_date + 1 THEN w.receipt_date_raw::text END,
             'hours', CASE WHEN w.hours_raw IS NOT NULL AND NOT (w.hours_raw > 0 AND w.hours_raw <= 1000) THEN w.hours_raw::text END)) AS refused
      FROM raw w
  ),
  lines AS (
    SELECT c.*,
           CASE WHEN c.item_id IS NULL THEN 'receipt' ELSE receipt_line_kind(c.description, c.part_number, c.total_price, c.hours, c.line_date, c.performer) END AS kind,
           receipt_line_photo_zone(c.description) AS zone, receipt_line_photo_end(c.description) AS end_hint,
           coalesce(c.line_date, c.page_date, c.receipt_date) AS anchor,
           CASE WHEN c.line_date IS NOT NULL THEN 'line_date' WHEN c.page_date IS NOT NULL THEN coalesce('page_date:' || c.page_date_source, 'page_date')
                WHEN c.receipt_date IS NOT NULL THEN 'receipt_date' END AS anchor_source
      FROM checked c
  ),
  imgs AS MATERIALIZED (
    SELECT x.id, x.taken_at, (x.taken_at AT TIME ZONE 'UTC')::date AS d, x.work_session_id,
           image_photo_zones(x.ai_scan_metadata #>> '{classification,v2,angle,value}', x.vehicle_zone,
                             x.ai_scan_metadata #>> '{byok_deep_analysis,scene_type}', x.apple_ml_labels) AS zones,
           image_photo_end(x.ai_scan_metadata #>> '{classification,v2,angle,value}', x.vehicle_zone) AS img_end
      FROM vehicle_images x
     WHERE x.vehicle_id = p_vehicle_id AND x.taken_at IS NOT NULL
       AND x.vision_gate_status = 'approved'                       -- personal / misattributed frames never cited
       AND x.is_sensitive IS NOT TRUE AND x.is_duplicate IS NOT TRUE AND x.is_superseded IS NOT TRUE
       -- screenshots, reference pictures and paperwork are not photos of the work on this vehicle
       AND x.is_document IS NOT TRUE
       AND coalesce(x.ai_scan_metadata #>> '{byok_deep_analysis,scene_type}', '') NOT IN ('product_screenshot', 'cross_reference', 'receipt_document', 'hand_drawn_diagram')
  ),
  zl AS (
    SELECT ln.link_id, ln.item_id,
           count(m.id)::int AS total,
           count(m.id) FILTER (WHERE m.d <= ln.anchor + p_window_days)::int AS in_window,
           min(m.d) AS first_day,
           (array_agg(m.id ORDER BY (m.d <= ln.anchor + p_window_days) DESC, coalesce(m.img_end = ln.end_hint, false) DESC, cardinality(m.zones),
                             md5(m.id::text || coalesce(ln.item_id, ln.receipt_id)::text)))[1:p_max_images] AS ids  -- line-specific spread, not the day's first frames
      FROM lines ln
      LEFT JOIN imgs m ON ln.zone IS NOT NULL AND ln.anchor IS NOT NULL AND m.d >= ln.anchor AND ln.zone = ANY (m.zones)
                     -- a frame of the other end of the car cannot show this line's part
                     AND NOT (ln.end_hint IS NOT NULL AND m.img_end IS NOT NULL AND m.img_end <> ln.end_hint)
     GROUP BY ln.link_id, ln.item_id
  ),
  dl AS (  -- labor / whole-receipt rows: photos of any zone on the anchor day +-1
    SELECT ln.link_id, ln.item_id, count(m.id)::int AS n, (array_agg(m.id ORDER BY m.taken_at))[1:p_max_images] AS ids
      FROM lines ln
      LEFT JOIN imgs m ON ln.anchor IS NOT NULL AND m.d BETWEEN ln.anchor - 1 AND ln.anchor + 1
     GROUP BY ln.link_id, ln.item_id
  ),
  shaped AS (
    SELECT ln.*, zl.total, zl.in_window, zl.first_day, dl.n AS day_n,
           CASE WHEN ln.kind IN ('labor', 'receipt') THEN dl.ids ELSE zl.ids END AS cite_ids,
           CASE
             WHEN ln.kind IN ('charge', 'backordered', 'kit_component', 'note') THEN 'not_work_evidence'
             WHEN ln.anchor IS NULL THEN 'undated_line'
             WHEN ln.kind = 'labor' AND dl.n > 0 THEN 'work_day_photographed'
             WHEN ln.kind = 'labor' THEN 'work_day_unphotographed'
             -- a line-less receipt is a purchase on a day, not work on it
             WHEN ln.kind = 'receipt' AND dl.n > 0 THEN 'receipt_day_photographed'
             WHEN ln.kind = 'receipt' THEN 'receipt_day_unphotographed'
             WHEN ln.zone IS NULL THEN 'part_zone_unknown'
             WHEN zl.in_window > 0 THEN 'install_window_photographed'
             WHEN zl.total > 0 THEN 'photographed_after_window'
             ELSE 'no_zone_photo_after_purchase'
           END AS concl
      FROM lines ln
      JOIN zl ON zl.link_id = ln.link_id AND zl.item_id IS NOT DISTINCT FROM ln.item_id
      JOIN dl ON dl.link_id = ln.link_id AND dl.item_id IS NOT DISTINCT FROM ln.item_id
  )
  SELECT p_vehicle_id, coalesce(s.link_user, s.receipt_user, (SELECT uid FROM v)), s.receipt_id, s.item_id, s.link_id, s.basis, s.link_conf,
         s.vendor_name, s.document_kind, s.line_number, s.description, s.part_number, s.total_price,
         s.kind, s.zone, s.end_hint, s.anchor, s.anchor_source,
         s.concl,
         round(least(1, greatest(0, coalesce(s.link_conf, 0.7) * CASE s.concl
           WHEN 'install_window_photographed' THEN 0.6 WHEN 'photographed_after_window' THEN 0.4
           WHEN 'work_day_photographed' THEN 0.7 WHEN 'work_day_unphotographed' THEN 0.6
           WHEN 'receipt_day_photographed' THEN 0.6 WHEN 'receipt_day_unphotographed' THEN 0.6
           WHEN 'no_zone_photo_after_purchase' THEN 0.6 WHEN 'part_zone_unknown' THEN 0.5
           WHEN 'not_work_evidence' THEN 0.9 ELSE 0.5 END
           -- a link made from same-day photos (chronology_session) is not independent of a same-day-photo conclusion
           * CASE WHEN s.basis = 'chronology_session' AND s.concl IN ('receipt_day_photographed', 'work_day_photographed') THEN 0.5 ELSE 1 END)), 3),
         CASE WHEN s.first_day IS NOT NULL THEN s.first_day - s.anchor END,
         s.total, s.in_window, s.first_day, coalesce(s.cite_ids, '{}'), s.day_n,
         coalesce((SELECT array_agg(w.id ORDER BY w.session_date) FROM work_sessions w WHERE w.vehicle_id = p_vehicle_id
                    AND w.session_date BETWEEN coalesce(CASE WHEN s.kind IN ('labor','receipt') THEN s.anchor - 1 ELSE s.first_day END, '-infinity'::date)
                                           AND coalesce(CASE WHEN s.kind IN ('labor','receipt') THEN s.anchor + 1 ELSE s.first_day END, '-infinity'::date)), '{}'),
         coalesce((SELECT array_agg(t.id ORDER BY t.event_date) FROM timeline_events t WHERE t.vehicle_id = p_vehicle_id
                    AND t.event_date BETWEEN coalesce(CASE WHEN s.kind IN ('labor','receipt') THEN s.anchor - 1 ELSE s.first_day END, '-infinity'::date)
                                         AND coalesce(CASE WHEN s.kind IN ('labor','receipt') THEN s.anchor + 1 ELSE s.first_day END, '-infinity'::date)), '{}'),
         s.concl IN ('install_window_photographed', 'photographed_after_window'),
         'receipt_work_lines/20261111210000',
         'proposed', s.source_document_table, s.source_document_id,
         NULL::int,  -- page: receipts carry no page reference yet; stays null until a page table is the source
         s.refused
    FROM shaped s
$$;
COMMENT ON FUNCTION public.receipt_work_lines(uuid, int, int) IS
  'Receipt-to-work correlation for one vehicle: each linked receipt line (or a line-less receipt) against gate-approved, non-sensitive, non-duplicate photos by EXIF day and zone, plus work_sessions and timeline_events on the cited day. A photographed zone after purchase is a candidate for a visual judgment, never a proof of installation (judgment_needed).';
REVOKE ALL ON FUNCTION public.receipt_work_lines(uuid, int, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.receipt_work_lines(uuid, int, int) TO service_role;

-- ─── the judgment queue ───────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.evidence_judgment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department text NOT NULL,
  question_kind text NOT NULL,
  subject_table text NOT NULL,
  subject_id uuid NOT NULL,
  vehicle_id uuid REFERENCES public.vehicles(id),
  user_id uuid,
  params jsonb NOT NULL,
  answer_schema jsonb NOT NULL,
  priority int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'claimed', 'answered', 'cancelled')),
  trigger_evidence_dedupe_key text,
  producer_agent text NOT NULL,
  producer_script text NOT NULL,
  producer_version text NOT NULL,
  run_id uuid NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz, claimed_by text,
  answered_at timestamptz, answer jsonb, answer_agent text, answer_model text, answer_version text,
  cancelled_at timestamptz, cancelled_reason text
);
-- A producer re-run that no longer asks a question (the subject's evidence changed) cancels the stale pending request and
-- signs the cancellation with its run, so rolling that run back re-opens the request.
ALTER TABLE public.evidence_judgment_requests ADD COLUMN IF NOT EXISTS cancelled_by_run_id uuid;
CREATE INDEX IF NOT EXISTS evidence_judgment_requests_cancelled_by_run ON public.evidence_judgment_requests (cancelled_by_run_id) WHERE cancelled_by_run_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS evidence_judgment_requests_pending ON public.evidence_judgment_requests (department, question_kind, priority DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS evidence_judgment_requests_run ON public.evidence_judgment_requests (run_id);
CREATE INDEX IF NOT EXISTS evidence_judgment_requests_vehicle ON public.evidence_judgment_requests (vehicle_id) WHERE status <> 'cancelled';
COMMENT ON TABLE public.evidence_judgment_requests IS
  'Parameterized judgments a department''s code trigger needs from an agent or model: department, question_kind, subject (table + id), params (the cited ids and facts), answer_schema (the only shape an answer may take). Raised by producers (e.g. scripts/receipt-work/reconcile-receipt-work.mjs), signed with producer_agent/script/version and run_id; idempotent on dedupe_key. Answers land in answer/answer_agent/answer_model/answer_version. Undo a run with rollback_evidence_judgment_run.';
ALTER TABLE public.evidence_judgment_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS evidence_judgment_requests_service ON public.evidence_judgment_requests;
CREATE POLICY evidence_judgment_requests_service ON public.evidence_judgment_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
REVOKE ALL ON public.evidence_judgment_requests FROM anon, authenticated;
GRANT ALL ON public.evidence_judgment_requests TO service_role;

CREATE OR REPLACE FUNCTION public.rollback_evidence_judgment_run(p_run_id uuid, p_reason text, p_dry_run boolean DEFAULT true)
RETURNS TABLE(id uuid, question_kind text, subject_id uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  IF p_run_id IS NULL OR nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'run id and reason required' USING ERRCODE = '22023';
  END IF;
  IF p_dry_run IS NOT TRUE THEN
    RETURN QUERY
    WITH u AS (
      UPDATE evidence_judgment_requests j SET status = 'cancelled', cancelled_at = now(), cancelled_reason = 'rollback run ' || p_run_id || ': ' || p_reason
       WHERE j.run_id = p_run_id AND j.status IN ('pending', 'claimed')
      RETURNING j.id, j.question_kind, j.subject_id, j.status),
    r AS (
      UPDATE evidence_judgment_requests j SET status = 'pending', cancelled_at = NULL, cancelled_reason = NULL, cancelled_by_run_id = NULL
       WHERE j.cancelled_by_run_id = p_run_id AND j.status = 'cancelled'
      RETURNING j.id, j.question_kind, j.subject_id, j.status)
    SELECT u.id, u.question_kind, u.subject_id, u.status FROM u
    UNION ALL SELECT r.id, r.question_kind, r.subject_id, r.status FROM r;
  ELSE
    RETURN QUERY SELECT j.id, j.question_kind, j.subject_id, j.status FROM evidence_judgment_requests j
     WHERE (j.run_id = p_run_id AND j.status IN ('pending', 'claimed'))
        OR (j.cancelled_by_run_id = p_run_id AND j.status = 'cancelled');
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION public.rollback_evidence_judgment_run(uuid, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_evidence_judgment_run(uuid, text, boolean) TO service_role;

-- ─── answering a judgment ─────────────────────────────────────────────────────────────────────────────────────
-- A worker claims pending requests (a claim older than p_stale_minutes is re-claimable), then answers one it holds. An
-- answer is the answering agent/model's reading of a proposed context, never an owner Sign or proof; it must fit the
-- request's question: for receipt_part_visible, visible/installed in yes|no|cannot_tell, confidence 0..1, image_id one of
-- the request's candidate_image_ids (required when visible = yes), bbox [x1,y1,x2,y2] in 0..999 with x1<x2, y1<y2.
-- A malformed answer is refused, not coerced.
CREATE OR REPLACE FUNCTION public.claim_evidence_judgments(p_department text, p_question_kind text, p_limit int, p_claimed_by text,
                                                           p_stale_minutes int DEFAULT 30)
RETURNS SETOF public.evidence_judgment_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  IF nullif(btrim(coalesce(p_claimed_by, '')), '') IS NULL OR coalesce(p_limit, 0) < 1 THEN
    RAISE EXCEPTION 'claimed_by and a positive limit required' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  UPDATE evidence_judgment_requests j SET status = 'claimed', claimed_at = now(), claimed_by = p_claimed_by
   WHERE j.id IN (SELECT q.id FROM evidence_judgment_requests q
                   WHERE q.department = p_department AND q.question_kind = p_question_kind
                     AND (q.status = 'pending' OR (q.status = 'claimed' AND q.claimed_at < now() - make_interval(mins => p_stale_minutes)))
                   ORDER BY q.priority DESC, q.created_at, q.id
                   LIMIT least(p_limit, 500) FOR UPDATE SKIP LOCKED)
  RETURNING j.*;
END
$fn$;
REVOKE ALL ON FUNCTION public.claim_evidence_judgments(text, text, int, text, int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_evidence_judgments(text, text, int, text, int) TO service_role;

CREATE OR REPLACE FUNCTION public.evidence_judgment_answer_problems(p_question_kind text, p_params jsonb, p_answer jsonb)
RETURNS text[]
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog, public
AS $fn$
DECLARE probs text[] := '{}'; b jsonb; c numeric;
BEGIN
  IF p_question_kind <> 'receipt_part_visible' THEN RETURN ARRAY['unknown question_kind ' || coalesce(p_question_kind, 'null')]; END IF;
  IF jsonb_typeof(p_answer) IS DISTINCT FROM 'object' THEN RETURN ARRAY['answer must be an object']; END IF;
  IF NOT coalesce(p_answer ->> 'visible' IN ('yes', 'no', 'cannot_tell'), false) THEN probs := array_append(probs, 'visible must be yes|no|cannot_tell'); END IF;
  IF NOT coalesce(p_answer ->> 'installed' IN ('yes', 'no', 'cannot_tell'), false) THEN probs := array_append(probs, 'installed must be yes|no|cannot_tell'); END IF;
  IF jsonb_typeof(p_answer -> 'confidence') IS DISTINCT FROM 'number' THEN probs := array_append(probs, 'confidence must be a number');
  ELSE c := (p_answer ->> 'confidence')::numeric; IF c < 0 OR c > 1 THEN probs := array_append(probs, 'confidence must be within 0..1'); END IF;
  END IF;
  IF coalesce(jsonb_typeof(p_answer -> 'image_id'), 'null') <> 'null' THEN
    IF jsonb_typeof(p_answer -> 'image_id') <> 'string' OR NOT coalesce(p_params -> 'candidate_image_ids', '[]'::jsonb) ? (p_answer ->> 'image_id') THEN
      probs := array_append(probs, 'image_id must be one of candidate_image_ids');
    END IF;
  ELSIF p_answer ->> 'visible' = 'yes' THEN probs := array_append(probs, 'visible = yes needs image_id');
  END IF;
  b := p_answer -> 'bbox';
  IF coalesce(jsonb_typeof(b), 'null') <> 'null' THEN
    IF jsonb_typeof(b) <> 'array' OR jsonb_array_length(b) <> 4
       OR EXISTS (SELECT 1 FROM jsonb_array_elements(b) e WHERE jsonb_typeof(e) <> 'number' OR (e #>> '{}')::numeric NOT BETWEEN 0 AND 999)
       OR (b ->> 0)::numeric >= (b ->> 2)::numeric OR (b ->> 1)::numeric >= (b ->> 3)::numeric THEN
      probs := array_append(probs, 'bbox must be [x1,y1,x2,y2] within 0..999, x1<x2, y1<y2');
    ELSIF coalesce(jsonb_typeof(p_answer -> 'image_id'), 'null') = 'null' THEN probs := array_append(probs, 'bbox needs image_id');
    END IF;
  END IF;
  IF coalesce(jsonb_typeof(p_answer -> 'quote'), 'null') NOT IN ('null', 'string') THEN probs := array_append(probs, 'quote must be text'); END IF;
  RETURN probs;
END
$fn$;

CREATE OR REPLACE FUNCTION public.answer_evidence_judgment(p_id uuid, p_claimed_by text, p_answer jsonb,
                                                           p_answer_agent text, p_answer_model text, p_answer_version text)
RETURNS public.evidence_judgment_requests
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE j evidence_judgment_requests; probs text[];
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  IF nullif(btrim(coalesce(p_answer_agent, '')), '') IS NULL OR nullif(btrim(coalesce(p_answer_model, '')), '') IS NULL
     OR nullif(btrim(coalesce(p_answer_version, '')), '') IS NULL THEN
    RAISE EXCEPTION 'answer_agent, answer_model and answer_version required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO j FROM evidence_judgment_requests WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'no judgment request %', p_id USING ERRCODE = 'P0002'; END IF;
  IF j.status <> 'claimed' OR j.claimed_by IS DISTINCT FROM p_claimed_by THEN
    RAISE EXCEPTION 'request % is % (claimed by %), not claimed by %', p_id, j.status, j.claimed_by, p_claimed_by USING ERRCODE = '55000';
  END IF;
  probs := evidence_judgment_answer_problems(j.question_kind, j.params, p_answer);
  IF cardinality(probs) > 0 THEN RAISE EXCEPTION 'answer refused: %', array_to_string(probs, '; ') USING ERRCODE = '22023'; END IF;
  UPDATE evidence_judgment_requests SET status = 'answered', answered_at = now(), answer = p_answer,
         answer_agent = p_answer_agent, answer_model = p_answer_model, answer_version = p_answer_version
   WHERE id = p_id RETURNING * INTO j;
  RETURN j;
END
$fn$;
REVOKE ALL ON FUNCTION public.answer_evidence_judgment(uuid, text, jsonb, text, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.answer_evidence_judgment(uuid, text, jsonb, text, text, text) TO service_role;

-- Undo answers from one answering version: they go back to pending and each reopened answer (with its agent, model,
-- version, time and the reopen reason) is appended to answer_history, so nothing an answerer wrote is lost.
ALTER TABLE public.evidence_judgment_requests ADD COLUMN IF NOT EXISTS answer_history jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE OR REPLACE FUNCTION public.reopen_evidence_judgment_answers(p_answer_version text, p_reason text, p_dry_run boolean DEFAULT true)
RETURNS TABLE(id uuid, question_kind text, subject_id uuid, answer jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
#variable_conflict use_column
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN RAISE EXCEPTION 'service role required' USING ERRCODE = '42501'; END IF;
  IF nullif(btrim(coalesce(p_answer_version, '')), '') IS NULL OR nullif(btrim(coalesce(p_reason, '')), '') IS NULL THEN
    RAISE EXCEPTION 'answer version and reason required' USING ERRCODE = '22023';
  END IF;
  IF p_dry_run IS NOT TRUE THEN
    RETURN QUERY
    WITH prior AS (SELECT j.id, j.answer FROM evidence_judgment_requests j WHERE j.answer_version = p_answer_version AND j.status = 'answered' FOR UPDATE),
    u AS (
      UPDATE evidence_judgment_requests j SET status = 'pending', claimed_at = NULL, claimed_by = NULL, answered_at = NULL, answer = NULL,
             answer_agent = NULL, answer_model = NULL, answer_version = NULL,
             answer_history = j.answer_history || jsonb_build_array(jsonb_build_object('answer', j.answer, 'answer_agent', j.answer_agent,
               'answer_model', j.answer_model, 'answer_version', j.answer_version, 'answered_at', j.answered_at, 'claimed_by', j.claimed_by,
               'reopened_at', now(), 'reopen_reason', p_reason))
        FROM prior p WHERE j.id = p.id
      RETURNING j.id, j.question_kind, j.subject_id, p.answer)
    SELECT u.id, u.question_kind, u.subject_id, u.answer FROM u;
  ELSE
    RETURN QUERY SELECT j.id, j.question_kind, j.subject_id, j.answer FROM evidence_judgment_requests j
     WHERE j.answer_version = p_answer_version AND j.status = 'answered';
  END IF;
END
$fn$;
REVOKE ALL ON FUNCTION public.reopen_evidence_judgment_answers(text, text, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_evidence_judgment_answers(text, text, boolean) TO service_role;
