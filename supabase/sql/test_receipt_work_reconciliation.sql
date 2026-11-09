-- Contract for 20261111210000_receipt_work_reconciliation (run on an empty disposable database after the migration's
-- dependencies are stubbed here; then \i the migration). Asserts: line kinds, zone second reading, frame zones, the
-- correlation's conclusions and cites, privacy filters (gate, sensitive, redacted, duplicate, paperwork), printed claims kept
-- as testimony, withdrawn sources (removed line, superseded / duplicate receipt, retired link, last link), and the judgment
-- lifecycle: content identity, revive, retire (claimed and answered too), answer-time eligibility, privacy withdrawal after
-- an answer, correction with the same ids, rollback.
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
  is_sensitive boolean, vision_gate_status text, vehicle_zone text, apple_ml_labels text[], ai_scan_metadata jsonb, work_session_id uuid, is_document boolean,
  redaction_level text DEFAULT 'none');
CREATE TABLE public.work_sessions(id uuid PRIMARY KEY, vehicle_id uuid, session_date date);
CREATE TABLE public.timeline_events(id uuid PRIMARY KEY, vehicle_id uuid, event_date date);
CREATE TABLE public.receipts(id uuid PRIMARY KEY, user_id uuid, vendor_name text, document_kind text, receipt_date date,
  is_superseded boolean, duplicate_of uuid, source_document_table text, source_document_id uuid);
CREATE TABLE public.receipt_items(id uuid PRIMARY KEY, receipt_id uuid, line_number int, description text, part_number text,
  total_price numeric, line_date date, hours numeric, performer text);
CREATE TABLE public.receipt_vehicle_links(id uuid PRIMARY KEY, receipt_id uuid, vehicle_id uuid, user_id uuid, status text, basis text,
  confidence numeric, page_date date, page_date_source text, retired_at timestamptz);
