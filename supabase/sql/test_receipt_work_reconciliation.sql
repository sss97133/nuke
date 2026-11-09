-- Contract for 20261111210000_receipt_work_reconciliation (run on an empty disposable database after the migration's
-- dependencies are stubbed here; then \i the migration). Asserts: line kinds, zone second reading, frame zones, the
-- correlation's conclusions and cites, privacy filters (gate, sensitive, duplicate), the judgment queue and its rollback.
DO $$ BEGIN
  IF to_regclass('public.vehicles') IS NOT NULL THEN RAISE EXCEPTION 'Requires an empty disposable database'; END IF;
END $$;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.role', true), '') $$;
CREATE TABLE public.vehicles(id uuid PRIMARY KEY, user_id uuid, owner_id uuid);
CREATE TABLE public.vehicle_images(id uuid PRIMARY KEY, vehicle_id uuid, taken_at timestamptz, is_duplicate boolean, is_superseded boolean,
  is_sensitive boolean, vision_gate_status text, vehicle_zone text, apple_ml_labels text[], ai_scan_metadata jsonb, work_session_id uuid);
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY, vehicle_id uuid, session_date date);
CREATE TABLE public.timeline_events(id uuid PRIMARY KEY, vehicle_id uuid, event_date date);
CREATE TABLE public.receipts(id uuid PRIMARY KEY, user_id uuid, vendor_name text, document_kind text, receipt_date date,
  is_superseded boolean, duplicate_of uuid);
CREATE TABLE public.receipt_items(id uuid PRIMARY KEY, receipt_id uuid, line_number int, description text, part_number text,
  total_price numeric, line_date date, hours numeric, performer text);
CREATE TABLE public.receipt_vehicle_links(id uuid PRIMARY KEY, receipt_id uuid, vehicle_id uuid, user_id uuid, status text, basis text,
  confidence numeric, page_date date, page_date_source text, retired_at timestamptz);
CREATE TABLE public.garage_derivation_evidence(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL,
  CONSTRAINT garage_derivation_evidence_kind_check CHECK (kind IN ('scene_label')));
-- (after this point the migration is applied: \i supabase/migrations/20261111210000_receipt_work_reconciliation.sql)
DO $$
DECLARE r record; n int;
  V constant uuid := '00000000-0000-0000-0000-0000000000a1'; U constant uuid := '00000000-0000-0000-0000-0000000000b1';
