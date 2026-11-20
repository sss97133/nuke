-- Build reconstruction, slice 1: the build per car system, computed from the landed receipt lines.
--
-- Why: the profile's cost ledger folds hand-written cost documents (visual_work_v1 "cost basis" records; 29 of 33 fail
-- visual_work_gate_report on the proof vehicle). Nothing computed the build from the receipts themselves, and no receipt
-- line carried a car system (receipt_items.category is null on every line; receipt_line_photo_zone leaves half the
-- part lines without a zone because it answers "which photo would show this", not "which system is this").
--
-- What this adds (additive; revert: supabase/sql/revert_20261119200000_vehicle_build_reconstruction.sql):
--   receipt_line_system(text)           the car system a receipt line's words name (first match wins), or null
--   receipt_line_labor_operation(text)  the labor_operations.code a part's fitting corresponds to, or null. Only codes
--                                       that exist; a part with no fitting reference is a counted gap, never a default.
--   vehicle_build_reconstruction(uuid)  per system: date span, part lines, printed (paper) labor lines and hours,
--                                       reference hours from labor_operations (each operation once per vehicle), the
--                                       lines themselves and the gaps. Paper hours and reference hours are separate
--                                       lenses and are never added. Recorded amounts only for a tied viewer.
-- Reads receipt_work_lines (current links, kinds, anchor dates). Writes nothing.
-- Contract: supabase/sql/test_vehicle_build_reconstruction.sql.

SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.receipt_line_system(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN t ~ '\y(shop towels?|shop supplies|colormaxx|key ?chain|gloves|rags?|masking tape|sandpaper)\y' THEN 'supplies'
    WHEN t ~ '(brakefld|brake fluid)' THEN 'brakes'
    WHEN t ~ '(antifrez|antifreeze|stoplk|htr core|heater core)' THEN 'cooling'
    WHEN t ~ '\y(surface heads?|surfacing heads|resurfacing|surface block|hang pistons?|polish crank|valve job|valve grinding|springs and valve|block package|magnaflux|mag block|hot ?tank|bore cylinders?|bor(e|ing) (bar|stand)|hone|chamfer|grind block|deck(ing)? block|balanc(e|ing) (rotating|assembly)|press (pistons|pins)|cam bearings?)' THEN 'machining'
    WHEN t ~ '\y(decal|decl|dcl|deca|letters)\y' THEN 'trim'
    WHEN t ~ '\y(harness|hrns|hrness|wiring|grnd strps?|ground straps?)\y' THEN 'electrical'
    WHEN t ~ '\y(air cl(ea)?n(e)?r|shkr air)' THEN 'engine'
    WHEN t ~ '\y(rear ?end|ring (and |& ?)?pinion|posi(traction)?|differential|axle|axel|carrier bearing|pinion (seal|bearing))\y' THEN 'axle'
    WHEN t ~ '\y((tail|bdy|body|deck|cowl|shlf|shelf|quarter|qtr|floor|rocker|trunk|roof|fllr|filler) ?(/cowl )?(pnl|panel)|tail panel|rad(iator)? (core )?support|shaker hood|hood (assembly|hinge|panel)|fender|bump brace|bumper brace|door skin|patch panel|core support)' THEN 'body'
    WHEN t ~ '\y(glass|gls|wndshld|windshield (mou?lding|seal|gasket|trim)|back ?lite|window (regulator|channel|felt))' THEN 'glass'
    WHEN t ~ '\y(console|glove ?box|glv box|carpet|cpt|seat|uph|upholstery|headliner|sail panels?|door (panel|pnl|sill|lock)|dr pnl|lwr door pnl|sde pnl|shi?ft boot|shift (tunnel|knob)|grshft|knobs?|window crank|wndow crnk|sun ?visors?|snvsr|insulation|firewall pad|frwall|horn (cap|button)|hrn btn|radio|grab ha?ndle|grb hndl|innr hndl|inner (door )?handle|rear ?view|rr view|interi(or)?|trunk divider|package tray|seat shelf|strng col|steering column cover|htr ctrl|heater control|dash filler|instrument pnl emb|instrument panel emblem|mirror bezel|arm ?rest|kick panel|seat ?belt)' THEN 'interior'
    WHEN t ~ '\y(harness|hrns|hrness|wiring|bulbs?|sealed beam|headl(amp|ight)|battery|batt|starter|alternator|gauge|tach(ometer)?|speedo(meter)?|sending uni|printed circuit|mrkr lmp|marker lamp|dome|grnd strps?|ground straps?|neutral safety|turn signal|horn contact|cluster lens|light switch|lamp switch|fuse|relay|voltage regulator|ignition (switch|coil)|distributor|hei)\y' THEN 'electrical'
    WHEN t ~ '\y(radiator (hose|cap|drain|overflow)|radiator hose|rad overflw|radiator$|radiator \(|water pump|wp stud|thermostat|fan (clutch|shroud|blade)|water neck|antifre|anti-?freeze|coolant|petcock|stoplk|stop ?leak|heater (core|hose)|htr core)' THEN 'cooling'
    WHEN t ~ '\y(fuel|mech pump|carb(uretor)?|gas tank|tank (strap|sending)|choke|throttle (cable|linkage))' THEN 'fuel'
    WHEN t ~ '\y(brake|brakefld|semi-met pad|brake pads?|calipers?|non-brkt cal|rotor|bstr/mc|master cyl|whe?e?l (bearing|seal|cyl)|bearing set|drum|proportioning)' THEN 'brakes'
    WHEN t ~ '\y(power steering|p/s ?fluid|p/sfluid|pwr stg|steering (pump|box|gear|coupler)|tie rods?|idler arm|pitman|drag link|center link)' THEN 'steering'
    WHEN t ~ '\y(shocks?|caster shim|ball joints?|control[- ]arm|coil springs?|leaf springs?|suspension|alignment|sway bar|stabilizer|bushing kit|front end .*rebuild)' THEN 'suspension'
    WHEN t ~ '\y(exhaust|muffler|tail ?pipe|header|h-pipe|x-pipe)' THEN 'exhaust'
    WHEN t ~ '\y(clutch|flywhl|flywheel|rev(erse)? lock ?out|pivot ball|trans(mission)? mount|pedal pad|bellcrank|z-bar|shifter|shift (rod|linkage)|pressure plate|throw ?out|pilot bearing|speedometer gear|driveshaft|u-joint)' THEN 'transmission'
    WHEN t ~ '\y(decal|decl|dcl|deca|emblem|letters|spoiler|splr|bumper|weatherstrip|wstrps?|door handle|dr handle|dr hng|door hinge|mirror|wiper|fstnrs|fasteners|jacking|tail la?mp|tail light|tl lmp|grille|mou?ldings?|mldgs?|nameplate|badge|stripe)' THEN 'trim'
    WHEN t ~ '\y(engine|spark plugs?|plug wire|oil|pcv|air cl(ea)?n(e)?r|air filter|motor mount|mount bolt|dipstick|v-belt|belt|vac(uum)?|pistons?|rings|cam(shaft)?|lifters?|pushrods?|gasket|valve cover|timing|intake|crank|rod bearings?|main bearings?|freeze plugs?)' THEN 'engine'
    WHEN t ~ '\y(washers?|hex bolts?|bolts?|nuts?|screws?|clamps?|clips?|rivets?|studs?)\y' THEN 'hardware'
  END
  FROM (SELECT lower(coalesce(p_text, '')) AS t) s
$$;
COMMENT ON FUNCTION public.receipt_line_system(text) IS
  'The car system a receipt line names, read from its words (supplier abbreviations included): engine, machining, fuel, cooling, exhaust, electrical, brakes, steering, suspension, axle, transmission, body, glass, interior, trim, plus hardware and supplies. First match wins; null when the words name no system. A reading of the paper, not proof the part was fitted.';

CREATE OR REPLACE FUNCTION public.receipt_line_labor_operation(p_text text) RETURNS text
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  SELECT CASE
    WHEN t ~ '\y(harness|hrns|hrness)\y' THEN 'ELEC-WIRING-HARNESS'
    WHEN t ~ '\y(gauge|tach(ometer)?/clock|printed circuit|cluster lens)' THEN 'ELEC-GAUGES'
    WHEN t ~ '\y(sealed beam|headl(amp|ight))' THEN 'ELEC-HEADLIGHTS'
    WHEN t ~ '\y(tail la?mp (housing|lens)|tail light lens)' THEN 'ELEC-TAILLIGHTS'
    WHEN t ~ '\y(carpet|cpt/und)' THEN 'INT-CARPET-RR'
    WHEN t ~ '\yheadliner' THEN 'INT-HEADLINER-RR'
    WHEN t ~ '\y(door pa?ne?l kit|lwr door pnl|door panel \(pr\))' THEN 'INT-DOOR-PANELS'
    WHEN t ~ '\y(seat foam|f/s uph|seat uph|upholstery set)' THEN 'INT-SEATS-RR'
    WHEN t ~ '\y(dr glass|door glass)' THEN 'GLASS-DOOR'
    WHEN t ~ '\yradiator( assembly)?$' THEN 'MECH-RADIATOR-RR'
    WHEN t ~ '\y(brake rotor|non-brkt cal|calipers?|semi-met pad|brake pads?)' THEN 'MECH-BRAKES-FRONT'
    WHEN t ~ '\y(front end suspension rebuild|ball joints?|control[- ]arm shaft)' THEN 'MECH-SUSPENSION-FRONT'
    WHEN t ~ '\y(clutch (kit|disc)|pressure plate|flywhl|flywheel)' THEN 'MECH-TRANS-RR'
    WHEN t ~ '\yrear bumper\y' THEN 'TRIM-BUMPERS-REAR'
    WHEN t ~ '\yfro?nt bumper\y' THEN 'TRIM-BUMPERS-FRONT'
    WHEN t ~ '\ygrille' THEN 'TRIM-GRILLE'
    WHEN t ~ '\y(outer|outside|door) mirror' THEN 'TRIM-MIRRORS'
    WHEN t ~ '\y(shaker hood|hood assembly)' THEN 'BODY-REPLACE-HOOD'
    WHEN t ~ '\yfender( assembly)?$' THEN 'BODY-REPLACE-FENDER'
    WHEN t ~ '\y(tail panel|rr bdy pnl|deck fllr pnl|deck filler panel|dash/cowl pnl|cowl panel|shlf pnl|quarter panel|floor pan|trunk (floor|pan))' THEN 'BODY-RUST-PANEL'
  END
  FROM (SELECT lower(coalesce(p_text, '')) AS t) s
$$;
COMMENT ON FUNCTION public.receipt_line_labor_operation(text) IS
  'The labor_operations.code whose work fitting this part corresponds to, or null when no stored operation fits. The caller joins labor_operations for the hours; an unmatched part is a gap to count, never a default number.';

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
        'reference_operations', (SELECT count(*) FROM ops),
        'parts_without_reference', (SELECT count(*) FROM l WHERE line_kind = 'part' AND op_code IS NULL),
        'recorded_amount', CASE WHEN (SELECT tied FROM v) THEN (SELECT sum(total_price) FROM l) END)),
    'systems_without_paper', (SELECT coalesce(jsonb_agg(k ORDER BY k), '[]'::jsonb)
        FROM unnest(ARRAY['engine','machining','fuel','cooling','exhaust','electrical','brakes','steering','suspension','axle',
                          'transmission','body','paint','glass','interior','trim','tires']) k
       WHERE NOT EXISTS (SELECT 1 FROM sys s WHERE s.system_key = k)),
    'systems', (SELECT coalesce(jsonb_agg(jsonb_build_object(
        'system_key', s.system_key, 'first_day', s.first_day, 'last_day', s.last_day,
        'part_lines', s.part_lines, 'backordered_lines', s.backordered_lines, 'suppliers', s.suppliers,
        'paper', jsonb_build_object('lines', s.paper_work_lines, 'lines_without_hours', s.paper_work_lines_without_hours,
                                    'hours', s.paper_hours, 'performers', s.performers, 'shops', s.shops),
        'reference', jsonb_build_object(
            'hours', (SELECT sum(o.base_hours) FROM ops o WHERE o.system_key = s.system_key),
            'operations', (SELECT coalesce(jsonb_agg(jsonb_build_object('code', o.code, 'name', o.name, 'hours', o.base_hours,
                             'part_lines', o.part_lines, 'source', 'labor_operations',
                             'basis', CASE WHEN o.part_lines = 0 THEN 'implied_by_machine_shop_work' ELSE 'part_on_receipt' END) ORDER BY o.base_hours DESC, o.code), '[]'::jsonb)
                             FROM ops o WHERE o.system_key = s.system_key),
            'parts_without_reference', s.parts_without_reference),
        'priced_lines', s.priced_lines,
        'recorded_amount', CASE WHEN (SELECT tied FROM v) THEN s.recorded_amount END,
        'lines', (SELECT jsonb_agg(jsonb_build_object(
                    'item_id', x.item_id, 'receipt_id', x.receipt_id, 'kind', x.line_kind, 'day', x.anchor_date,
                    'source', nullif(left(btrim(public.text_redact_contact(x.vendor_name)), 300), ''),
                    'description', nullif(left(btrim(public.text_redact_contact(x.description)), 500), ''),
                    'part_number', x.part_number, 'paper_hours', x.printed_hours, 'operation_code', x.op_code,
                    'amount', CASE WHEN (SELECT tied FROM v) THEN x.total_price END)
                    ORDER BY x.anchor_date NULLS LAST, x.item_id)
                    FROM l x WHERE x.system_key = s.system_key))
        ORDER BY coalesce(s.paper_hours, 0) + coalesce((SELECT sum(o.base_hours) FROM ops o WHERE o.system_key = s.system_key), 0) DESC,
                 s.part_lines DESC, s.system_key), '[]'::jsonb) FROM sys s)) END
$$;
COMMENT ON FUNCTION public.vehicle_build_reconstruction(uuid) IS
  'The build per car system, computed from the vehicle''s current receipt lines (receipt_work_lines): date span, part lines, printed shop hours (paper), reference hours from labor_operations (each operation once per vehicle), gaps and the lines. Paper and reference hours are separate lenses, never added. Recorded amounts only for the owner, a granted user or service role. Null when the caller may not see the vehicle. Read-only.';

REVOKE ALL ON FUNCTION public.vehicle_build_reconstruction(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_build_reconstruction(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.receipt_line_system(text), public.receipt_line_labor_operation(text) TO anon, authenticated, service_role;