CREATE TABLE public.garage_derivation_evidence(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL,
  vehicle_id uuid, user_id uuid, subject_key text, conclusion text, evidence jsonb, superseded_at timestamptz,
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
  -- a product screenshot and a document frame on the receipt day are not work photos
  INSERT INTO vehicle_images(id, vehicle_id, taken_at, is_duplicate, is_superseded, is_sensitive, vision_gate_status, ai_scan_metadata, is_document) VALUES
    ('00000000-0000-0000-0000-0000000000f8', V, '2025-03-01 15:00Z', false, false, false, 'approved', '{"byok_deep_analysis":{"scene_type":"product_screenshot"}}', false),
    ('00000000-0000-0000-0000-0000000000f9', V, '2025-03-01 15:00Z', false, false, false, 'approved', '{"classification":{"v2":{"angle":{"value":"exterior_front"}}}}', true);
  SELECT * INTO r FROM receipt_work_lines(V) x WHERE x.receipt_id = '00000000-0000-0000-0000-0000000000c3';
  ASSERT r.conclusion = 'receipt_day_unphotographed', 'screenshot/document counted as a work photo: ' || r.conclusion;
  -- a receipt linked by photo chronology gets no confidence credit for those same photos
  INSERT INTO receipts VALUES ('00000000-0000-0000-0000-0000000000c4', U, 'Parts store', 'parts_service', '2025-02-01', false, NULL);
  INSERT INTO receipt_vehicle_links VALUES
    ('00000000-0000-0000-0000-0000000000e4', '00000000-0000-0000-0000-0000000000c4', V, U, 'linked', 'chronology_session', 0.6, '2025-02-01', 'printed', NULL);
  SELECT * INTO r FROM receipt_work_lines(V) x WHERE x.receipt_id = '00000000-0000-0000-0000-0000000000c4';
  ASSERT r.conclusion = 'receipt_day_photographed' AND r.confidence = 0.18, r.conclusion || ' ' || r.confidence;
  -- every row is a proposed contextual relationship carrying its source lineage and custody
  SELECT * INTO r FROM receipt_work_lines(V) x WHERE x.item_id = '00000000-0000-0000-0000-0000000000d1';
  ASSERT r.relationship_status = 'proposed' AND r.reader_ineligible = '{}'::jsonb AND r.source_page IS NULL AND r.custodian_user_id = U, 'lineage/semantics';
  -- printed testimony is returned as printed (credit and zero hours, a blank performer, a future and a historical date);
  -- only reader eligibility is narrower: a date after tomorrow does not anchor
  INSERT INTO receipts VALUES ('00000000-0000-0000-0000-0000000000c5', U, 'Shop', 'parts_service', '2025-04-01', false, NULL, 'vehicle_documents', '00000000-0000-0000-0000-0000000000aa');
  INSERT INTO receipt_items VALUES
    ('00000000-0000-0000-0000-0000000000d7', '00000000-0000-0000-0000-0000000000c5', 1, 'Labor: install', NULL, 120, '2999-01-01', -2, '  '),
    ('00000000-0000-0000-0000-0000000000d8', '00000000-0000-0000-0000-0000000000c5', 2, 'Labor: align', NULL, 90, '1899-05-01', 0, 'Atomic Motors');
  INSERT INTO receipt_vehicle_links VALUES
    ('00000000-0000-0000-0000-0000000000e5', '00000000-0000-0000-0000-0000000000c5', V, U, 'linked', 'cited_document', 0.9, NULL, NULL, NULL);
  SELECT * INTO r FROM receipt_work_lines(V) x WHERE x.item_id = '00000000-0000-0000-0000-0000000000d7';
  ASSERT r.printed_line_date = '2999-01-01' AND r.printed_hours = -2 AND r.printed_performer = '  ', 'credit hours / blank performer kept as printed';
  ASSERT r.reader_ineligible = '{"line_date": "after_today"}'::jsonb, r.reader_ineligible::text;
  ASSERT r.anchor_date = '2025-04-01' AND r.anchor_source = 'receipt_date', 'a date after tomorrow does not anchor';
  ASSERT r.line_kind = 'labor', 'printed (credit) hours make a labor line: ' || r.line_kind;
  ASSERT r.source_document_table = 'vehicle_documents' AND r.source_document_id = '00000000-0000-0000-0000-0000000000aa';
  SELECT * INTO r FROM receipt_work_lines(V) x WHERE x.item_id = '00000000-0000-0000-0000-0000000000d8';
  ASSERT r.printed_hours = 0 AND r.printed_performer = 'Atomic Motors' AND r.printed_line_date = '1899-05-01' AND r.reader_ineligible = '{}'::jsonb;
  ASSERT r.line_kind = 'labor' AND r.anchor_date = '1899-05-01' AND r.anchor_source = 'line_date', 'historical dates and zero hours are testimony';
  -- privacy: no excluded frame anywhere (gate, sensitive, duplicate, screenshot, document, redacted)
  INSERT INTO vehicle_images(id, vehicle_id, taken_at, is_duplicate, is_superseded, is_sensitive, vision_gate_status, ai_scan_metadata, is_document, redaction_level) VALUES
    ('00000000-0000-0000-0000-0000000000fa', V, '2025-02-01 16:00Z', false, false, false, 'approved', '{"classification":{"v2":{"angle":{"value":"exterior_front"}}}}', false, 'full_blur');
  SELECT count(*) INTO n FROM receipt_work_lines(V) x, unnest(x.image_ids) i
   WHERE i IN ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000f5',
               '00000000-0000-0000-0000-0000000000f8', '00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000fa');
  ASSERT n = 0, 'personal/sensitive/duplicate/screenshot/document/redacted frame cited';

  -- withdrawn sources: active conclusions whose line, receipt or link went away are listed with why
  INSERT INTO receipts VALUES ('00000000-0000-0000-0000-0000000000c6', U, 'Superseded', 'parts_service', '2025-01-10', true, NULL),
                              ('00000000-0000-0000-0000-0000000000c8', U, 'Retired link', 'parts_service', '2025-01-10', false, NULL);
  INSERT INTO receipt_items VALUES
    ('00000000-0000-0000-0000-000000000d61', '00000000-0000-0000-0000-0000000000c6', 1, '70-76 SHAKER HOOD', '15136', 652.99, NULL, NULL, NULL),
    ('00000000-0000-0000-0000-000000000d81', '00000000-0000-0000-0000-0000000000c8', 1, '70-76 SHAKER HOOD', '15136', 652.99, NULL, NULL, NULL);
  INSERT INTO receipt_vehicle_links VALUES
    ('00000000-0000-0000-0000-0000000000e6', '00000000-0000-0000-0000-0000000000c6', V, U, 'linked', 'cited_document', 0.9, NULL, NULL, NULL),
    ('00000000-0000-0000-0000-0000000000e8', '00000000-0000-0000-0000-0000000000c8', V, U, 'linked', 'cited_document', 0.9, NULL, NULL, now());
  INSERT INTO garage_derivation_evidence(kind, vehicle_id, user_id, subject_key, conclusion, evidence) VALUES
    ('receipt_work_correlation', V, U, 'receipt_item:00000000-0000-0000-0000-0000000000d1', 'install_window_photographed',
       '{"receipt_id": "00000000-0000-0000-0000-0000000000c1", "item_id": "00000000-0000-0000-0000-0000000000d1"}'),
    ('receipt_work_correlation', V, U, 'receipt_item:00000000-0000-0000-0000-00000000dead', 'part_zone_unknown',
       '{"receipt_id": "00000000-0000-0000-0000-0000000000c1", "item_id": "00000000-0000-0000-0000-00000000dead"}'),
    ('receipt_work_correlation', V, U, 'receipt_item:00000000-0000-0000-0000-000000000d61', 'photographed_after_window',
       '{"receipt_id": "00000000-0000-0000-0000-0000000000c6", "item_id": "00000000-0000-0000-0000-000000000d61"}'),
    ('receipt_work_correlation', V, U, 'receipt_item:00000000-0000-0000-0000-0000000000d6', 'photographed_after_window',
       '{"receipt_id": "00000000-0000-0000-0000-0000000000c2", "item_id": "00000000-0000-0000-0000-0000000000d6"}'),
    ('receipt_work_correlation', V, U, 'receipt_item:00000000-0000-0000-0000-000000000d81', 'photographed_after_window',
       '{"receipt_id": "00000000-0000-0000-0000-0000000000c8", "item_id": "00000000-0000-0000-0000-000000000d81"}'),
    ('receipt_work_correlation', V, U, 'receipt_item:00000000-0000-0000-0000-00000000beef', 'source_withdrawn',
       '{"receipt_id": "00000000-0000-0000-0000-0000000000c1", "item_id": "00000000-0000-0000-0000-00000000beef"}');
  ASSERT (SELECT count(*) FROM receipt_work_withdrawals(V)) = 4, 'current subject and an existing retraction are not listed';
  ASSERT (SELECT reason FROM receipt_work_withdrawals(V) w WHERE w.item_id = '00000000-0000-0000-0000-00000000dead') = 'line_removed';
  ASSERT (SELECT reason FROM receipt_work_withdrawals(V) w WHERE w.item_id = '00000000-0000-0000-0000-000000000d61') = 'receipt_superseded';
  ASSERT (SELECT reason FROM receipt_work_withdrawals(V) w WHERE w.item_id = '00000000-0000-0000-0000-0000000000d6') = 'receipt_duplicate';
  ASSERT (SELECT reason FROM receipt_work_withdrawals(V) w WHERE w.item_id = '00000000-0000-0000-0000-000000000d81') = 'link_retired';
  -- the last link of a vehicle retired: the vehicle returns no lines but its old conclusion is still listed for retraction
  INSERT INTO vehicles VALUES ('00000000-0000-0000-0000-0000000000a2', U, U);
  INSERT INTO receipt_vehicle_links VALUES
    ('00000000-0000-0000-0000-0000000000e9', '00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a2', U, 'linked', 'cited_document', 0.9, NULL, NULL, now());
  INSERT INTO garage_derivation_evidence(kind, vehicle_id, user_id, subject_key, conclusion, evidence) VALUES
    ('receipt_work_correlation', '00000000-0000-0000-0000-0000000000a2', U, 'receipt_item:00000000-0000-0000-0000-0000000000d1', 'part_zone_unknown',
       '{"receipt_id": "00000000-0000-0000-0000-0000000000c1", "item_id": "00000000-0000-0000-0000-0000000000d1"}');
  ASSERT (SELECT count(*) FROM receipt_work_lines('00000000-0000-0000-0000-0000000000a2')) = 0;
  ASSERT (SELECT reason FROM receipt_work_withdrawals('00000000-0000-0000-0000-0000000000a2')) = 'link_retired', 'last link retired';

  -- evidence kind accepted
  INSERT INTO garage_derivation_evidence(kind) VALUES ('receipt_work_correlation');

  PERFORM set_config('test.role', 'service_role', true);
  -- legacy: a request cancelled by a run before lifecycle was recorded re-opens when that run is rolled back
  INSERT INTO evidence_judgment_requests(department, question_kind, subject_table, subject_id, vehicle_id, user_id, params, answer_schema,
    producer_agent, producer_script, producer_version, run_id, dedupe_key, status, cancelled_at, cancelled_reason, cancelled_by_run_id)
  VALUES ('receipt_work_reconciliation', 'receipt_part_visible', 'receipt_items', '00000000-0000-0000-0000-0000000000d1', V, U, '{}', '{}',
    'injestion', 'scripts/receipt-work/reconcile-receipt-work.mjs', 'test', '00000000-0000-0000-0000-000000000098', 'k2',
    'cancelled', now(), 'stale', '00000000-0000-0000-0000-000000000097');
  SELECT count(*) INTO n FROM rollback_evidence_judgment_run('00000000-0000-0000-0000-000000000097', 'contract', false);
  ASSERT n = 1;
  ASSERT (SELECT status FROM evidence_judgment_requests WHERE dedupe_key = 'k2') = 'pending';

  RAISE NOTICE 'receipt_work_reconciliation contract (reader, withdrawals): ok';