BEGIN
  -- line kinds
  ASSERT receipt_line_kind('SHIPPING', '{SHIPPING}', 9.17, NULL, NULL, NULL) = 'charge';
  ASSERT receipt_line_kind('72-73 UNDERDASH WIRING HRNS (BACKORDERED, qty shipped 0)', 'FB20383', 0, NULL, NULL, NULL) = 'backordered';
  ASSERT receipt_line_kind('V8 DIPSTICK TUBE, STAINLESS (APE) ** KIT COMPONENT ** (no price)', NULL, NULL, NULL, NULL, NULL) = 'kit_component';
  ASSERT receipt_line_kind('Bore cylinders .060', NULL, NULL, NULL, '2024-11-13', NULL) = 'labor';
  ASSERT receipt_line_kind('70-76 SHAKER HOOD', '15136', 652.99, NULL, NULL, NULL) = 'part';
  ASSERT receipt_line_kind('70-73 TAIL LAMP HOUSING LH', 'F12330', 64.99, NULL, NULL, NULL) = 'part';
  -- zone second reading
  ASSERT receipt_line_photo_zone('70-81 CAM/FB/FS DR HNG-UPPR-LH') = 'exterior';
  ASSERT receipt_line_photo_zone('COMP CAMSHAFT KIT') = 'engine';
  ASSERT receipt_line_photo_zone('70-73 FBRD TAIL LAMP BEZEL LH') = 'exterior';
  ASSERT receipt_line_photo_zone('70-73 FBD TL LMP GSKT SET-4PCS (SET)') = 'exterior';
  ASSERT receipt_line_photo_zone('70-81 FBRD INST CLUSTER LENS (SET)') = 'dashboard';
  ASSERT receipt_line_photo_zone('70-77 FIREBIRD RADIO BEZEL') = 'dashboard';
  ASSERT receipt_line_photo_zone('72-73 DASH TO QTR HARNESS') = 'dashboard';
  ASSERT receipt_line_photo_zone('70-73 F-BODY RR SPKR SHLF PNL') = 'interior';
  ASSERT receipt_line_photo_zone('73-76 FIREBIRD RAD SUPPORT') = 'engine';
  ASSERT receipt_line_photo_zone('70-76 SHAKER HOOD') = 'exterior';
  ASSERT receipt_line_photo_zone('70-73 FIREBIRD REAR BUMPER') = 'exterior';
  ASSERT receipt_line_photo_zone('SHIPPING') IS NULL;
  ASSERT receipt_line_photo_zone('Power steering pump (Endurance 7023)') = 'engine';
  ASSERT receipt_line_photo_zone('Pitman arm — bolts onto sector shaft of steering box') = 'undercarriage';
  ASSERT receipt_line_photo_zone('QFS H882 build + P367 — custom in-tank pump') = 'undercarriage';
  ASSERT receipt_line_photo_zone('70-81 FBRD STEERING WHEEL') = 'dashboard';
  ASSERT receipt_line_photo_zone('Inner Rocker Panel, Extended-RH') = 'exterior';
  ASSERT receipt_line_photo_zone('ROLLER ROCKER ARM SET') = 'engine';
  ASSERT receipt_line_photo_zone('71-76 TA SHKR AIR CLNR VENT TB') = 'engine';
  ASSERT receipt_line_photo_zone('70-81 F-BODY DOOR SILL PLTE-RH') = 'interior';
  ASSERT receipt_line_photo_zone('70-81 FIREBIRD AM/FM KNOBS (SET)') = 'dashboard';
  ASSERT receipt_line_photo_zone('SEALED BEAM (SYL) 1Y; list 37.27') = 'exterior';
  ASSERT receipt_line_photo_zone('MINI BULB (SYL) 1Y BP; list 11.00') IS NULL;
  ASSERT receipt_line_kind('Core Return (ULT); Core Return. Original Invoice: 3565-277034', NULL, -20, NULL, NULL, NULL) = 'charge';
  ASSERT receipt_line_photo_zone('70-73 UNDER HOOD&TRNK FSTNRS (SET)') IS NULL;
  ASSERT receipt_line_photo_zone('69-81 BACK UP LAMP SWITCH MT') IS NULL;
  ASSERT receipt_line_photo_zone('73 455 MT EMISSION DECAL (PH)') = 'engine';
  ASSERT receipt_line_photo_zone('72-77 CAM/FB LWR DOOR PNL KIT') = 'interior';
  ASSERT receipt_line_photo_end('70-73 FIREBIRD REAR BUMPER') = 'rear';
  ASSERT receipt_line_photo_end('70-73 FB T/A FRT SPOILER KIT') = 'front';
  -- frame zones
  ASSERT image_photo_zones('engine_bay', NULL, NULL, NULL) = ARRAY['engine'];
  ASSERT image_photo_zones('exterior_side', NULL, NULL, ARRAY['tire','wheel']) = ARRAY['exterior'];
  ASSERT 'wheel' = ANY (image_photo_zones(NULL, 'wheel_fl', NULL, NULL));
  ASSERT image_photo_end('exterior_rear', NULL) = 'rear';
  ASSERT image_photo_zones('undercarriage', NULL, NULL, ARRAY['engine_vehicle','wheel']) = ARRAY['undercarriage'], 'labels do not override a placed frame';
  ASSERT image_photo_zones(NULL, NULL, NULL, ARRAY['Dashboard']) = ARRAY['dashboard'], 'labels read case-insensitively for an unplaced frame';

  -- correlation fixture: receipt 2025-01-10 (shaker hood, tail lamp, shipping, labor line); photos
  INSERT INTO vehicles VALUES (V, U, U);
  INSERT INTO receipts VALUES ('00000000-0000-0000-0000-0000000000c1', U, 'Classic Industries', 'parts_service', '2025-01-10', false, NULL),
                              ('00000000-0000-0000-0000-0000000000c2', U, 'Dup', 'parts_service', '2025-01-10', false, '00000000-0000-0000-0000-0000000000c1'),
                              ('00000000-0000-0000-0000-0000000000c3', U, 'Shop', 'parts_service', '2025-03-01', false, NULL);
  INSERT INTO receipt_items VALUES
    ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000c1', 1, '70-76 SHAKER HOOD', '15136', 652.99, NULL, NULL, NULL),
    ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000c1', 2, '70-73 FBRD TAIL LAMP LENS-LH', '5964663', 99.99, NULL, NULL, NULL),
    ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000c1', 3, 'SHIPPING', '{SHIPPING}', 9.17, NULL, NULL, NULL),
    ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000c1', 4, 'Install hood', NULL, NULL, '2025-02-01', NULL, NULL),
    ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000c1', 5, '70-81 FBRD INST CLUSTER LENS (SET)', 'F70813', 69.99, NULL, NULL, NULL),
    ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000c2', 1, '70-76 SHAKER HOOD', '15136', 652.99, NULL, NULL, NULL);
  INSERT INTO receipt_vehicle_links VALUES
    ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', V, U, 'linked', 'cited_document', 0.9, '2025-01-10', 'printed', NULL),
    ('00000000-0000-0000-0000-0000000000e2', '00000000-0000-0000-0000-0000000000c2', V, U, 'linked', 'cited_document', 0.9, '2025-01-10', 'printed', NULL),
    ('00000000-0000-0000-0000-0000000000e3', '00000000-0000-0000-0000-0000000000c3', V, U, 'linked', 'cited_document', 0.8, '2025-03-01', 'printed', NULL);
  INSERT INTO vehicle_images VALUES
    -- front exterior, in window (2025-02-01) -> hood candidate; also the labor day photo
    ('00000000-0000-0000-0000-0000000000f1', V, '2025-02-01 15:00Z', false, false, false, 'approved', NULL, NULL, '{"classification":{"v2":{"angle":{"value":"exterior_front"}}}}', NULL),
    -- rear exterior, after window (2025-09-01) -> tail lamp candidate, ranked first for a rear line
    ('00000000-0000-0000-0000-0000000000f2', V, '2025-09-01 15:00Z', false, false, false, 'approved', NULL, NULL, '{"classification":{"v2":{"angle":{"value":"exterior_rear"}}}}', NULL),
    -- personal frame: never cited
    ('00000000-0000-0000-0000-0000000000f3', V, '2025-01-12 15:00Z', false, false, false, 'rejected_personal', NULL, NULL, '{"classification":{"v2":{"angle":{"value":"exterior_front"}}}}', NULL),
    -- sensitive and duplicate frames: never cited
    ('00000000-0000-0000-0000-0000000000f4', V, '2025-01-12 15:00Z', false, false, true, 'approved', NULL, NULL, '{"classification":{"v2":{"angle":{"value":"exterior_front"}}}}', NULL),
    ('00000000-0000-0000-0000-0000000000f5', V, '2025-01-12 15:00Z', true, false, false, 'approved', NULL, NULL, '{"classification":{"v2":{"angle":{"value":"exterior_front"}}}}', NULL),
    -- an end-less exterior frame shot before the rear frame: a rear line still cites the rear frame first
    ('00000000-0000-0000-0000-0000000000f7', V, '2025-08-01 15:00Z', false, false, false, 'approved', NULL, NULL, '{"classification":{"v2":{"angle":{"value":"exterior_three_quarter"}}}}', NULL),
    -- a photo before the purchase is not after it
    ('00000000-0000-0000-0000-0000000000f6', V, '2024-12-01 15:00Z', false, false, false, 'approved', NULL, NULL, '{"classification":{"v2":{"angle":{"value":"interior_dashboard"}}}}', NULL);
  INSERT INTO work_sessions VALUES ('00000000-0000-0000-0000-000000000011', V, '2025-02-01');
  INSERT INTO timeline_events VALUES ('00000000-0000-0000-0000-000000000021', V, '2025-02-01');

  SELECT count(*) INTO n FROM receipt_work_lines(V);
  ASSERT n = 6, format('5 lines of c1 + line-less c3, duplicate receipt excluded; got %s', n);
  SELECT * INTO r FROM receipt_work_lines(V) x WHERE x.item_id = '00000000-0000-0000-0000-0000000000d1';
  ASSERT r.conclusion = 'install_window_photographed' AND r.judgment_needed, r.conclusion;
  ASSERT r.image_ids[1] = '00000000-0000-0000-0000-0000000000f1'::uuid AND cardinality(r.image_ids) = 2, r.image_ids::text;
  ASSERT r.days_to_first_photo = 22 AND r.work_session_ids = ARRAY['00000000-0000-0000-0000-000000000011'::uuid];
  ASSERT r.timeline_event_ids = ARRAY['00000000-0000-0000-0000-000000000021'::uuid];
  SELECT * INTO r FROM receipt_work_lines(V) x WHERE x.item_id = '00000000-0000-0000-0000-0000000000d2';
  ASSERT r.conclusion = 'photographed_after_window' AND r.image_ids = ARRAY['00000000-0000-0000-0000-0000000000f2'::uuid, '00000000-0000-0000-0000-0000000000f7'::uuid],
    'rear frame first, end-less frame next, front frame never: ' || r.conclusion || r.image_ids::text;
  ASSERT r.days_to_first_photo = 203;
  SELECT * INTO r FROM receipt_work_lines(V, 300) x WHERE x.item_id = '00000000-0000-0000-0000-0000000000d2';
  ASSERT r.conclusion = 'install_window_photographed', r.conclusion;
  SELECT * INTO r FROM receipt_work_lines(V) x WHERE x.item_id = '00000000-0000-0000-0000-0000000000d3';
  ASSERT r.conclusion = 'not_work_evidence' AND NOT r.judgment_needed;
  SELECT * INTO r FROM receipt_work_lines(V) x WHERE x.item_id = '00000000-0000-0000-0000-0000000000d4';
  ASSERT r.conclusion = 'work_day_photographed' AND r.anchor_date = '2025-02-01' AND r.anchor_source = 'line_date';
  SELECT * INTO r FROM receipt_work_lines(V) x WHERE x.item_id = '00000000-0000-0000-0000-0000000000d5';
  ASSERT r.conclusion = 'no_zone_photo_after_purchase', 'dash photo before purchase is not cited: ' || r.conclusion;
  SELECT * INTO r FROM receipt_work_lines(V) x WHERE x.receipt_id = '00000000-0000-0000-0000-0000000000c3';
  ASSERT r.item_id IS NULL AND r.line_kind = 'receipt' AND r.conclusion = 'receipt_day_unphotographed', r.conclusion;
  -- privacy: no excluded frame anywhere
  SELECT count(*) INTO n FROM receipt_work_lines(V) x, unnest(x.image_ids) i
   WHERE i IN ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f5');
  ASSERT n = 0, 'personal/sensitive/duplicate frame cited';

  -- evidence kind accepted
  INSERT INTO garage_derivation_evidence(kind) VALUES ('receipt_work_correlation');
  -- judgment queue + rollback
  INSERT INTO evidence_judgment_requests(department, question_kind, subject_table, subject_id, vehicle_id, user_id, params, answer_schema,
    producer_agent, producer_script, producer_version, run_id, dedupe_key)
  VALUES ('receipt_work_reconciliation', 'receipt_part_visible', 'receipt_items', '00000000-0000-0000-0000-0000000000d1', V, U, '{}', '{}',
    'injestion', 'scripts/receipt-work/reconcile-receipt-work.mjs', 'test', '00000000-0000-0000-0000-000000000099', 'k1');
  PERFORM set_config('test.role', 'service_role', true);
  SELECT count(*) INTO n FROM rollback_evidence_judgment_run('00000000-0000-0000-0000-000000000099', 'contract', true);
  ASSERT n = 1;
  SELECT count(*) INTO n FROM rollback_evidence_judgment_run('00000000-0000-0000-0000-000000000099', 'contract', false);
  ASSERT n = 1;
  ASSERT (SELECT status FROM evidence_judgment_requests WHERE dedupe_key = 'k1') = 'cancelled';
  RAISE NOTICE 'receipt_work_reconciliation contract: ok';
END $$;
