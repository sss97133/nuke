-- Fixture test for lot_presence_read / shop_priorities_read. Run against a scratch database with
-- the migration applied (never the live DB):  psql -v ON_ERROR_STOP=1 -f this_file.sql
-- Everything runs inside a transaction that is rolled back.
BEGIN;
SELECT set_config('t.uid', '00000000-0000-0000-0000-000000000001', true);
SELECT set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-000000000001', true);

INSERT INTO public.vehicles (id, year, make, model) VALUES
  ('10000000-0000-0000-0000-000000000001', 1966, 'Ford', 'Mustang'),
  ('10000000-0000-0000-0000-000000000002', 1966, 'Ford', 'Mustang'),
  ('10000000-0000-0000-0000-000000000003', 1971, 'GMC', 'K15');
UPDATE public.vehicles SET merged_into_vehicle_id = '10000000-0000-0000-0000-000000000001'
  WHERE id = '10000000-0000-0000-0000-000000000002';

-- The lot: many days of photos around one point. Elsewhere: one far-away cluster.
INSERT INTO public.vehicle_images (user_id, vehicle_id, taken_at, latitude, longitude)
SELECT '00000000-0000-0000-0000-000000000001', NULL, now() - (d || ' days')::interval, 40.0001, -100.0001
FROM generate_series(1, 30) d;
-- Mustang on lot yesterday, plus a photo on the merged duplicate and an auto-matched unassigned one.
INSERT INTO public.vehicle_images (user_id, vehicle_id, taken_at, latitude, longitude) VALUES
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', now() - interval '1 day', 40.0002, -100.0002),
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000002', now() - interval '5 days', 40.0002, -100.0002);
INSERT INTO public.vehicle_images (user_id, auto_suggested_vehicle_id, auto_suggestion_confidence, taken_at, latitude, longitude) VALUES
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 0.95, now() - interval '2 days', 40.0002, -100.0002);
-- K15 last seen at the lot 10 days ago: departed.
INSERT INTO public.vehicle_images (user_id, vehicle_id, taken_at, latitude, longitude) VALUES
  ('00000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000003', now() - interval '10 days', 40.0001, -100.0001),
  ('00000000-0000-0000-0000-000000000001', NULL, now() - interval '9 days', 10, 10);
INSERT INTO public.work_orders (vehicle_id, status, updated_at) VALUES
  ('10000000-0000-0000-0000-000000000003', 'pending', now());

DO $$
DECLARE r record; n int;
BEGIN
  SELECT * INTO r FROM public.lot_presence_read() WHERE vehicle_id = '10000000-0000-0000-0000-000000000001';
  IF r.status <> 'on_lot' THEN RAISE EXCEPTION 'mustang should be on_lot, got %', r.status; END IF;
  IF r.lot_photos <> 3 THEN RAISE EXCEPTION 'merged + auto-matched photos should count: %', r.lot_photos; END IF;
  IF r.lot_photos_unassigned <> 1 THEN RAISE EXCEPTION 'unassigned count: %', r.lot_photos_unassigned; END IF;
  IF NOT ('10000000-0000-0000-0000-000000000002' = ANY (r.merged_record_ids)) THEN RAISE EXCEPTION 'merged id missing'; END IF;
  IF abs((r.lot_center->>'lat')::numeric - 40.0) > 0.01 THEN RAISE EXCEPTION 'lot center wrong: %', r.lot_center; END IF;

  SELECT * INTO r FROM public.lot_presence_read() WHERE vehicle_id = '10000000-0000-0000-0000-000000000003';
  IF r.status <> 'departed' THEN RAISE EXCEPTION 'k15 should be departed, got %', r.status; END IF;

  SELECT count(*) INTO n FROM public.lot_presence_read() WHERE vehicle_id = '10000000-0000-0000-0000-000000000002';
  IF n <> 0 THEN RAISE EXCEPTION 'merged duplicate must not appear as its own vehicle'; END IF;

  SELECT * INTO r FROM public.shop_priorities_read() WHERE rank = 1;
  IF r.vehicle_id <> '10000000-0000-0000-0000-000000000001' THEN RAISE EXCEPTION 'rank 1 should be the mustang: %', r; END IF;
  IF NOT ('photographed_recent:3' = ANY (r.reasons)) THEN RAISE EXCEPTION 'reasons: %', r.reasons; END IF;
  IF r.assumptions->'cost_of_money_apr'->>'source' <> 'assumed' THEN RAISE EXCEPTION 'assumption not labelled'; END IF;

  SELECT * INTO r FROM public.shop_priorities_read() WHERE vehicle_id = '10000000-0000-0000-0000-000000000003';
  IF r.score <> 3 OR NOT ('pending_or_quoted:1' = ANY (r.reasons)) THEN RAISE EXCEPTION 'k15: % %', r.score, r.reasons; END IF;
  RAISE NOTICE 'shop_priorities_read fixture test passed';
END $$;
ROLLBACK;