END $$;

-- the judgment lifecycle on real questions about line d1 (frames f1, f2)
DO $$
DECLARE n int; st text; P jsonb; row1 jsonb; row2 jsonb; row3 jsonb; a record; q1 uuid; q2 uuid; q3 uuid;
  V constant uuid := '00000000-0000-0000-0000-0000000000a1'; U constant uuid := '00000000-0000-0000-0000-0000000000b1';
  D1 constant uuid := '00000000-0000-0000-0000-0000000000d1';
  F1 constant text := '00000000-0000-0000-0000-0000000000f1'; F2 constant text := '00000000-0000-0000-0000-0000000000f2';
  R1 constant uuid := '00000000-0000-0000-0000-0000000001a1'; R2 constant uuid := '00000000-0000-0000-0000-0000000001a2';
  R3 constant uuid := '00000000-0000-0000-0000-0000000001a3'; R4 constant uuid := '00000000-0000-0000-0000-0000000001a4';
  R5 constant uuid := '00000000-0000-0000-0000-0000000001a5'; R6 constant uuid := '00000000-0000-0000-0000-0000000001a6';
  R7 constant uuid := '00000000-0000-0000-0000-0000000001a7'; R8 constant uuid := '00000000-0000-0000-0000-0000000001a8';
  GOOD constant jsonb := '{"visible": "yes", "installed": "yes", "confidence": 0.8, "image_id": "00000000-0000-0000-0000-0000000000f1", "bbox": [100, 120, 400, 380], "quote": "hood scoop on the car"}';
