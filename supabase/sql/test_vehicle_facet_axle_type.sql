-- Disposable PG17: the drivetrain panel's axle type item reads the shop paper and the photo readings already on file
-- (facet_axle_type_v1) through vehicle_axle_type_evidence. Reuses the facet fixture, adds receipt, image and reading
-- fixtures behind tables and views, and proves: posi wording is a claim (limited-slip); a lube-tag photo reading is a
-- reading with the replaceable-tag limitation; paper plus a photo are two sources and meet the reader's own rule
-- (distinct sources, distinct readers) so the item is established, while two photos of one reader stay a reading;
-- "open diff" wording reads open; superseded, duplicate, retired-link, other-system, part-number, negated and
-- ambiguous lines and a reader's notes are ignored; a record value that says the same agrees instead of conflicting;
-- a private car shows nothing to anon; no amounts, performers or contacts in the item; the patch applies once.
-- Every fixture is synthetic.
\set ON_ERROR_STOP on
\ir test_vehicle_facet_items.sql
RESET ROLE;

-- Dependencies of the helper: receipts and their links and lines (fixture tables behind views), the public image
-- view and its gallery test (the view the live reader joins; the fixture's reader predates it), and the live
-- receipt_line_kind. receipt_line_system and text_redact_contact are stubs for the words this contract uses.
CREATE FUNCTION public.text_redact_contact(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT regexp_replace(p, '[0-9]{3}-[0-9]{3}-[0-9]{4}', '[redacted]', 'g') $$;
CREATE FUNCTION public.receipt_line_system(p text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN lower(p) ~ 'brake' THEN 'brakes'
              WHEN lower(p) ~ '(rear end|axle|axel|differential|\ydiff\y|posi|limited slip|locker)' THEN 'axle' END $$;
CREATE FUNCTION public.receipt_line_kind(p_description text, p_part_number text, p_total numeric, p_hours numeric, p_line_date date, p_performer text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN d ~* '\m(shipping|freight|handling|delivery|sales tax|tax|discount|coupon|core charge|core exchange|core return|return|deposit|payment|surcharge|fee|subtotal|total)\M'
         OR coalesce(p_part_number, '') ~* '^\{?(shipping|freight|tax|handling)\}?$' THEN 'charge'
    WHEN d ~* 'back[- ]?order' OR d ~* 'qty shipped 0' THEN 'backordered'
    WHEN d ~* 'kit component' THEN 'kit_component'
    WHEN p_hours IS NOT NULL OR nullif(btrim(coalesce(p_performer, '')), '') IS NOT NULL
         OR (p_part_number IS NULL AND p_total IS NULL AND p_line_date IS NOT NULL) THEN 'labor'
    WHEN p_part_number IS NULL AND p_total IS NULL THEN 'note'
    ELSE 'part' END
  FROM (SELECT coalesce(p_description, '') AS d) s $$;
CREATE VIEW public.vehicle_images_public WITH (security_invoker = true) AS
  SELECT i.*, false AS is_document, NULL::uuid AS superseded_by FROM public.vehicle_images i;
CREATE FUNCTION public.vehicle_image_gallery_eligible(public.vehicle_images_public) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT true $$;
GRANT SELECT ON public.vehicle_images_public TO anon, authenticated, service_role;

ALTER TABLE public.vehicle_observations ADD COLUMN IF NOT EXISTS superseded_by uuid;
CREATE TABLE public.fixture_receipts (id uuid PRIMARY KEY, vendor_name text, receipt_date date, is_superseded boolean, duplicate_of uuid);
CREATE TABLE public.fixture_links (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), receipt_id uuid, vehicle_id uuid, status text, retired_at timestamptz, page_date date);
CREATE TABLE public.fixture_items (id uuid PRIMARY KEY, receipt_id uuid, description text, part_number text, total_price numeric,
  line_date date, hours numeric, performer text);
CREATE VIEW public.receipts AS SELECT * FROM public.fixture_receipts;
CREATE VIEW public.receipt_vehicle_links AS SELECT * FROM public.fixture_links;
CREATE VIEW public.receipt_items AS SELECT * FROM public.fixture_items;

-- Cars: 7 paper only, 8 two photos, 9 paper and a photo, a open wording, b lines that must be ignored,
-- c a reader's notes only, d record agrees with paper, e record text no words recognise, f a sensitive photo.
INSERT INTO public.vehicles (id, year, make, model) VALUES
 ('10000000-0000-0000-0000-000000000007', 1973, 'Synthetic', 'Coupe'),
 ('10000000-0000-0000-0000-000000000008', 1973, 'Synthetic', 'Coupe'),
 ('10000000-0000-0000-0000-000000000009', 1973, 'Synthetic', 'Coupe'),
 ('10000000-0000-0000-0000-00000000000a', 1973, 'Synthetic', 'Coupe'),
 ('10000000-0000-0000-0000-00000000000b', 1973, 'Synthetic', 'Coupe'),
 ('10000000-0000-0000-0000-00000000000c', 1973, 'Synthetic', 'Coupe'),
 ('10000000-0000-0000-0000-00000000000f', 1973, 'Synthetic', 'Coupe');
INSERT INTO public.vehicles (id, year, make, model, rear_axle_type) VALUES
 ('10000000-0000-0000-0000-00000000000d', 1973, 'Synthetic', 'Coupe', 'Posi'),
 ('10000000-0000-0000-0000-00000000000e', 1973, 'Synthetic', 'Coupe', '10-bolt');

INSERT INTO public.fixture_receipts VALUES
 ('c0000000-0000-0000-0000-000000000001', 'Fixture Axle Shop', '2025-02-05', false, NULL),
 ('c0000000-0000-0000-0000-000000000002', 'Second Axle Shop', '2025-03-01', false, NULL),
 ('c0000000-0000-0000-0000-000000000003', 'Old Shop', '2024-01-01', true, NULL),
 ('c0000000-0000-0000-0000-000000000004', 'Retired Shop', '2024-01-01', false, NULL),
 ('c0000000-0000-0000-0000-000000000005', 'Duplicate Shop', '2024-01-01', false, 'c0000000-0000-0000-0000-000000000001'),
 ('c0000000-0000-0000-0000-000000000006', 'Private Car Shop', '2024-01-01', false, NULL),
 ('c0000000-0000-0000-0000-000000000007', 'Mixed Lines Shop', '2025-04-01', false, NULL);
INSERT INTO public.fixture_links (receipt_id, vehicle_id, status, retired_at, page_date) VALUES
 ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000007', 'linked', NULL, NULL),
 ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000009', 'linked', NULL, NULL),
 ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000d', 'linked', NULL, NULL),
 ('c0000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-00000000000a', 'linked', NULL, NULL),
 ('c0000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-00000000000b', 'linked', NULL, NULL),
 ('c0000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-00000000000b', 'linked', now(), NULL),
 ('c0000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-00000000000b', 'linked', NULL, NULL),
 ('c0000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000004', 'linked', NULL, NULL),
 ('c0000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-00000000000b', 'linked', NULL, NULL);
INSERT INTO public.fixture_items VALUES
 -- The live shape: a "part" kind row (a total, no part number, no hours) whose words are repair work.
 ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001',
  'CHECK AND REPAIR REAR END POSI RING PINION BEARING AND AXELS; CUSTOMER SUPPLIED PARTS $245.00 call 702-555-0100', NULL, 123.45, NULL, NULL, 'Staff Name'),
 ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', 'Open diff rear end, install new carrier bearings', NULL, NULL, '2025-03-02', 2, NULL),
 -- Excluded receipts: superseded, retired link, duplicate (their lines name a unit, but are not current).
 ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000003', 'Rebuild posi differential', NULL, NULL, '2024-01-02', 1, NULL),
 ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000004', 'Rebuild posi differential', NULL, NULL, '2024-01-02', 1, NULL),
 ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000005', 'Rebuild posi differential', NULL, NULL, '2024-01-02', 1, NULL),
 ('d0000000-0000-0000-0000-000000000006', 'c0000000-0000-0000-0000-000000000006', 'Rebuild posi differential', NULL, NULL, '2024-01-02', 1, NULL),
 -- Lines of a current receipt that must not speak: other system, a bought part, a negated unit, two types at once.
 ('d0000000-0000-0000-0000-000000000007', 'c0000000-0000-0000-0000-000000000007', 'Brake job, use limited slip lube', NULL, NULL, '2025-04-02', 1, NULL),
 ('d0000000-0000-0000-0000-000000000008', 'c0000000-0000-0000-0000-000000000007', 'Posi unit 3.73', 'PN-POSI-1', 400, NULL, NULL, NULL),
 ('d0000000-0000-0000-0000-000000000009', 'c0000000-0000-0000-0000-000000000007', 'Rear end, non-posi, repair carrier', NULL, NULL, '2025-04-02', 1, NULL),
 ('d0000000-0000-0000-0000-00000000000a', 'c0000000-0000-0000-0000-000000000007', 'Convert open diff to posi, rear end', NULL, NULL, '2025-04-02', 3, NULL),
 -- "open" as the verb.
 ('d0000000-0000-0000-0000-00000000000b', 'c0000000-0000-0000-0000-000000000007', 'OPEN DIFFERENTIAL COVER AND INSPECT', NULL, NULL, '2025-04-02', 1, NULL),
 ('d0000000-0000-0000-0000-00000000000c', 'c0000000-0000-0000-0000-000000000007', 'OPEN DIFF, INSPECT RING AND PINION', NULL, NULL, '2025-04-02', 1, NULL),
 ('d0000000-0000-0000-0000-00000000000d', 'c0000000-0000-0000-0000-000000000007', 'OPEN REAR END, INSPECT', NULL, NULL, '2025-04-02', 1, NULL);
-- The same receipt number links car d too (the paper names no other car).

INSERT INTO public.vehicle_images (id, vehicle_id, taken_at, is_sensitive) VALUES
 ('51000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000008', '2026-10-28T17:07:08Z', false),
 ('51000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000008', '2026-10-28T17:07:04Z', false),
 ('51000000-0000-0000-0000-0000000000a3', '10000000-0000-0000-0000-000000000009', '2026-10-28T17:07:04Z', false),
 ('51000000-0000-0000-0000-0000000000a4', '10000000-0000-0000-0000-00000000000c', '2026-10-28T17:07:04Z', false),
 ('51000000-0000-0000-0000-0000000000a5', '10000000-0000-0000-0000-000000000004', '2026-10-28T17:07:04Z', false),
 ('51000000-0000-0000-0000-0000000000a6', '10000000-0000-0000-0000-00000000000f', '2026-10-28T17:07:04Z', true),
 ('51000000-0000-0000-0000-0000000000a7', '10000000-0000-0000-0000-00000000000b', '2026-10-28T17:07:04Z', false),
 ('51000000-0000-0000-0000-0000000000a8', '10000000-0000-0000-0000-00000000000b', '2026-10-28T17:07:04Z', false),
 ('51000000-0000-0000-0000-0000000000a9', '10000000-0000-0000-0000-00000000000b', '2026-10-28T17:07:04Z', false);

INSERT INTO public.vehicle_observations (id, vehicle_id, kind, extraction_method, observed_at, structured_data) VALUES
 -- Car 8: the tag text on one image, a component label on the other.
 ('62000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000008', 'condition', 'reviewed_image_analysis_v1', '2026-11-10T12:00Z',
  '{"image_id":"51000000-0000-0000-0000-0000000000a1","text_regions":[{"text":"USE LIMITED\nSLIP DIFF.\nLUBE ONLY","confidence":0.99},{"text":"EWF"}],"components_seen":[{"label":"Bolted rear differential cover"}]}'),
 ('62000000-0000-0000-0000-0000000000b2', '10000000-0000-0000-0000-000000000008', 'condition', 'reviewed_image_analysis_v1', '2026-11-10T12:00Z',
  '{"image_id":"51000000-0000-0000-0000-0000000000a2","text_regions":[],"components_seen":[{"label":"Posi-Traction differential cover"}]}'),
 ('62000000-0000-0000-0000-0000000000b3', '10000000-0000-0000-0000-000000000009', 'condition', 'reviewed_image_analysis_v1', '2026-11-10T12:00Z',
  '{"image_id":"51000000-0000-0000-0000-0000000000a3","text_regions":[{"text":"USE LIMITED SLIP DIFF. LUBE ONLY"}],"components_seen":[{"label":"Visible metallic differential cover section"}]}'),
 -- Car c: only a reader's notes and a harvest statement mention the words (they say what a photo does not prove).
 ('62000000-0000-0000-0000-0000000000b4', '10000000-0000-0000-0000-00000000000c', 'condition', 'reviewed_image_analysis_v1', '2026-11-10T12:00Z',
  '{"image_id":"51000000-0000-0000-0000-0000000000a4","agent_notes":"Exterior pixels do not establish limited-slip internals or posi operation.","text_regions":[{"text":"EWF"}],"components_seen":[{"label":"Rear axle and differential"}],"open_questions":["limited slip function"]}'),
 ('62000000-0000-0000-0000-0000000000b5', '10000000-0000-0000-0000-00000000000c', 'condition', 'photo_map_harvest_v1', '2026-10-28T12:00Z',
  '{"image_id":"51000000-0000-0000-0000-0000000000a4","part_key":"undercarriage.differential.rear","source_text":"A limited slip tag is on the cover."}'),
 -- A superseded reading never speaks.
 ('62000000-0000-0000-0000-0000000000b6', '10000000-0000-0000-0000-00000000000c', 'condition', 'reviewed_image_analysis_v1', '2026-11-10T12:00Z',
  '{"image_id":"51000000-0000-0000-0000-0000000000a4","text_regions":[{"text":"LIMITED SLIP LUBE ONLY"}]}'),
 -- The private car's photo; the sensitive photo of car f (a reading, with the observation itself as witness).
 ('62000000-0000-0000-0000-0000000000b7', '10000000-0000-0000-0000-000000000004', 'condition', 'reviewed_image_analysis_v1', '2026-11-10T12:00Z',
  '{"image_id":"51000000-0000-0000-0000-0000000000a5","text_regions":[{"text":"USE LIMITED SLIP DIFF. LUBE ONLY"}],"components_seen":[{"label":"differential cover"}]}'),
 ('62000000-0000-0000-0000-0000000000b8', '10000000-0000-0000-0000-00000000000f', 'condition', 'reviewed_image_analysis_v1', '2026-11-10T12:00Z',
  '{"image_id":"51000000-0000-0000-0000-0000000000a6","text_regions":[{"text":"USE LIMITED SLIP DIFF. LUBE ONLY"}],"components_seen":[{"label":"differential cover"}]}'),
 -- Car b: words that look like a unit but are not the axle: a gear-oil bottle's text with no differential in the picture,
 -- a storage locker, and a spool of wire beside an axle housing.
 ('62000000-0000-0000-0000-0000000000b9', '10000000-0000-0000-0000-00000000000b', 'condition', 'reviewed_image_analysis_v1', '2026-11-10T12:00Z',
  '{"image_id":"51000000-0000-0000-0000-0000000000a7","text_regions":[{"text":"LIMITED SLIP GEAR OIL"}],"components_seen":[{"label":"Bottle on shelf"}]}'),
 ('62000000-0000-0000-0000-0000000000ba', '10000000-0000-0000-0000-00000000000b', 'condition', 'reviewed_image_analysis_v1', '2026-11-10T12:00Z',
  '{"image_id":"51000000-0000-0000-0000-0000000000a8","text_regions":[],"components_seen":[{"label":"Garage storage locker"}]}'),
 ('62000000-0000-0000-0000-0000000000bb', '10000000-0000-0000-0000-00000000000b', 'condition', 'reviewed_image_analysis_v1', '2026-11-10T12:00Z',
  '{"image_id":"51000000-0000-0000-0000-0000000000a9","text_regions":[],"components_seen":[{"label":"Rear axle housing"},{"label":"Spool of wire"}]}');
UPDATE public.vehicle_observations SET is_superseded = true WHERE id = '62000000-0000-0000-0000-0000000000b6';
INSERT INTO public.fixture_links (receipt_id, vehicle_id, status, retired_at, page_date) VALUES
 ('c0000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-00000000000c', 'linked', now(), NULL);

-- The patch applies once; a second run is a no-op.
\ir ../migrations/20261120090000_facet_axle_type_from_evidence.sql
\ir ../migrations/20261120090000_facet_axle_type_from_evidence.sql

SET ROLE anon;
SET test.auth_role = 'anon';
RESET test.auth_uid;
DO $$
DECLARE item jsonb; txt text; f text;
BEGIN
  f := pg_get_functiondef('public.vehicle_facet_items(uuid,text)'::regprocedure);
  PERFORM public.t_assert((length(f) - length(replace(f, 'facet_axle_type_v1_end', ''))) / length('facet_axle_type_v1_end') = 1,
    'axle type branch patched once');
  PERFORM public.t_assert((length(f) - length(replace(f, 'axle_ev AS MATERIALIZED', ''))) / length('axle_ev AS MATERIALIZED') = 1,
    'the evidence helper is read once for both branches');

  -- The words, alone.
  PERFORM public.t_assert(public.axle_type_from_words('CHECK AND REPAIR REAR END POSI RING PINION') = 'limited-slip', 'posi');
  PERFORM public.t_assert(public.axle_type_from_words('Positraction rear') = 'limited-slip', 'positraction');
  PERFORM public.t_assert(public.axle_type_from_words('install Traction-Lok unit') = 'limited-slip', 'traction-lok');
  PERFORM public.t_assert(public.axle_type_from_words('Safe-T-Track 3.73') = 'limited-slip', 'safe-t-track');
  PERFORM public.t_assert(public.axle_type_from_words('LSD rear') = 'limited-slip', 'lsd');
  PERFORM public.t_assert(public.axle_type_from_words('Detroit Locker') = 'locking', 'locker');
  PERFORM public.t_assert(public.axle_type_from_words('open diff, new gears') = 'open', 'open diff');
  PERFORM public.t_assert(public.axle_type_from_words('open diff, new gears', false) IS NULL, 'a photo never reads open');
  PERFORM public.t_assert(public.axle_type_from_words('non-posi rear end') IS NULL, 'negated unit');
  PERFORM public.t_assert(public.axle_type_from_words('OPEN DIFFERENTIAL COVER AND INSPECT') IS NULL
    AND public.axle_type_from_words('OPEN DIFF, INSPECT RING AND PINION') IS NULL
    AND public.axle_type_from_words('OPEN REAR END, INSPECT') IS NULL, 'open as a verb is not a type');
  PERFORM public.t_assert(public.axle_printed_words(E'Posi  $245.00 and 1,200.50 labor\n3.73 gears call 702-555-0100') = 'Posi [amount] and [amount] labor 3.73 gears call [redacted]',
    'printed words: amounts removed, ratio kept, contact redacted, one line');
  PERFORM public.t_assert(public.axle_type_from_words('convert open diff to posi') IS NULL, 'two types: no guess');
  PERFORM public.t_assert(public.axle_type_from_words('positive battery cable') IS NULL AND public.axle_type_from_words(NULL) IS NULL, 'unrelated words');
  PERFORM public.t_assert(public.vehicle_facet_norm('axle_type', 'Posi') = 'limited-slip'
    AND public.vehicle_facet_norm('axle_type', '10-bolt') = '10-bolt', 'axle_type comparison kind; unrecognised text stays as written');

  -- Paper alone: a claim, the shop's words, the line id as witness, no money or names.
  item := public.t_item('10000000-0000-0000-0000-000000000007', 'drivetrain', 'drivetrain.axle.current.type');
  PERFORM public.t_assert(item->>'status' = 'claim' AND item->>'value' = 'limited-slip' AND item->>'normalized' = 'limited-slip',
    format('posi wording: a claim of limited-slip; got %s', item));
  PERFORM public.t_assert(jsonb_array_length(item->'sources') = 1 AND item->>'needed' IS NOT NULL, 'one source; the proof still needed');
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(item->'sources') s
      WHERE s->>'label' = 'Fixture Axle Shop' AND s->>'class' = 'claim' AND s#>>'{witness,kind}' = 'receipt_item'
        AND s#>>'{witness,id}' = 'd0000000-0000-0000-0000-000000000001' AND jsonb_array_length(s#>'{witness,ids}') = 1
        AND s#>>'{decoded,type}' = 'limited-slip' AND s#>>'{decoded,first_day}' = '2025-02-05'
        AND s->>'value' LIKE '%CHECK AND REPAIR REAR END POSI RING PINION BEARING%[amount]%' AND s->>'observed_at' LIKE '2025-02-05%'),
    format('shop source: words kept, witness and day; got %s', item->'sources'));
  txt := item::text;
  PERFORM public.t_assert(txt !~* '(123\.45|245|price|\$|702-555|Staff Name|Old Shop|Retired Shop|Duplicate Shop)', format('no amounts, names or contacts; got %s', txt));

  -- Photos alone, two images of one reader: readings, never established; the tag limitation and the thumbnail.
  item := public.t_item('10000000-0000-0000-0000-000000000008', 'drivetrain', 'drivetrain.axle.current.type');
  PERFORM public.t_assert(item->>'status' = 'reading' AND item->>'value' = 'limited-slip', format('photos alone: a reading; got %s', item->>'status'));
  PERFORM public.t_assert(jsonb_array_length(item->'sources') = 2, 'one source per image');
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(item->'sources') s
      WHERE s->>'class' = 'reading' AND s#>>'{witness,kind}' = 'image' AND s#>>'{witness,id}' = '51000000-0000-0000-0000-0000000000a1'
        AND s#>>'{witness,thumb}' = 'https://x.invalid/t.jpg' AND s->>'limitation' LIKE '%replaceable%'
        AND s->>'limitation' LIKE '%does not prove the carrier%' AND s#>>'{decoded,printed}' = 'USE LIMITED SLIP DIFF. LUBE ONLY'
        AND s->>'method' = 'reviewed_image_analysis_v1'),
    format('tag source carries the limitation, printed words and witness; got %s', item->'sources'));
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(item->'sources') s
      WHERE s#>>'{witness,id}' = '51000000-0000-0000-0000-0000000000a2' AND s->>'value' LIKE 'a reader named the unit:%'),
    'a component label is a reading with its own wording');

  -- Paper and a photo: two sources, distinct readers: the reader's own rule makes it established.
  item := public.t_item('10000000-0000-0000-0000-000000000009', 'drivetrain', 'drivetrain.axle.current.type');
  PERFORM public.t_assert(item->>'status' = 'established' AND item->>'value' = 'limited-slip' AND jsonb_array_length(item->'sources') = 2
      AND item->>'needed' IS NULL, format('paper + photo meet the rule; got %s', item));
  PERFORM public.t_assert((SELECT array_agg(s->>'class' ORDER BY s->>'class') FROM jsonb_array_elements(item->'sources') s) = ARRAY['claim', 'reading'],
    'both sources are shown, one of each class');

  -- Open wording.
  item := public.t_item('10000000-0000-0000-0000-00000000000a', 'drivetrain', 'drivetrain.axle.current.type');
  PERFORM public.t_assert(item->>'status' = 'claim' AND item->>'value' = 'open', format('open wording reads open; got %s', item));

  -- Ignored: superseded, retired, duplicate, other system, bought part, negated, ambiguous; and the car with only notes.
  item := public.t_item('10000000-0000-0000-0000-00000000000b', 'drivetrain', 'drivetrain.axle.current.type');
  PERFORM public.t_assert(item->>'status' = 'missing' AND jsonb_array_length(item->'sources') = 0,
    format('lines that are not current or not placed in the axle or ambiguous speak for nothing; got %s', item));
  item := public.t_item('10000000-0000-0000-0000-00000000000c', 'drivetrain', 'drivetrain.axle.current.type');
  PERFORM public.t_assert(item->>'status' = 'missing' AND jsonb_array_length(item->'sources') = 0,
    format('a reader''s notes, a harvest statement, a retired link and a superseded reading never speak; got %s', item));
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM public.vehicle_axle_type_evidence('10000000-0000-0000-0000-00000000000b')), 'helper: nothing for the ignored lines');

  -- A sensitive photo: the reading stands, the witness is the observation, no thumbnail.
  item := public.t_item('10000000-0000-0000-0000-00000000000f', 'drivetrain', 'drivetrain.axle.current.type');
  PERFORM public.t_assert(item->>'status' = 'reading' AND item#>>'{sources,0,witness,kind}' = 'observation'
      AND item#>>'{sources,0,witness,id}' = '62000000-0000-0000-0000-0000000000b8' AND item::text !~ 'x.invalid',
    format('a photo that cannot be shown is witnessed by its observation; got %s', item));

  -- The record agrees with the paper (no conflict); a record text no words recognise is kept as written.
  item := public.t_item('10000000-0000-0000-0000-00000000000d', 'drivetrain', 'drivetrain.axle.current.type');
  PERFORM public.t_assert(item->>'status' = 'claim' AND item->>'normalized' = 'limited-slip' AND jsonb_array_length(item->'sources') = 2,
    format('record "Posi" agrees with the shop; got %s', item));
  item := public.t_item('10000000-0000-0000-0000-00000000000e', 'drivetrain', 'drivetrain.axle.current.type');
  PERFORM public.t_assert(item->>'value' = '10-bolt' AND item->>'normalized' = '10-bolt', format('record text kept; got %s', item));

  -- A car with no evidence stays missing; the masthead and the whole read carry the item.
  item := public.t_item('10000000-0000-0000-0000-000000000002', 'drivetrain', 'drivetrain.axle.current.type');
  PERFORM public.t_assert(item->>'status' = 'missing' AND jsonb_array_length(item->'sources') = 0, 'no evidence: missing');
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(public.vehicle_facet_items('10000000-0000-0000-0000-000000000007', 'masthead')->'drivetrain') x
    WHERE x->>'key' = 'drivetrain.axle.current.type' AND x->>'status' = 'claim'), 'masthead carries the item');
  PERFORM public.t_assert(EXISTS (SELECT 1 FROM jsonb_array_elements(public.vehicle_facet_items('10000000-0000-0000-0000-000000000007')->'drivetrain') x
    WHERE x->>'key' = 'drivetrain.axle.current.type' AND x->>'status' = 'claim'), 'whole read carries the item');
  -- Other panels do not read the helper: the engine panel is the same as before.
  PERFORM public.t_assert(public.vehicle_facet_items('10000000-0000-0000-0000-000000000007', 'engine')::text NOT LIKE '%limited-slip%',
    'the engine panel does not carry it');

  -- A private car: nothing to anon, from the item or the helper.
  PERFORM public.t_assert(NOT EXISTS (SELECT 1 FROM public.vehicle_axle_type_evidence('10000000-0000-0000-0000-000000000004')),
    'a private car returns no evidence to anon');
  PERFORM public.t_assert(public.t_item('10000000-0000-0000-0000-000000000004', 'drivetrain', 'drivetrain.axle.current.type') IS NULL,
    'a private car has no items for anon');

  -- Grants.
  PERFORM public.t_assert(has_function_privilege('anon', 'public.vehicle_axle_type_evidence(uuid)', 'EXECUTE')
    AND has_function_privilege('anon', 'public.vehicle_facet_items(uuid,text)', 'EXECUTE'), 'anon executes the reader and its helper');
END $$;
RESET ROLE;
SELECT 'vehicle facet axle type: PASS' AS result;
