-- Build reconstruction, slice 2: the analysed photos join the same systems as the paper.
--
-- Why: the proof vehicle's finished-car shoot (391 photos, all analysed) carries no vehicle_zone, so the receipt-to-photo
-- correlation matches none of it. The photo readings are already keyed to a part (photo_map_harvest_v1 part_key text).
-- Reading that key into the car system puts each system's photographs beside its receipts and shop hours.
--
-- What this changes (revert: re-apply 20261119200000_vehicle_build_reconstruction.sql, then drop photo_part_key_system):
--   photo_part_key_system(text)         the car system a photo reading's part key names, or null
--   vehicle_build_reconstruction(uuid)  each system gains photos {images, readings, first_day, last_day, sample}; a system
--                                       seen only in photos (no paper) now has a row. Only gallery-eligible, non-sensitive,
--                                       current photos. Paper and reference figures are unchanged.
-- Contract: supabase/sql/test_vehicle_build_reconstruction.sql.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.photo_part_key_system(p_key text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN k ~ '^(undercarriage|engine)\.steering' THEN 'steering'
    WHEN k ~ '^(undercarriage|engine)\.brake' THEN 'brakes'
    WHEN k ~ '^undercarriage\.suspension' THEN 'suspension'
    WHEN k ~ '^(undercarriage\.fuel|engine\.(carburetor|fuel))' THEN 'fuel'
    WHEN k ~ '^(undercarriage\.exhaust|engine\.exhaust)' THEN 'exhaust'
    WHEN k ~ '^undercarriage\.(differential|axle)' THEN 'axle'
    WHEN k ~ '^(undercarriage\.(driveshaft|transmission)|interior\.shifter|engine\.(transmission|clutch|bellhousing))' THEN 'transmission'
    WHEN k ~ '^engine\.cooling' THEN 'cooling'
    WHEN k ~ '^(electrical|light)(\.|$)' OR k ~ '^engine\.(alternator|ignition|battery|starter|wiring)' THEN 'electrical'
    WHEN k ~ '^engine(\.|$)' THEN 'engine'
    WHEN k ~ '^(trim|badge)(\.|$)' THEN 'trim'
    WHEN k ~ '^glass(\.|$)' THEN 'glass'
    WHEN k ~ '^interior(\.|$)' THEN 'interior'
    WHEN k ~ '^wheel(\.|$)' THEN 'tires'
    WHEN k ~ '^(exterior|door)(\.|$)' THEN 'body'
  END
  FROM (SELECT lower(coalesce(p_key, '')) AS k) s
$$;
COMMENT ON FUNCTION public.photo_part_key_system(text) IS
  'The car system a photo reading''s part key names (photo_map_harvest_v1 part_key text), in the same system keys as receipt_line_system. Null for keys that name no single system (bare undercarriage, frame, documents). Exterior and door keys read as body; a photo of a panel does not separate paint from metalwork.';

CREATE OR REPLACE FUNCTION public.vehicle_build_reconstruction(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH v AS (
    SELECT v.id, v.year,
           (auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND (v.user_id = auth.uid() OR v.owner_id = auth.uid()
             OR v.uploaded_by = auth.uid() OR public.vehicle_user_has_access(v.id, auth.uid())))) IS TRUE AS tied
      FROM public.vehicles v
     WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
       AND (v.is_public IS TRUE OR auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND (v.user_id = auth.uid()
            OR v.owner_id = auth.uid() OR v.uploaded_by = auth.uid() OR public.vehicle_user_has_access(v.id, auth.uid()))))),
  l AS (
    SELECT k.item_id, k.receipt_id, k.line_kind, k.anchor_date, k.vendor_name, k.description, k.part_number,
           k.total_price, k.printed_hours, k.printed_performer,
           coalesce(public.receipt_line_system(k.description), 'unplaced') AS system_key,
           CASE WHEN k.line_kind IN ('part', 'note', 'kit_component') THEN
             -- only an operation that is stored and applies to this model year; anything else is a gap
             (SELECT o.code FROM public.labor_operations o, v
               WHERE o.code = public.receipt_line_labor_operation(k.description)
                 AND (o.model_year_min IS NULL OR v.year IS NULL OR v.year >= o.model_year_min)
                 AND (o.model_year_max IS NULL OR v.year IS NULL OR v.year <= o.model_year_max)) END AS op_code
      FROM (SELECT w.item_id, w.receipt_id, w.anchor_date, w.vendor_name, w.description, w.part_number,
                   w.total_price, w.printed_hours, w.printed_performer,
                   -- a priced line with no part number whose words are work, not a product: shop work billed without hours
                   CASE WHEN w.line_kind = 'part' AND w.part_number IS NULL AND lower(w.description) ~
                          '\y(check and repair|repair|rebuild|install(ation)?|alignment|labor|surface heads?|polish crank|valve job|hang pistons?|block package|machine work|mount and balance)\y'
                        THEN 'service' ELSE w.line_kind END AS line_kind
              FROM v CROSS JOIN LATERAL public.receipt_work_lines(v.id) w
             WHERE w.line_kind IN ('part', 'labor', 'note', 'backordered', 'kit_component')) k),
  ops AS (
    -- each stored operation once per vehicle, however many receipt lines point at it
    -- (an operation whose parts fall in two systems sits in the one holding more of them)
    SELECT system_key, code, name, base_hours, part_lines FROM (
      SELECT DISTINCT ON (g.code) g.system_key, g.code, g.name, g.base_hours, sum(g.n) OVER (PARTITION BY g.code) AS part_lines
        FROM (SELECT l.system_key, o.code, o.name, o.base_hours, count(*) AS n
                FROM l JOIN public.labor_operations o ON o.code = l.op_code
                CROSS JOIN v
               WHERE (o.model_year_min IS NULL OR v.year IS NULL OR v.year >= o.model_year_min)
                 AND (o.model_year_max IS NULL OR v.year IS NULL OR v.year <= o.model_year_max)
               GROUP BY l.system_key, o.code, o.name, o.base_hours) g
       ORDER BY g.code, g.n DESC, g.system_key) d
    UNION ALL
    -- machine-shop work on the engine means the engine came out and went back in: one stored operation, named as implied
    SELECT 'engine', o.code, o.name, o.base_hours, 0
      FROM public.labor_operations o CROSS JOIN v
     WHERE o.code = 'MECH-ENGINE-RR' AND EXISTS (SELECT 1 FROM l WHERE l.system_key = 'machining' AND l.line_kind IN ('labor', 'service'))
       AND (o.model_year_min IS NULL OR v.year IS NULL OR v.year >= o.model_year_min)
       AND (o.model_year_max IS NULL OR v.year IS NULL OR v.year <= o.model_year_max)),
  pc AS (
    -- photo readings already keyed to a part (photo_map_harvest_v1), on photos a visitor may see
    SELECT public.photo_part_key_system(o.structured_data ->> 'part_key') AS system_key, i.id AS image_id, i.image_url,
           i.taken_at, o.id AS observation_id
      FROM v JOIN public.vehicle_observations o ON o.vehicle_id = v.id
      JOIN public.vehicle_images i ON i.id = (o.structured_data ->> 'image_id')::uuid AND i.vehicle_id = v.id
     WHERE o.extraction_method = 'photo_map_harvest_v1' AND o.is_superseded IS NOT TRUE
       AND o.structured_data ->> 'image_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND public.photo_part_key_system(o.structured_data ->> 'part_key') IS NOT NULL
       AND public.vehicle_image_gallery_eligible(i) AND coalesce(i.is_sensitive, false) = false
       AND coalesce(i.is_duplicate, false) = false AND coalesce(i.is_superseded, false) = false),
  ph AS (
    SELECT pc.system_key, count(DISTINCT pc.image_id) AS images, count(DISTINCT pc.observation_id) AS readings,
           min(pc.taken_at)::date AS first_day, max(pc.taken_at)::date AS last_day,
           (SELECT jsonb_agg(jsonb_build_object('image_id', t.image_id, 'image_url', t.image_url) ORDER BY t.n DESC, t.image_id)
              FROM (SELECT x.image_id, x.image_url, count(*) AS n FROM pc x WHERE x.system_key = pc.system_key
                     GROUP BY x.image_id, x.image_url ORDER BY count(*) DESC, x.image_id LIMIT 6) t) AS sample
      FROM pc GROUP BY pc.system_key),
  sys AS (
    SELECT l.system_key,
           min(l.anchor_date) AS first_day, max(l.anchor_date) AS last_day,
           count(*) FILTER (WHERE l.line_kind = 'part') AS part_lines,
           count(*) FILTER (WHERE l.line_kind = 'backordered') AS backordered_lines,
           count(*) FILTER (WHERE l.line_kind IN ('labor', 'note', 'service')) AS paper_work_lines,
           count(*) FILTER (WHERE l.line_kind IN ('labor', 'note', 'service') AND l.printed_hours IS NULL) AS paper_work_lines_without_hours,
           sum(l.printed_hours) AS paper_hours,
           count(DISTINCT l.printed_performer) FILTER (WHERE nullif(btrim(l.printed_performer), '') IS NOT NULL) AS performers,
           count(*) FILTER (WHERE l.line_kind = 'part' AND l.op_code IS NULL) AS parts_without_reference,
           count(*) FILTER (WHERE l.total_price IS NOT NULL) AS priced_lines,
           sum(l.total_price) AS recorded_amount,
           (SELECT coalesce(jsonb_agg(DISTINCT nullif(left(btrim(public.text_redact_contact(x.vendor_name)), 300), '')), '[]'::jsonb)
              FROM l x WHERE x.system_key = l.system_key AND x.line_kind IN ('labor', 'note', 'service')) AS shops,
           (SELECT coalesce(jsonb_agg(DISTINCT nullif(left(btrim(public.text_redact_contact(x.vendor_name)), 300), '')), '[]'::jsonb)
              FROM l x WHERE x.system_key = l.system_key AND x.line_kind = 'part') AS suppliers
      FROM l GROUP BY l.system_key)
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v) THEN NULL ELSE jsonb_build_object(
    'function', 'vehicle_build_reconstruction', 'version', 1, 'vehicle_id', p_vehicle_id, 'as_of', statement_timestamp(),
    'amounts_visible', (SELECT tied FROM v),
    'rule', 'Each current receipt line is read into a car system by its words. Paper hours are the hours printed on shop documents. Reference hours come from labor_operations, each operation once per vehicle. The two are separate lenses and are never added. A part with no stored fitting operation is counted as a gap.',
    'totals', (SELECT jsonb_build_object(
        'lines', (SELECT count(*) FROM l),
        'placed_lines', (SELECT count(*) FROM l WHERE system_key <> 'unplaced'),
        'receipts', (SELECT count(DISTINCT receipt_id) FROM l),
        'first_day', (SELECT min(anchor_date) FROM l), 'last_day', (SELECT max(anchor_date) FROM l),
        'part_lines', (SELECT count(*) FROM l WHERE line_kind = 'part'),
        'paper_work_lines', (SELECT count(*) FROM l WHERE line_kind IN ('labor', 'note', 'service')),
        'paper_hours', (SELECT sum(printed_hours) FROM l),
        'reference_hours', (SELECT sum(base_hours) FROM ops),
        'photo_images', (SELECT count(DISTINCT image_id) FROM pc),
        'reference_operations', (SELECT count(*) FROM ops),
        'parts_without_reference', (SELECT count(*) FROM l WHERE line_kind = 'part' AND op_code IS NULL),
        'recorded_amount', CASE WHEN (SELECT tied FROM v) THEN (SELECT sum(total_price) FROM l) END)),
    'systems_without_paper', (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb)
        FROM unnest(ARRAY['engine','machining','fuel','cooling','exhaust','electrical','brakes','steering','suspension','axle',
                          'transmission','body','paint','glass','interior','trim','tires']) k
       WHERE NOT EXISTS (SELECT 1 FROM sys s WHERE s.system_key = k)),
    'systems', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'system_key', k.system_key, 'first_day', s.first_day, 'last_day', s.last_day,
        'photos', CASE WHEN p.system_key IS NOT NULL THEN jsonb_build_object('images', p.images, 'readings', p.readings,
                    'first_day', p.first_day, 'last_day', p.last_day, 'sample', p.sample) END,
        'part_lines', coalesce(s.part_lines, 0), 'backordered_lines', coalesce(s.backordered_lines, 0), 'suppliers', coalesce(s.suppliers, '[]'::jsonb),
        'paper', jsonb_build_object('lines', coalesce(s.paper_work_lines, 0), 'lines_without_hours', coalesce(s.paper_work_lines_without_hours, 0),
                                    'hours', s.paper_hours, 'performers', coalesce(s.performers, 0), 'shops', coalesce(s.shops, '[]'::jsonb)),
        'reference', jsonb_build_object(
            'hours', (SELECT sum(o.base_hours) FROM ops o WHERE o.system_key = k.system_key),
            'operations', (SELECT coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'name', o.name, 'hours', o.base_hours,
                             'part_lines', o.part_lines, 'source', 'labor_operations',
                             'basis', CASE WHEN o.part_lines = 0 THEN 'implied_by_machine_shop_work' ELSE 'part_on_receipt' END) ORDER BY o.base_hours DESC, o.code), '[]'::jsonb)
                             FROM ops o WHERE o.system_key = k.system_key),
            'parts_without_reference', coalesce(s.parts_without_reference, 0)),
        'priced_lines', coalesce(s.priced_lines, 0),
        'recorded_amount', CASE WHEN (SELECT tied FROM v) THEN s.recorded_amount END,
        'lines', (SELECT jsonb_agg(jsonb_build_object(
                    'item_id', x.item_id, 'receipt_id', x.receipt_id, 'kind', x.line_kind, 'day', x.anchor_date,
                    'source', nullif(left(btrim(public.text_redact_contact(x.vendor_name)), 300), ''),
                    'description', nullif(left(btrim(public.text_redact_contact(x.description)), 500), ''),
                    'part_number', x.part_number, 'paper_hours', x.printed_hours, 'operation_code', x.op_code,
                    'amount', CASE WHEN (SELECT tied FROM v) THEN x.total_price END)
                    ORDER BY x.anchor_date NULLS LAST, x.item_id)
                    FROM l x WHERE x.system_key = k.system_key))
        ORDER BY coalesce(s.paper_hours, 0) + coalesce((SELECT sum(o.base_hours) FROM ops o WHERE o.system_key = k.system_key), 0) DESC,
                 coalesce(s.part_lines, 0) DESC, coalesce(p.images, 0) DESC, k.system_key), '[]'::jsonb) FROM (SELECT system_key FROM sys UNION SELECT system_key FROM ph) k
        LEFT JOIN sys s USING (system_key) LEFT JOIN ph p USING (system_key))) END
$$;
COMMENT ON FUNCTION public.vehicle_build_reconstruction(uuid) IS
  'The build per car system, computed from the vehicle''s current receipt lines (receipt_work_lines) and its part-keyed photo readings: date span, part lines, printed shop hours (paper), reference hours from labor_operations (each operation once per vehicle), gaps, the lines, and the photographs that show the system. Paper and reference hours are separate lenses, never added. Recorded amounts only for the owner, a granted user or service role. Null when the caller may not see the vehicle. Read-only.';

GRANT EXECUTE ON FUNCTION public.photo_part_key_system(text) TO anon, authenticated, service_role;
