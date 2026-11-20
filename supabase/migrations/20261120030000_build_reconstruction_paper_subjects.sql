-- Build reconstruction, slice 4: what a shop document printed as its subject.
--
-- Why: the proof vehicle's machine-shop work orders print the engine they were written for ("1970 ... Pontiac Block, Heads,
-- Crank; Engine: 455"). That line is the paper's own identification of the engine and is the proof behind a correction to a
-- public listing, but no public reader returned it, so an outside reader could not find it.
--
-- What this changes (revert: re-apply 20261119230000_build_reconstruction_stages.sql):
--   vehicle_build_reconstruction(uuid)  each system's paper gains subjects: the distinct subject line printed on the documents
--                                       that carry that system's shop work lines (receipts.raw_json data_v2.vehicle_hint),
--                                       contact text redacted, 200 characters at most. Parts-only documents are not read.
-- Contract: supabase/sql/test_vehicle_build_reconstruction.sql.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

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
  rd AS (
    -- the current reviewed reading of each photo a visitor may see: its build phase, and whether the photo is of a print
    SELECT DISTINCT ON (i.id) i.id AS image_id, i.image_url, i.taken_at, o.structured_data ->> 'build_phase_guess' AS phase,
           public.photo_reading_is_print(o.structured_data) AS is_print
      FROM v JOIN public.vehicle_observations o ON o.vehicle_id = v.id
      JOIN public.vehicle_images i ON i.id = (o.structured_data ->> 'image_id')::uuid AND i.vehicle_id = v.id
     WHERE o.extraction_method = 'reviewed_image_analysis_v1' AND o.is_superseded IS NOT TRUE
       AND o.structured_data ->> 'image_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND public.vehicle_image_gallery_eligible(i) AND coalesce(i.is_sensitive, false) = false
       AND coalesce(i.is_duplicate, false) = false AND coalesce(i.is_superseded, false) = false
     ORDER BY i.id, o.id),
  st AS (
    -- build stages a photograph shows. A print's capture day is the day the sheet was photographed, so it carries no day.
    SELECT public.build_phase_system(rd.phase) AS system_key, rd.phase, count(*) AS images, count(*) FILTER (WHERE rd.is_print) AS prints,
           min(rd.taken_at) FILTER (WHERE NOT rd.is_print)::date AS first_day, max(rd.taken_at) FILTER (WHERE NOT rd.is_print)::date AS last_day,
           (SELECT jsonb_agg(jsonb_build_object('image_id', t.image_id, 'image_url', t.image_url) ORDER BY t.taken_at, t.image_id)
              FROM (SELECT x.image_id, x.image_url, x.taken_at FROM rd x WHERE x.phase = rd.phase ORDER BY x.taken_at, x.image_id LIMIT 6) t) AS sample,
           (SELECT jsonb_build_object('description', m.description, 'hours_typical', m.estimated_hours_typical, 'hours_min', m.estimated_hours_min,
                     'hours_max', m.estimated_hours_max, 'confidence', m.confidence, 'source', 'stage_transition_labor_map',
                     'transition', m.from_stage || ' > ' || m.to_stage)
              FROM public.stage_transition_labor_map m
             WHERE m.zone_pattern = '*' AND m.from_stage || '>' || m.to_stage = CASE rd.phase WHEN 'teardown' THEN 'raw>disassembled'
                     WHEN 'paint_prep' THEN 'primed>blocked' WHEN 'paint_application' THEN 'blocked>basecoated' END
             ORDER BY m.id LIMIT 1) AS reference
      FROM rd WHERE public.build_phase_system(rd.phase) IS NOT NULL GROUP BY rd.phase),
  pc AS (
    -- photo readings already keyed to a part (photo_map_harvest_v1), on photos a visitor may see
    SELECT public.photo_part_key_system(o.structured_data ->> 'part_key') AS system_key, i.id AS image_id, i.image_url,
           CASE WHEN EXISTS (SELECT 1 FROM rd WHERE rd.image_id = i.id AND rd.is_print) THEN NULL ELSE i.taken_at END AS taken_at, o.id AS observation_id
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
    'rule', 'Each current receipt line is read into a car system by its words. Paper hours are the hours printed on shop documents. Reference hours come from labor_operations, each operation once per vehicle. The two are separate lenses and are never added. A build stage seen in a photograph carries the stored hour range for that stage (stage_transition_labor_map) as a third, separate measure; a photograph of a print carries no day. A part with no stored fitting operation is counted as a gap.',
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
        'stage_images', (SELECT sum(images) FROM st),
        'stage_hours', (SELECT jsonb_build_object('typical', sum((reference ->> 'hours_typical')::numeric), 'min', sum((reference ->> 'hours_min')::numeric),
                          'max', sum((reference ->> 'hours_max')::numeric), 'stages', count(*)) FROM st WHERE reference IS NOT NULL),
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
        'stages', (SELECT jsonb_agg(jsonb_build_object('phase', t.phase, 'images', t.images, 'prints', t.prints, 'first_day', t.first_day,
                     'last_day', t.last_day, 'sample', t.sample, 'reference', t.reference) ORDER BY t.phase)
                     FROM st t WHERE t.system_key = k.system_key),
        'part_lines', coalesce(s.part_lines, 0), 'backordered_lines', coalesce(s.backordered_lines, 0), 'suppliers', coalesce(s.suppliers, '[]'::jsonb),
        'paper', jsonb_build_object('lines', coalesce(s.paper_work_lines, 0), 'lines_without_hours', coalesce(s.paper_work_lines_without_hours, 0),
                                    'hours', s.paper_hours, 'performers', coalesce(s.performers, 0), 'shops', coalesce(s.shops, '[]'::jsonb),
                                    'subjects', (SELECT coalesce(jsonb_agg(DISTINCT t.subject), '[]'::jsonb) FROM (
                                        SELECT nullif(left(btrim(public.text_redact_contact(r.raw_json #>> '{data_v2,vehicle_hint}')), 200), '') AS subject
                                          FROM public.receipts r
                                         WHERE r.id IN (SELECT x.receipt_id FROM l x WHERE x.system_key = k.system_key AND x.line_kind IN ('labor', 'note', 'service'))) t
                                         WHERE t.subject IS NOT NULL)),
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
                 coalesce(s.part_lines, 0) DESC, coalesce(p.images, 0) DESC, k.system_key), '[]'::jsonb) FROM (SELECT system_key FROM sys UNION SELECT system_key FROM ph UNION SELECT system_key FROM st) k
        LEFT JOIN sys s USING (system_key) LEFT JOIN ph p USING (system_key))) END
$$;
COMMENT ON FUNCTION public.vehicle_build_reconstruction(uuid) IS
  'The build per car system, computed from the vehicle''s current receipt lines (receipt_work_lines), its part-keyed photo readings and the build stages its reviewed photo readings name: date span, part lines, printed shop hours (paper), reference hours from labor_operations (each operation once per vehicle), stage hour ranges from stage_transition_labor_map, gaps, the lines, and the photographs. Paper, reference and stage hours are separate measures, never added. Recorded amounts only for the owner, a granted user or service role. Null when the caller may not see the vehicle. Read-only.';