BEGIN
  PERFORM set_config('test.role', 'service_role', true);
  P := jsonb_build_object('receipt_item_id', D1, 'receipt_id', '00000000-0000-0000-0000-0000000000c1', 'description', '70-76 SHAKER HOOD',
         'part_number', '15136', 'total_price', 652.99, 'printed_claims', jsonb_build_object('line_date', NULL, 'hours', NULL, 'performer', NULL),
         'candidate_image_ids', jsonb_build_array(F1, F2));
  row1 := jsonb_build_object('department', 'receipt_work_reconciliation', 'question_kind', 'receipt_part_visible', 'subject_table', 'receipt_items',
         'subject_id', D1, 'vehicle_id', V, 'user_id', U, 'params', P, 'answer_schema', '{}'::jsonb, 'priority', 653, 'producer_agent', 'injestion',
         'producer_script', 'scripts/receipt-work/reconcile-receipt-work.mjs', 'producer_version', 'test', 'dedupe_key', 'q-hood-1', 'question_hash', 'h1');
  -- raise: new content inserted; identical content unchanged
  SELECT * INTO a FROM raise_evidence_judgment(row1, R1);
  ASSERT a.action = 'inserted' AND a.status = 'pending', a.action; q1 := a.id;
  SELECT * INTO a FROM raise_evidence_judgment(row1, R2);
  ASSERT a.action = 'unchanged' AND a.id = q1;
  ASSERT cardinality(evidence_judgment_ineligibility(q1)) = 0, evidence_judgment_ineligibility(q1)::text;
  -- claim: the eligible question only (k2 has no source); a fresh claim is not re-claimed
  SELECT count(*) INTO n FROM claim_evidence_judgments('receipt_work_reconciliation', 'receipt_part_visible', 10, 'worker-a');
  ASSERT n = 1, 'only the eligible question is claimed: ' || n;
  SELECT count(*) INTO n FROM claim_evidence_judgments('receipt_work_reconciliation', 'receipt_part_visible', 10, 'worker-b');
  ASSERT n = 0, 'a fresh claim is not re-claimed';
  -- malformed answers and non-holders are refused
  BEGIN
    PERFORM answer_evidence_judgment(q1, 'worker-a',
      '{"visible": "yes", "installed": "maybe", "confidence": 1.4, "image_id": "00000000-0000-0000-0000-0000000000f7", "bbox": [5, 5, 1, 1]}', 'agent', 'model', 'v1');
    RAISE EXCEPTION 'malformed answer accepted';
  EXCEPTION WHEN invalid_parameter_value THEN
    ASSERT SQLERRM LIKE '%installed must be%' AND SQLERRM LIKE '%confidence must be within%' AND SQLERRM LIKE '%candidate_image_ids%' AND SQLERRM LIKE '%bbox must be%', SQLERRM;
  END;
  BEGIN
    PERFORM answer_evidence_judgment(q1, 'worker-b', '{"visible": "no", "installed": "cannot_tell", "confidence": 0.5}', 'agent', 'model', 'v1');
    RAISE EXCEPTION 'answer by a non-holder accepted';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN NULL;
  END;
  -- withdrawals while claimed refuse the answer: a frame made private, the link retired, the receipt superseded
  UPDATE vehicle_images SET is_sensitive = true WHERE id = F2::uuid;
  BEGIN
    PERFORM answer_evidence_judgment(q1, 'worker-a', GOOD, 'agent', 'model', 'v1');
    RAISE EXCEPTION 'answer accepted after a privacy withdrawal';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN ASSERT SQLERRM LIKE '%frame_ineligible:' || F2 || '%', SQLERRM;
  END;
  UPDATE vehicle_images SET is_sensitive = false WHERE id = F2::uuid;
  UPDATE receipt_vehicle_links SET retired_at = now() WHERE id = '00000000-0000-0000-0000-0000000000e1';
  BEGIN
    PERFORM answer_evidence_judgment(q1, 'worker-a', GOOD, 'agent', 'model', 'v1');
    RAISE EXCEPTION 'answer accepted after the link was retired';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN ASSERT SQLERRM LIKE '%link_retired%', SQLERRM;
  END;
  UPDATE receipt_vehicle_links SET retired_at = NULL WHERE id = '00000000-0000-0000-0000-0000000000e1';
  UPDATE receipts SET is_superseded = true WHERE id = '00000000-0000-0000-0000-0000000000c1';
  BEGIN
    PERFORM answer_evidence_judgment(q1, 'worker-a', GOOD, 'agent', 'model', 'v1');
    RAISE EXCEPTION 'answer accepted after the receipt was superseded';
  EXCEPTION WHEN object_not_in_prerequisite_state THEN ASSERT SQLERRM LIKE '%receipt_superseded%', SQLERRM;
  END;
  UPDATE receipts SET is_superseded = false WHERE id = '00000000-0000-0000-0000-0000000000c1';
  PERFORM answer_evidence_judgment(q1, 'worker-a', GOOD, 'agent', 'model', 'v1');
  ASSERT (SELECT status FROM evidence_judgment_requests WHERE id = q1) = 'answered';
  -- privacy withdrawal after the answer: retired as withdrawn, the answer kept, not claimable
  UPDATE vehicle_images SET is_sensitive = true WHERE id = F2::uuid;
  ASSERT evidence_judgment_ineligibility(q1) = ARRAY['frame_ineligible:' || F2];
  ASSERT retire_evidence_judgment(q1, R3, 'frame_withdrawn', 'f2 made private') = 'withdrawn';
  ASSERT (SELECT status = 'withdrawn' AND answer ->> 'quote' = 'hood scoop on the car' AND retire_kind = 'frame_withdrawn'
            AND lifecycle -> -1 ->> 'from' = 'answered' FROM evidence_judgment_requests WHERE id = q1), 'withdrawn keeps the answer';
  ASSERT retire_evidence_judgment(q1, R3, 'frame_withdrawn', 'again') = 'unchanged';
  SELECT count(*) INTO n FROM claim_evidence_judgments('receipt_work_reconciliation', 'receipt_part_visible', 10, 'worker-c');
  ASSERT n = 0, 'a withdrawn question is not claimable';
  -- eligible again and re-asked with identical content: the answer revives; rolling that run back withdraws it again
  UPDATE vehicle_images SET is_sensitive = false WHERE id = F2::uuid;
  SELECT * INTO a FROM raise_evidence_judgment(row1, R4);
  ASSERT a.action = 'revived' AND a.status = 'answered', a.action || a.status;
  SELECT count(*) INTO n FROM rollback_evidence_judgment_run(R4, 'contract', false) x WHERE x.action = 'reverted' AND x.to_status = 'withdrawn';
  ASSERT n = 1 AND (SELECT status FROM evidence_judgment_requests WHERE id = q1) = 'withdrawn';
  SELECT x.action INTO st FROM rollback_evidence_judgment_run(R3, 'contract', true) x WHERE x.id = q1;
  ASSERT st = 'skipped_later_activity', st;

  -- changed content (other frames) is a different question; claimed then no longer asked -> cancelled; re-asked -> revived
  row2 := row1 || jsonb_build_object('params', P || jsonb_build_object('candidate_image_ids', jsonb_build_array(F1)), 'dedupe_key', 'q-hood-2', 'question_hash', 'h2');
  SELECT * INTO a FROM raise_evidence_judgment(row2, R5);
  ASSERT a.action = 'inserted'; q2 := a.id;
  SELECT count(*) INTO n FROM claim_evidence_judgments('receipt_work_reconciliation', 'receipt_part_visible', 10, 'worker-d');
  ASSERT n = 1 AND (SELECT status FROM evidence_judgment_requests WHERE id = q2) = 'claimed';
  ASSERT retire_evidence_judgment(q2, R6, 'not_asked', 'conclusion no longer needs a judgment') = 'cancelled', 'a claimed question is retired too';
  SELECT * INTO a FROM raise_evidence_judgment(row2, R7);
  ASSERT a.action = 'revived' AND a.status = 'pending' AND (SELECT claimed_by IS NULL AND cancelled_at IS NULL FROM evidence_judgment_requests WHERE id = q2);

  -- correction with the same ids: the old question becomes ineligible and is superseded by a new one that inherits no answer
  UPDATE receipt_items SET description = '70-76 SHAKER HOOD (RAM AIR)', part_number = '15137' WHERE id = D1;
  ASSERT 'line_changed' = ANY (evidence_judgment_ineligibility(q2)), evidence_judgment_ineligibility(q2)::text;
  SELECT count(*) INTO n FROM claim_evidence_judgments('receipt_work_reconciliation', 'receipt_part_visible', 10, 'worker-e');
  ASSERT n = 0, 'a question about the old content is not claimable';
  row3 := row1 || jsonb_build_object('params', P || jsonb_build_object('description', '70-76 SHAKER HOOD (RAM AIR)', 'part_number', '15137'),
                                     'dedupe_key', 'q-hood-3', 'question_hash', 'h3');
  SELECT * INTO a FROM raise_evidence_judgment(row3, R8);
  ASSERT a.action = 'inserted' AND a.status = 'pending'; q3 := a.id;
  ASSERT retire_evidence_judgment(q2, R8, 'content_changed', 'line corrected', q3) = 'cancelled';
  ASSERT (SELECT superseded_by = q3 AND retire_kind = 'content_changed' FROM evidence_judgment_requests WHERE id = q2);
  ASSERT (SELECT answer IS NULL AND answer_history = '[]'::jsonb FROM evidence_judgment_requests WHERE id = q3), 'no inherited answer';
  ASSERT cardinality(evidence_judgment_ineligibility(q3)) = 0, evidence_judgment_ineligibility(q3)::text;
  -- a printed-date correction with the same ids also retires the question's eligibility
  UPDATE receipt_items SET line_date = '2025-01-11' WHERE id = D1;
  ASSERT 'line_changed' = ANY (evidence_judgment_ineligibility(q3));
  UPDATE receipt_items SET line_date = NULL WHERE id = D1;
  -- a removed line
  UPDATE receipt_items SET id = '00000000-0000-0000-0000-00000000d1d1' WHERE id = D1;
  ASSERT 'line_removed' = ANY (evidence_judgment_ineligibility(q3));
  UPDATE receipt_items SET id = D1 WHERE id = '00000000-0000-0000-0000-00000000d1d1';
  -- rolling back R8: its new question is retired and the question it superseded goes back to pending
  SELECT count(*) INTO n FROM rollback_evidence_judgment_run(R8, 'contract', false);
  ASSERT n = 2, 'R8 touched two questions: ' || n;
  ASSERT (SELECT status FROM evidence_judgment_requests WHERE id = q3) = 'cancelled';
  ASSERT (SELECT status = 'pending' AND superseded_by IS NULL FROM evidence_judgment_requests WHERE id = q2);

  -- reopen an answering version: the withdrawn answer moves to history
  SELECT count(*) INTO n FROM reopen_evidence_judgment_answers('v1', 'contract', false);
  ASSERT n = 1;
  ASSERT (SELECT status = 'cancelled' AND answer IS NULL AND jsonb_array_length(answer_history) = 1
                 AND answer_history -> 0 -> 'answer' ->> 'quote' = 'hood scoop on the car'
            FROM evidence_judgment_requests WHERE id = q1), 'reopen keeps the prior answer in history';
  SELECT x.action INTO st FROM rollback_evidence_judgment_run(R1, 'contract', true) x WHERE x.id = q1;
  ASSERT st = 'already_retired', st;
  RAISE NOTICE 'receipt_work_reconciliation contract: ok';
END $$;
