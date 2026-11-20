-- Part installation evidence, rules 2: more parts a photograph genuinely names, and four loose spots tightened.
--
-- Why: vehicle_part_installation_evidence read 108 of 223 receipt part lines as seen. Of the 115 not photographed, 107 had no
-- rule. Most of those cannot be seen on an assembled car (bearings, gaskets, fluids, bulbs, washers, clamps, harnesses). A few
-- are named by a stored reading (water outlet neck, air-cleaner vent tube, transmission mount, console storage liner, lower door
-- panel, remote mirror bezel, dash filler plate, rear speaker shelf panel). Separately the author reported loose matches, and a
-- read of the matched words found three more: a tail-lamp "lens" line was matched by a headlamp lens and by "lamp assembly"
-- readings; a hood-decal line was matched by readings that say there is NO bird graphic and by floor-mat bird graphics; hedged readings ("possibly ...") counted.
--
-- What (re-creates two functions with CREATE OR REPLACE; no table, no data; revert: supabase/sql/revert_20261120050000_part_installation_rules_2.sql):
--   part_installation_rules()                 + 7 rules; tail_lamp_lens needs a tail/rear lamp "lens" and no longer takes an assembly
--                                             or a headlamp; tail_lamp_housing needs the word "housing" (an assembly names the whole
--                                             lamp, not its housing); door_glass drops a belt-molding / molding reading;
--                                             hood_decal drops floor-mat bird graphics (the denial readings are removed by the evidence change below);
--                                             rear_seat_shelf also takes the speaker-shelf panel line and skips a shelf bracket;
--                                             hood_decal_sd455 needs the reading to say hood (shaker-scoop lettering is not the hood decal);
--                                             seat_upholstery needs a front bucket seat whose covering is shown (pleated, upholstered,
--                                             cushion, back), not a seat glimpsed through glass, a folded seat back or a part key alone.
--   vehicle_part_installation_evidence(uuid)  one change: the readings that never count also exclude "without", "no visible",
--                                             "not visible", "possibly" and "probably" (a reading that denies or hedges the part
--                                             does not show it). Same output shape, still no amounts, grants unchanged.
--                                             Also a second basis: a current answered question (evidence_judgment_requests, kind
--                                             receipt_part_visible; not cancelled, withdrawn or superseded) with visible=yes makes its line
--                                             seen (matched_on 'answered_question', the request id as witness, the answer's quote and
--                                             confidence) through a photograph that passes the same gates as a reading. visible=no or
--                                             cannot_tell is never evidence of absence; it is only counted per line (asked, asked_not_visible).
-- Read-only; writes nothing.
SET lock_timeout = '5s';
SET statement_timeout = '60s';

CREATE OR REPLACE FUNCTION public.part_installation_rules() RETURNS TABLE(
  ord int, rule text, line_re text, key_re text, label_re text, label_not_re text, basis text)
LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
  -- Ordered: the first rule whose line_re matches a receipt line's words (lower case) owns that line, so specific rules sit
  -- before general ones. A reading shows the part when its part_key matches key_re, or its own words (a component label or
  -- the reading's statement) match label_re and not label_not_re. Keys are used only where the key names one part; coarse
  -- keys (engine.bay, undercarriage, engine.cooling, trim.molding) are never used. A part with no row here is never matched.
  SELECT * FROM (VALUES
    (10, 'radiator_hose', '\yradiator hose\y', NULL, '(radiator|cooling) hose', NULL, 'names a radiator or cooling hose'),
    (20, 'radiator_cap', '\yradiator cap\y', NULL, 'radiator (pressure )?cap|filler neck and pressure cap', NULL, 'names a radiator cap'),
    (30, 'radiator_overflow', 'rad overflw|radiator overflow', NULL, 'coolant recovery reservoir|overflow (jar|bottle|reservoir)', NULL, 'names a coolant recovery reservoir'),
    (40, 'fan_shroud', '\yfan shroud', NULL, 'fan.?shroud|cooling fan and surrounding shroud', NULL, 'names a fan shroud'),
    (50, 'fan_clutch', '\yfan clutch', NULL, 'fan.?clutch', NULL, 'names a fan clutch'),
    (60, 'radiator_support', '\yrad(iator)? (core )?support(?! mounts)', NULL, 'radiator.?support', NULL, 'names the radiator support'),
    (65, 'water_outlet_neck', '\ywater neck', NULL, 'water outlet neck|water.?neck', NULL, 'names the water outlet neck'),
    (70, 'radiator', '\yradiator\y(?! petcock)', '^engine\.cooling\.radiator', '\yradiator\y', 'hose|cap|support|shroud|filler|enclosure', 'names the radiator'),
    (80, 'starter', '\ystarter\y', NULL, '\ystarter( motor)?\y(?!-)', 'terminal|solenoid', 'names the starter motor'),
    (90, 'battery', '^battery\y', NULL, '\ybattery\y', 'hold-down|cable|rod|tray', 'names the battery'),
    (100, 'spark_plug', '\yspark plug', NULL, '\yspark plug(?! wire)', NULL, 'names a spark plug'),
    (110, 'plug_wire_separators', 'plug wire separators', NULL, '\yseparators\y', NULL, 'names plug-wire separators'),
    (120, 'oil_filter_adapter', 'oil filter adapter', NULL, 'oil.?filter adapter', NULL, 'names the oil filter adapter'),
    (130, 'oil_filter', '\yoil filter\y', NULL, '\yoil filter\y', 'adapter', 'names an oil filter'),
    (140, 'oil_pressure_sender', 'oil pressure sending', NULL, 'oil.?pressure (sender|sending)', NULL, 'names an oil pressure sender'),
    (150, 'temp_sender', 'temp sending unit', NULL, 'temperature sender', NULL, 'names a temperature sender'),
    (160, 'v_belt', '\yv-belt', NULL, '\yv-belts?\y|accessory belts?|pulley and belt', 'seat|lap', 'names a drive belt'),
    (170, 'vacuum_hose', '\yvac(uum)? (tubing|tube)', NULL, 'vacuum (hose|line|tube)', NULL, 'names a vacuum hose or tube'),
    (175, 'air_cleaner_vent_tube', 'air clnr vent t', NULL, '\yvent tube\y', NULL, 'names an air cleaner vent tube'),
    (180, 'fuel_pump', 'mech pump|fuel pump', NULL, 'mechanical fuel pump', NULL, 'names a mechanical fuel pump'),
    (190, 'fuel_hose', '\yfuel hose', NULL, 'fuel hose', NULL, 'names a fuel hose'),
    (200, 'engine_mount', '\yengine mount', '^engine\.mount', 'motor mount|engine mount', NULL, 'names an engine mount'),
    (205, 'transmission_mount', '\ytrans mount', NULL, 'transmission (crossmember and )?mount\y|\ytrans mount\y', NULL, 'names the transmission mount'),
    (210, 'exhaust_hanger', 'exhaust hanger', NULL, 'exhaust.*hanger|muffler hanger', NULL, 'names an exhaust hanger'),
    (220, 'brake_rotor', '\ybrake rotor', '^undercarriage\.brake\.rotor', 'brake.?rotor|rotor friction surface', NULL, 'names a brake rotor'),
    (230, 'brake_caliper', 'non-brkt cal|\ycalipers?\y', NULL, '\ycaliper\y', NULL, 'names a brake caliper'),
    (240, 'brake_hose', '\ybrake hose', NULL, 'brake hose', 'hard line', 'names a brake hose'),
    (250, 'brake_booster_master', 'bstr/mc|master cyl', '^engine\.brake\.master', 'brake booster|master cylinder', NULL, 'names the brake booster or master cylinder'),
    (260, 'power_steering_hose', 'pwr stg hose|power steering hose', NULL, 'power.?steering (hose|line)', NULL, 'names a power steering hose'),
    (270, 'power_steering_pulley', 'power steering pump pulley', NULL, 'power.?steering.*pulley|steering pump pulley', NULL, 'names the power steering pulley'),
    (280, 'shock_rear', '\yshocks-r', NULL, 'rear shock', NULL, 'names a rear shock absorber'),
    (290, 'shock_front', '\yshocks-f', NULL, 'front.*shock|shock absorber inside coil spring', NULL, 'names a front shock absorber (or one inside a coil spring)'),
    (300, 'pedal_pad', 'pedal pad', NULL, 'pedal pads?', 'parking', 'names a pedal pad'),
    (310, 'shift_boot_retainer', 'boot rtnr|boot retainer', NULL, 'shift.?boot retainer|boot retainer', NULL, 'names the shift boot retainer'),
    (320, 'shift_boot', 'sh?ft boot', NULL, 'shift boot|lever and boot|upper boot', 'clutch|fork|dust', 'names a shift boot'),
    (330, 'console_lid_arm', 'console lid arm', NULL, 'lid support arm|console lid support|lid arm', NULL, 'names the console lid arm'),
    (340, 'console_lid', '\yconsole lid', NULL, 'console lid|padded lid', 'latch|support arm', 'names the console lid'),
    (350, 'console', 'console-man', '^interior\.(center\.)?console', '\yconsole\y', '\y(lid|latch|support arm|glove|bracket)\y', 'names the center console'),
    (355, 'console_storage_liner', 'inner console glove|innr console glove', NULL, 'console storage liner|console glove', NULL, 'names the console storage liner'),
    (360, 'glove_box_door', 'glv box door|glove box door', NULL, 'glove.?box door', NULL, 'names the glove box door'),
    (370, 'glove_box_inner', 'innr glove box|inner glove box', NULL, 'glove compartment|glove.?box liner', NULL, 'names the glove box interior'),
    (380, 'sill_plate', 'sill plt|sill plate', NULL, 'sill plate', NULL, 'names a door sill plate'),
    (390, 'window_crank', 'wndow crnk|window crank', NULL, 'window crank|manual crank', NULL, 'names a window crank'),
    (400, 'door_lock_knob', 'door lock knob', NULL, 'door.?lock knob', NULL, 'names a door lock knob'),
    (410, 'inner_door_handle', 'innr hndl|inner (door )?handle', NULL, 'inner handle|inner door handle|interior (door )?(release|handle)|release handle', NULL, 'names an inner door handle or release'),
    (420, 'outer_door_handle', '(outer|outr) (door|dr) handle(?! ro)', '^door\.handle', '(exterior|outer) (door )?handle', 'inner', 'names an exterior door handle'),
    (430, 'door_hinge', '\ydr hng|door hinge', '^door\.hinge', 'door hinge', NULL, 'names a door hinge'),
    (435, 'lower_door_panel', 'lwr door pnl|lower door panel', NULL, 'lower door panel', 'red|outer|shell', 'names the lower door panel'),
    (440, 'trunk_weatherstrip', 'trunk weatherstrip', NULL, 'trunk.*weatherstrip|weatherstrip.*trunk', NULL, 'names the trunk weatherstrip'),
    (450, 'door_weatherstrip', 'dr frme wstrp|door frame weatherstrip', NULL, 'door.*weatherstrip|weatherstrip.*door', NULL, 'names door weatherstrip'),
    (460, 'roof_rail_weatherstrip', 'roof rl wstrp|roof rail weatherstrip', NULL, 'roof.rail weatherstrip|roof opening weatherstrip', NULL, 'names roof rail weatherstrip'),
    (470, 'interior_mirror', 'rr view mirro|rear ?view mirror', NULL, 'interior rear-?view mirror', NULL, 'names the interior rearview mirror'),
    (475, 'remote_mirror_bezel', 'remote mirror bezel', NULL, 'remote.*mirror.*bezel|mirror control.*bezel', NULL, 'names the remote mirror control bezel'),
    (480, 'sun_visor', 'snvsr|sun ?visor', NULL, 'sun visor', NULL, 'names a sun visor'),
    (490, 'headliner', 'headliner', '^interior\.headliner', 'headliner', NULL, 'names the headliner'),
    (500, 'sail_panel', 'sail panel', NULL, 'sail (panel|trim)', NULL, 'names a sail panel'),
    (510, 'carpet_guard', 'carpet guard', NULL, 'carpet guard', NULL, 'names the firewall carpet guard'),
    (520, 'carpet', '\ycpt\y|\ycarpet\y', '^interior\.carpet', 'loop.?(pile )?carpet|black carpet|\ycarpet\y', 'guard', 'names the loop carpet'),
    (530, 'seat_upholstery', 'f/s uph|seat uph|\yuph\y', NULL, '^(?=.*(bucket.?seat|front.?seat))(?=.*(upholster|pleat|cushion|back ?rest|seat ?back))', 'belt|side cover|rear|through|behind|aperture|mount|folded|tilted|molded|panel|second|obscured', 'names the covering of a front seat'),
    (540, 'seat_side_covers', 'seat side covers', NULL, 'bucket.?seat side cover', NULL, 'names bucket seat side covers'),
    (550, 'rear_seat_shelf', 'rear seat shelf|rr spkr shlf', NULL, 'rear (parcel|package) shelf|parcel shelf|package-shelf', 'bracket', 'names the rear parcel shelf'),
    (560, 'horn_button', 'horn cap|hrn btn|horn button', NULL, 'horn button|horn cap', NULL, 'names the horn button'),
    (570, 'gauge_fuel', 'fuel gauge', NULL, 'fuel gauge', NULL, 'names the fuel gauge'),
    (580, 'gauge_volt', 'volt gauge', NULL, 'voltmeter|volt gauge', NULL, 'names the voltmeter'),
    (590, 'gauge_oil_water', 'oil/water gauge', NULL, 'oil-pressure and water-temperature|oil.?pressure.*water.?temp', NULL, 'names the oil and water gauge'),
    (600, 'tach_clock', 'tach/clock', NULL, 'tachometer', NULL, 'names the tachometer'),
    (610, 'dash_emblem', 'instrument pnl emb', NULL, 'emblem on instrument fascia|instrument fascia.*emblem', NULL, 'names the instrument panel emblem'),
    (620, 'radio_bezel', 'radio bezel', NULL, '\yradio\y.*bezel|bezel.*\yradio\y', NULL, 'names the radio bezel'),
    (625, 'dash_filler_plate', 'dash filler plate', NULL, 'filler plate', NULL, 'names the dash filler plate'),
    (630, 'radio_knobs', 'am/fm knobs', NULL, 'radio.*knob|radio knob', NULL, 'names the radio knobs'),
    (640, 'heater_control', 'htr ctrl lens|heater control', NULL, 'heater control|heater slider|heater and defrost control', NULL, 'names the heater control panel'),
    (650, 'light_switch_knob', 'light switch kn', NULL, 'headlamp switch knob|light switch', NULL, 'names the light switch knob'),
    (660, 'grab_handle_bezels', 'grb hndl bezels|grab handle bezels', NULL, 'grab handle bezel', NULL, 'names the grab handle bezels'),
    (670, 'grab_handle', 'dash grab handle|dsh grb hndl', NULL, 'grab handle', 'bezel', 'names the dash grab handle'),
    (680, 'tail_lamp_bezel', 'tail lamp bezel', '^light\.tail', 'tail.?lamp.*bezel|rear lamp (lens )?and (bright )?bezel|lamp lens and (bright )?bezel', NULL, 'names a tail lamp bezel'),
    (690, 'tail_lamp_lens', 'tail lamp lens', NULL, '\y(tail|rear)[ -]?lamps?\y.*\ylens(es)?\y', 'marker|assembly|housing|indicator', 'names a tail lamp lens'),
    (700, 'tail_lamp_housing', 'tail lamp housing', NULL, '\y(tail|rear)[ -]?lamp\y.*\yhousing\y|\yhousing\y.*\y(tail|rear)[ -]?lamp\y', 'marker', 'names a tail lamp housing'),
    (710, 'side_marker_front', 'frt sde mrkr|front side marker', NULL, 'front.*marker|amber side marker', 'rear', 'names a front side marker lamp'),
    (720, 'side_marker_rear', 'rr side mrkr|rear side marker', NULL, 'rear.*marker|red side marker', 'front', 'names a rear side marker lamp'),
    (730, 'sealed_beam', 'sealed beam', '^light\.head', 'headlamp|headlight', NULL, 'names a headlamp'),
    (740, 'rear_bumper', 'rear bumper', '^trim\.bumper\.rear', 'rear bumper', 'jack', 'names the rear bumper'),
    (750, 'front_spoiler', 'frt spoiler|front spoiler', '^trim\.spoiler\.front', 'front (lower |chin )?spoiler|lower (front )?spoiler|chin spoiler', 'wheel-opening|rear', 'names the front spoiler'),
    (760, 'rear_spoiler_side', 'rear side spoiler', NULL, 'rear spoiler.*end piece|rear spoiler end', NULL, 'names the rear spoiler end pieces'),
    (770, 'hood_decal_sd455', 's\.?d\.? ?455 hood|sd455 hood', NULL, '\yhood\y.*sd.?455|sd.?455.*\yhood\y', 'shaker', 'names SD-455 lettering on the hood'),
    (780, 'hood_decal', 'hood decal', '^badge\.decal\.hood', 'hood.*(bird|graphic|decal)|bird (hood )?(graphic|decal)', 'floor|\ymats?\y|carpet', 'names the hood decal or bird graphic'),
    (790, 'fender_decal', 'fender dcl|fender decal', '^badge\.decal\.fender', 'fender (decal|lettering|graphic)|trans am fender', NULL, 'names a fender decal'),
    (800, 'spoiler_decal', 'splr dcl|spoiler decal', '^badge\.decal\.spoiler', 'spoiler.*(decal|lettering|graphic)', NULL, 'names a spoiler decal'),
    (810, 'tail_panel_letters', 'tail pnl letters', NULL, 'tail.?panel (letters|lettering)|rear panel lettering', NULL, 'names the tail panel letters'),
    (820, 'jacking_decal', 'jacking instruction', NULL, 'jack.*instruction decal|jack usage', NULL, 'names the jacking instruction decal'),
    (830, 'windshield_molding', 'wndshld mldgs|windshield mou?ldings?', NULL, 'windshield.*(molding|trim)', NULL, 'names windshield molding'),
    (840, 'rear_glass_molding', 'bck gls mldgs|back glass mou?ldings?', NULL, '(rear|back) (window|glass).*(molding|trim)|rear.window.*molding', NULL, 'names rear window molding'),
    (850, 'door_glass', '\ydr glass|door glass', NULL, 'door glass', 'seat|through|belt|mou?ld', 'names door glass'),
    (860, 'wiper_blade', 'wiper blade', NULL, '\ywipers?\y', 'motor|washer', 'names windshield wipers'),
    (870, 'shaker_hood', 'shaker hood', NULL, 'shaker (hood )?scoop|shaker-style|hood with shaker|scoop projecting through hood', NULL, 'names the shaker scoop in the hood'),
    (880, 'tail_panel', '\ytail panel', NULL, 'tail.?panel', 'letter', 'names the tail panel'),
    (890, 'clutch_inspection_cover', 'clutch inspection cover', NULL, 'clutch inspection cover|inspection cover', NULL, 'names the clutch inspection cover'),
    (900, 'speedo_cable', 'speedo cable', NULL, 'speedometer.?cable', NULL, 'names the speedometer cable'),
    (910, 'dome_lens', 'dome lens', NULL, 'dome lamp|dome-light|dome light', NULL, 'names the dome lamp'),
    (920, 'ground_straps', 'grnd strps|ground straps', NULL, 'ground strap', NULL, 'names a ground strap'),
    (930, 'steering_column_cover', 'strng col cvr|steering column cover', NULL, 'column cover|steering column (cover|shroud)', NULL, 'names the steering column cover')
  ) AS t(ord, rule, line_re, key_re, label_re, label_not_re, basis)
$$;
COMMENT ON FUNCTION public.part_installation_rules() IS
  'The ordered rule table behind vehicle_part_installation_evidence: receipt-line words (line_re, lower case) to the photo readings that name that same part (key_re on part_key; label_re / label_not_re on the reading''s own words). First matching line rule owns the line. A part with no rule is "not photographed", never guessed.';

CREATE OR REPLACE FUNCTION public.vehicle_part_installation_evidence(p_vehicle_id uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, public AS $$
  WITH v AS (
    SELECT v.id
      FROM public.vehicles v
     WHERE v.id = p_vehicle_id AND v.deleted_at IS NULL
       AND (v.is_public IS TRUE OR auth.role() = 'service_role' OR (auth.uid() IS NOT NULL AND (v.user_id = auth.uid()
            OR v.owner_id = auth.uid() OR v.uploaded_by = auth.uid() OR public.vehicle_user_has_access(v.id, auth.uid()))))),
  l AS (
    -- the part lines of vehicle_build_reconstruction: a priced line with no part number whose words are work is shop work
    SELECT k.item_id, k.receipt_id, k.anchor_date, k.description, lower(k.description) AS dl,
           coalesce(public.receipt_line_system(k.description), 'unplaced') AS system_key
      FROM (SELECT w.item_id, w.receipt_id, w.anchor_date, w.description,
                   CASE WHEN w.line_kind = 'part' AND w.part_number IS NULL AND lower(w.description) ~
                          '\y(check and repair|repair|rebuild|install(ation)?|alignment|labor|surface heads?|polish crank|valve job|hang pistons?|block package|machine work|mount and balance)\y'
                        THEN 'service' ELSE w.line_kind END AS line_kind
              FROM v CROSS JOIN LATERAL public.receipt_work_lines(v.id) w) k
     WHERE k.line_kind = 'part'),
  lr AS (
    SELECT l.*, r.rule, r.key_re, r.label_re, r.label_not_re, r.basis,
           public.part_text_side(l.description) AS line_side, public.part_text_level(l.description) AS line_level
      FROM l LEFT JOIN LATERAL (SELECT x.* FROM public.part_installation_rules() x WHERE l.dl ~ x.line_re ORDER BY x.ord LIMIT 1) r ON true),
  rd AS (
    -- the current reviewed reading of each photograph a visitor may see, when it shows the assembled car
    SELECT DISTINCT ON (i.id) i.id AS image_id, i.image_url, i.taken_at, o.id AS observation_id, o.structured_data AS sd,
           public.photo_reading_is_print(o.structured_data) AS is_print,
           o.structured_data ->> 'build_phase_guess' AS phase
      FROM v JOIN public.vehicle_observations o ON o.vehicle_id = v.id
      JOIN public.vehicle_images i ON i.id = (o.structured_data ->> 'image_id')::uuid AND i.vehicle_id = v.id
     WHERE o.extraction_method = 'reviewed_image_analysis_v1' AND o.is_superseded IS NOT TRUE
       AND o.structured_data ->> 'image_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND public.vehicle_image_gallery_eligible(i) AND coalesce(i.is_sensitive, false) = false
       AND coalesce(i.is_duplicate, false) = false AND coalesce(i.is_superseded, false) = false
       AND o.structured_data #>> '{state_observations,completeness}' = 'assembled'
       AND coalesce(o.structured_data ->> 'build_phase_guess', '') NOT IN ('teardown', 'metalwork', 'paint_prep', 'paint_application')
     ORDER BY i.id, o.id),
  ev0 AS (
    -- what each photograph's readings say, as the reading's own words: component labels, and part-keyed statements
    SELECT rd.image_id, rd.image_url, CASE WHEN rd.is_print THEN NULL ELSE rd.taken_at::date END AS day, rd.is_print, rd.phase,
           rd.observation_id, NULL::text AS part_key, NULL::text AS part_side, c ->> 'label' AS words
      FROM rd CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(rd.sd -> 'components_seen') = 'array'
                                                          THEN rd.sd -> 'components_seen' ELSE '[]'::jsonb END) c
     WHERE jsonb_typeof(c -> 'label') = 'string'
    UNION ALL
    SELECT rd.image_id, rd.image_url, CASE WHEN rd.is_print THEN NULL ELSE rd.taken_at::date END, rd.is_print, rd.phase,
           o.id, o.structured_data ->> 'part_key', o.structured_data ->> 'part_side', o.structured_data ->> 'source_text'
      FROM v JOIN public.vehicle_observations o ON o.vehicle_id = v.id
      JOIN rd ON rd.image_id = (o.structured_data ->> 'image_id')::uuid
     WHERE o.extraction_method = 'photo_map_harvest_v1' AND o.is_superseded IS NOT TRUE
       AND o.structured_data ->> 'image_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       AND nullif(o.structured_data ->> 'part_key', '') IS NOT NULL),
  ev AS (
    SELECT ev0.*, lower(coalesce(ev0.words, '')) AS txt,
           coalesce(public.part_text_side(ev0.words),
                    CASE lower(ev0.part_side) WHEN 'left' THEN 'left' WHEN 'driver' THEN 'left' WHEN 'right' THEN 'right' WHEN 'passenger' THEN 'right' END) AS ev_side,
           public.part_text_level(ev0.words) AS ev_level
      FROM ev0),
  mr AS (
    -- one row per (line, photograph): the reading whose words name the part (words preferred over a key)
    SELECT DISTINCT ON (lr.item_id, e.image_id) lr.item_id, e.image_id, e.image_url, e.day, e.is_print, e.phase, e.observation_id, e.part_key,
           e.words, coalesce(lr.key_re IS NOT NULL AND e.part_key ~ lr.key_re, false) AS by_key,
           NULL::uuid AS request_id, NULL::numeric AS answer_confidence, false AS by_answer
      FROM lr JOIN ev e ON lr.rule IS NOT NULL
       -- a part-keyed reading counts by its key alone (its statement often names neighbours); a component label counts by its words
       AND (CASE WHEN e.part_key IS NOT NULL THEN lr.key_re IS NOT NULL AND e.part_key ~ lr.key_re
                 ELSE lr.label_re IS NOT NULL AND e.txt ~ lr.label_re AND (lr.label_not_re IS NULL OR e.txt !~ lr.label_not_re) END)
       -- not a part off the car, loose, or in the background
       AND e.txt !~ '\y(loose|detached|absent|reproduction|box|background|printed|print|upper photograph|lower photograph|without|possibly|probably|no visible|not visible)\y'
       AND NOT (lr.line_side IS NOT NULL AND e.ev_side IS NOT NULL AND lr.line_side <> e.ev_side)
       AND NOT (lr.line_level IS NOT NULL AND e.ev_level IS NOT NULL AND lr.line_level <> e.ev_level)
       -- a photograph taken before the receipt cannot show that purchase; a print carries no day and is kept apart
       AND (e.is_print OR lr.anchor_date IS NULL OR e.day >= lr.anchor_date)
     ORDER BY lr.item_id, e.image_id, coalesce(lr.key_re IS NOT NULL AND e.part_key ~ lr.key_re, false), e.observation_id),
  aq0 AS (
    -- current answered "is the part on this receipt line visible" questions for this vehicle: not cancelled, withdrawn or superseded
    SELECT q.id AS request_id, q.answer AS ans, (q.params #>> '{context,item_id}')::uuid AS item_id
      FROM v JOIN public.evidence_judgment_requests q ON q.vehicle_id = v.id
     WHERE q.question_kind = 'receipt_part_visible' AND q.status = 'answered' AND q.superseded_by IS NULL AND q.cancelled_at IS NULL
       AND q.params #>> '{context,item_id}' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
  aq AS (
    -- a yes answer counts only through a photograph that passes the same gates as a reading (rd), on or after the receipt day
    SELECT lr.item_id, rd.image_id, rd.image_url, CASE WHEN rd.is_print THEN NULL ELSE rd.taken_at::date END AS day, rd.is_print, rd.phase,
           NULL::uuid AS observation_id, NULL::text AS part_key, nullif(left(btrim(aq0.ans ->> 'quote'), 300), '') AS words, false AS by_key,
           aq0.request_id, CASE WHEN aq0.ans ->> 'confidence' ~ '^[0-9.]+$' THEN (aq0.ans ->> 'confidence')::numeric END AS answer_confidence, true AS by_answer
      FROM aq0 JOIN lr ON lr.item_id = aq0.item_id
      JOIN rd ON rd.image_id = CASE WHEN aq0.ans ->> 'image_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN (aq0.ans ->> 'image_id')::uuid END
     WHERE aq0.ans ->> 'visible' = 'yes' AND (rd.is_print OR lr.anchor_date IS NULL OR rd.taken_at::date >= lr.anchor_date)),
  asked AS (
    -- a "no" or "cannot tell" is not evidence of absence; it is only counted, so a page can say "asked, not visible in the frames checked"
    SELECT item_id, count(*) AS n, count(*) FILTER (WHERE ans ->> 'visible' = 'no') AS n_no FROM aq0 GROUP BY item_id),
  m0 AS (
    SELECT DISTINCT ON (u.item_id, u.image_id) u.*
      FROM (SELECT * FROM mr UNION ALL SELECT * FROM aq) u
     ORDER BY u.item_id, u.image_id, u.by_answer, u.by_key, u.observation_id),
  m AS (
    SELECT m0.*, row_number() OVER (PARTITION BY m0.item_id ORDER BY m0.is_print, m0.by_answer, m0.by_key, m0.day, m0.image_id) AS rn
      FROM m0),
  st AS (
    SELECT lr.item_id, lr.receipt_id, lr.anchor_date, lr.system_key, lr.rule, lr.basis, lr.description,
           coalesce(a.n, 0) AS asked, coalesce(a.n_no, 0) AS asked_no, coalesce(bool_or(m.by_answer), false) AS has_answer,
           count(m.image_id) FILTER (WHERE NOT m.is_print) AS dated_images, count(m.image_id) FILTER (WHERE m.is_print) AS print_images,
           min(m.day) AS first_day, max(m.day) AS last_day,
           CASE WHEN count(m.image_id) FILTER (WHERE NOT m.is_print) > 0 THEN 'seen'
                WHEN count(m.image_id) > 0 THEN 'seen_in_prints_only'
                ELSE 'not_photographed' END AS status,
           CASE WHEN count(m.image_id) > 0 THEN NULL WHEN lr.rule IS NULL THEN 'no rule names this part'
                ELSE 'rule found no qualifying photograph reading' END AS reason,
           coalesce(jsonb_agg(jsonb_build_object(
             'image_id', m.image_id, 'image_url', m.image_url, 'day', m.day, 'is_print', m.is_print, 'build_phase', m.phase,
             'part_key', m.part_key, 'matched_on', CASE WHEN m.by_answer THEN 'answered_question' WHEN m.by_key THEN 'part_key' ELSE 'reading words' END,
             'reading', nullif(left(btrim(public.text_redact_contact(m.words)), 300), ''), 'observation_id', m.observation_id,
             'request_id', m.request_id, 'answer_confidence', m.answer_confidence)
             ORDER BY m.rn) FILTER (WHERE m.rn <= 4), '[]'::jsonb) AS seen
      FROM lr LEFT JOIN m ON m.item_id = lr.item_id LEFT JOIN asked a ON a.item_id = lr.item_id
     GROUP BY lr.item_id, lr.receipt_id, lr.anchor_date, lr.system_key, lr.rule, lr.basis, lr.description, a.n, a.n_no)
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM v) THEN NULL ELSE jsonb_build_object(
    'function', 'vehicle_part_installation_evidence', 'version', 1, 'vehicle_id', p_vehicle_id, 'as_of', statement_timestamp(),
    'limitation', 'A photograph that shows a part is evidence that kind of part is on the car on that photograph''s day. It does not prove that the unit on the receipt is the unit fitted, and a part no photograph shows is not shown to be absent. Photographs of printed sheets carry no day.',
    'rule', 'Each current receipt part line is read for the part its words name. A photograph counts only when its reading names that same part (a part key or its own words), shows the assembled car, is taken on or after the receipt day, and is gallery-eligible and not sensitive. A line no rule names, or no reading matches, is not photographed unless a current answered visibility question for that line says visible in one of those photographs. An answer of not visible or cannot tell is counted (asked) but is never evidence of absence. Nothing is guessed from the car system alone.',
    'totals', jsonb_build_object(
      'part_lines', (SELECT count(*) FROM st),
      'lines_seen', (SELECT count(*) FROM st WHERE status = 'seen'),
      'lines_seen_in_prints_only', (SELECT count(*) FROM st WHERE status = 'seen_in_prints_only'),
      'lines_not_photographed', (SELECT count(*) FROM st WHERE status = 'not_photographed'),
      'lines_without_rule', (SELECT count(*) FROM st WHERE rule IS NULL),
      'lines_seen_by_answer', (SELECT count(*) FROM st WHERE has_answer),
      'lines_asked', (SELECT count(*) FROM st WHERE asked > 0),
      'photographs_read', (SELECT count(*) FROM rd)),
    'by_system', (SELECT coalesce(jsonb_agg(jsonb_build_object('system_key', g.system_key, 'part_lines', g.n, 'lines_seen', g.seen,
                    'lines_seen_in_prints_only', g.prints, 'lines_not_photographed', g.n - g.seen - g.prints)
                    ORDER BY g.n DESC, g.system_key), '[]'::jsonb)
                    FROM (SELECT system_key, count(*) AS n, count(*) FILTER (WHERE status = 'seen') AS seen,
                                 count(*) FILTER (WHERE status = 'seen_in_prints_only') AS prints FROM st GROUP BY system_key) g),
    'lines', (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'item_id', s.item_id, 'receipt_id', s.receipt_id, 'system_key', s.system_key, 'day', s.anchor_date,
                -- supplier text embeds list prices; they are dropped here and no amount is returned to anyone
                'description', nullif(left(btrim(public.text_redact_contact(
                    regexp_replace(s.description, ';? *\ylist *\$?[0-9][0-9,]*(\.[0-9]+)?', '', 'gi'))), 500), ''),
                'status', s.status, 'reason', s.reason, 'rule', s.rule,
                'match_basis', CASE WHEN s.rule IS NULL AND NOT s.has_answer THEN NULL
                                    ELSE concat_ws('; ', CASE WHEN s.rule IS NOT NULL THEN 'rule ' || s.rule || ': a photograph reading ' || s.basis || ' (part key or the reading''s own words), on or after the receipt day' END,
                                      CASE WHEN s.has_answer THEN 'answered question: a current answer says the part is visible in the cited photograph (answer quote shown)' END) END,
                'asked', s.asked, 'asked_not_visible', s.asked_no,
                'seen_images', s.dated_images + s.print_images, 'first_day', s.first_day, 'last_day', s.last_day, 'seen', s.seen)
                ORDER BY s.system_key, s.anchor_date NULLS LAST, s.item_id), '[]'::jsonb) FROM st s)) END
$$;
COMMENT ON FUNCTION public.vehicle_part_installation_evidence(uuid) IS
  'Per receipt part line of the vehicle, the photograph readings that show that specific part on the car (image, day, the reading''s own words, the rule that matched), from an ordered rule table. A line no rule names, or no reading matches, is not photographed, never guessed. Seen is evidence the part is on the car that day, not proof the receipt''s unit is the one fitted. No amounts. Null when the caller may not see the vehicle. Read-only.';

REVOKE ALL ON FUNCTION public.vehicle_part_installation_evidence(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.vehicle_part_installation_evidence(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.part_installation_rules() TO anon, authenticated, service_role;
