-- ALLOW_RAW_TESTIMONY_WRITE
-- 20260611220000_limbo888_metadata_repair_from_stored_exif.sql
--
-- METADATA REPAIR on 17 vehicle_images rows (all now on e08bf694 after the
-- 2026-06-11 reappropriation drain). Two classes, identified by the back-to-source
-- EXIF pass (docs/wiring/receipts/2026-06-11_research-limbo-back-to-source.md,
-- per-row dispositions in docs/wiring/output/limbo_888_evidence.csv):
--
--   1. exif_db_date_mismatch (13 rows): an intake mapping bug swapped taken_at AND
--      GPS between rows of crossed pairs (e.g. IMG_1542 carried IMG_1541's
--      timestamp+GPS and vice versa). The stored-original EXIF
--      (DateTimeOriginal + OffsetTimeOriginal + GPSLatitude/Longitude, extracted by
--      exiftool from the Supabase storage originals 2026-06-11) is the truth source.
--   2. exif_only_db_null (4 rows): taken_at was NULL; stored-original EXIF has the date.
--
-- WHY RAW UPDATE (not supersession): copy+supersede for vehicle_images collides with
-- the (vehicle_id, file_hash) unique index -- a corrected copy of the same content on
-- the same vehicle is structurally impossible. Authorized path per Skylar order
-- 2026-06-11: single migration, before-values preserved on each row in
-- exif_data->'metadata_repair_2026_06_11', EXIF cited as source.
-- This migration touches ONLY taken_at / latitude / longitude / exif_data on the
-- 17 listed ids. No DELETE. No other columns. Idempotence note: re-running would
-- re-apply identical values; the audit key records the ORIGINAL before-values from
-- /tmp/reapp/metadata_before_values.txt captured pre-repair.

-- IMG_6723.PNG (exif_db_date_mismatch): EXIF 2022:07:18 19:41:00 (no offset)
UPDATE vehicle_images SET
  taken_at = '2022-07-18 19:41:00-07:00'::timestamptz,
  latitude = NULL, longitude = NULL,
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": "2021-06-12 21:41:24.407826+00", "latitude": "35.97748667", "longitude": "-114.85395000"}, "source": "stored-original EXIF, storage object parts/4868e1f1-b103-45ef-b1a8-aa86009b7cec.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_db_date_mismatch", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "DB GPS belonged to the swapped twin photo and the stored original carries no GPS -> cleared (offset absent in EXIF; -07:00 assumed = America/Los_Angeles PDT for Henderson NV, July)"}'::jsonb)
WHERE id = '4868e1f1-b103-45ef-b1a8-aa86009b7cec';

-- IMG_6880.jpg (exif_db_date_mismatch): EXIF 2024:05:13 17:30:41 -07:00
UPDATE vehicle_images SET
  taken_at = '2024-05-13 17:30:41-07:00'::timestamptz,
  latitude = 35.9726722222222, longitude = -114.855080555556,
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": "2021-06-15 22:00:58+00", "latitude": "35.97750000", "longitude": "-114.85400000"}, "source": "stored-original EXIF, storage object parts/ec3d4395-65e4-45d4-9ee8-850cea1fb2fc.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_db_date_mismatch", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "EXIF GPS applied"}'::jsonb)
WHERE id = 'ec3d4395-65e4-45d4-9ee8-850cea1fb2fc';

-- IMG_6881.jpg (exif_db_date_mismatch): EXIF 2024:05:13 17:30:48 -07:00
UPDATE vehicle_images SET
  taken_at = '2024-05-13 17:30:48-07:00'::timestamptz,
  latitude = 35.9726527777778, longitude = -114.855011111111,
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": "2021-06-15 22:07:38+00", "latitude": "35.97250000", "longitude": "-114.86750000"}, "source": "stored-original EXIF, storage object parts/b837bfda-4409-44fa-80c8-08f811064ba4.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_db_date_mismatch", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "EXIF GPS applied"}'::jsonb)
WHERE id = 'b837bfda-4409-44fa-80c8-08f811064ba4';

-- IMG_7217.jpg (exif_db_date_mismatch): EXIF 2024:05:28 22:51:34 -07:00
UPDATE vehicle_images SET
  taken_at = '2024-05-28 22:51:34-07:00'::timestamptz,
  latitude = 35.9729722222222, longitude = -114.855055555556,
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": "2022-08-11 18:44:00.751479+00", "latitude": "35.97728000", "longitude": "-114.85416333"}, "source": "stored-original EXIF, storage object parts/81dc1d58-9225-4e4f-a065-a9863959f914.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_db_date_mismatch", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "EXIF GPS applied"}'::jsonb)
WHERE id = '81dc1d58-9225-4e4f-a065-a9863959f914';

-- IMG_7218.jpg (exif_db_date_mismatch): EXIF 2024:05:28 22:51:34 -07:00
UPDATE vehicle_images SET
  taken_at = '2024-05-28 22:51:34-07:00'::timestamptz,
  latitude = 35.9729722222222, longitude = -114.855055555556,
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": "2022-08-11 18:45:01.06502+00", "latitude": "35.97723333", "longitude": "-114.85416333"}, "source": "stored-original EXIF, storage object parts/4a4e41d2-e40c-48f5-8908-6bf14ac3cfcd.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_db_date_mismatch", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "EXIF GPS applied"}'::jsonb)
WHERE id = '4a4e41d2-e40c-48f5-8908-6bf14ac3cfcd';

-- IMG_7219.jpg (exif_db_date_mismatch): EXIF 2024:05:28 22:51:34 -07:00
UPDATE vehicle_images SET
  taken_at = '2024-05-28 22:51:34-07:00'::timestamptz,
  latitude = 35.9729722222222, longitude = -114.855055555556,
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": "2022-08-11 18:45:56.422294+00", "latitude": "35.97721167", "longitude": "-114.85415000"}, "source": "stored-original EXIF, storage object parts/5418f6cf-6509-4894-ac08-e2f4539a0043.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_db_date_mismatch", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "EXIF GPS applied"}'::jsonb)
WHERE id = '5418f6cf-6509-4894-ac08-e2f4539a0043';

-- IMG_1541.jpg (exif_db_date_mismatch): EXIF 2024:10:11 12:41:32 -07:00
UPDATE vehicle_images SET
  taken_at = '2024-10-11 12:41:32-07:00'::timestamptz,
  latitude = 35.9726916666667, longitude = -114.85505,
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": "2023-11-06 21:41:35.321+00", "latitude": "35.97735333", "longitude": "-114.85414167"}, "source": "stored-original EXIF, storage object parts/59e26ac6-1e60-44d2-9425-36a48690643e.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_db_date_mismatch", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "EXIF GPS applied"}'::jsonb)
WHERE id = '59e26ac6-1e60-44d2-9425-36a48690643e';

-- IMG_1543.jpg (exif_db_date_mismatch): EXIF 2024:10:11 12:41:47 -07:00
UPDATE vehicle_images SET
  taken_at = '2024-10-11 12:41:47-07:00'::timestamptz,
  latitude = 35.9727361111111, longitude = -114.855033333333,
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": "2023-11-06 22:23:07.345+00", "latitude": "35.97736167", "longitude": "-114.85405000"}, "source": "stored-original EXIF, storage object parts/2df412c3-6721-4cfa-8eaf-984e926d138e.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_db_date_mismatch", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "EXIF GPS applied"}'::jsonb)
WHERE id = '2df412c3-6721-4cfa-8eaf-984e926d138e';

-- IMG_1544.jpg (exif_db_date_mismatch): EXIF 2024:10:11 12:41:47 -07:00
UPDATE vehicle_images SET
  taken_at = '2024-10-11 12:41:47-07:00'::timestamptz,
  latitude = 35.9727361111111, longitude = -114.855033333333,
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": "2023-11-06 22:23:10.502+00", "latitude": "35.97734500", "longitude": "-114.85408000"}, "source": "stored-original EXIF, storage object parts/7c420c99-5e5c-4c61-bac3-7f7a192baddd.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_db_date_mismatch", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "EXIF GPS applied"}'::jsonb)
WHERE id = '7c420c99-5e5c-4c61-bac3-7f7a192baddd';

-- IMG_1542.jpg (exif_db_date_mismatch): EXIF 2023:11:06 13:41:49 -08:00
UPDATE vehicle_images SET
  taken_at = '2023-11-06 13:41:49-08:00'::timestamptz,
  latitude = 35.9773722222222, longitude = -114.854155555556,
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": "2024-10-11 19:41:33.454+00", "latitude": "35.97269167", "longitude": "-114.85505000"}, "source": "stored-original EXIF, storage object parts/5e8e7c19-d637-4bd6-86fa-8f960ea6a691.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_db_date_mismatch", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "EXIF GPS applied"}'::jsonb)
WHERE id = '5e8e7c19-d637-4bd6-86fa-8f960ea6a691';

-- IMG_1560.jpg (exif_db_date_mismatch): EXIF 2023:11:07 10:31:56 -08:00
UPDATE vehicle_images SET
  taken_at = '2023-11-07 10:31:56-08:00'::timestamptz,
  latitude = 35.9773611111111, longitude = -114.854041666667,
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": "2024-10-12 22:54:32.918+00", "latitude": "35.97260000", "longitude": "-114.85501167"}, "source": "stored-original EXIF, storage object parts/431ee3f5-d247-4523-8bbc-a8c221bc58db.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_db_date_mismatch", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "EXIF GPS applied"}'::jsonb)
WHERE id = '431ee3f5-d247-4523-8bbc-a8c221bc58db';

-- IMG_1565.jpg (exif_db_date_mismatch): EXIF 2023:11:07 18:31:43 -08:00
UPDATE vehicle_images SET
  taken_at = '2023-11-07 18:31:43-08:00'::timestamptz,
  latitude = 35.9772111111111, longitude = -114.854172222222,
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": "2024-10-12 22:55:04.019+00", "latitude": "35.97269667", "longitude": "-114.85502500"}, "source": "stored-original EXIF, storage object parts/48439f4e-b3bc-49d4-87b4-5ec40847e8c9.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_db_date_mismatch", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "EXIF GPS applied"}'::jsonb)
WHERE id = '48439f4e-b3bc-49d4-87b4-5ec40847e8c9';

-- IMG_2976.jpg (exif_db_date_mismatch): EXIF 2024:12:12 12:10:42 -08:00
UPDATE vehicle_images SET
  taken_at = '2024-12-12 12:10:42-08:00'::timestamptz,
  latitude = 35.9725916666667, longitude = -114.855561111111,
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": "2025-10-12 23:46:36.996+00", "latitude": "35.97267833", "longitude": "-114.85476667"}, "source": "stored-original EXIF, storage object parts/90341f8c-8413-42e1-8a0e-d071388e78f4.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_db_date_mismatch", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "EXIF GPS applied"}'::jsonb)
WHERE id = '90341f8c-8413-42e1-8a0e-d071388e78f4';

-- IMG_3262_edited.jpeg (exif_only_db_null): EXIF 2024:12:29 17:55:59 -04:00
UPDATE vehicle_images SET
  taken_at = '2024-12-29 17:55:59-04:00'::timestamptz,
  
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": null, "latitude": null, "longitude": null}, "source": "stored-original EXIF, storage object parts/18a15b17-b02a-426d-8669-5bb9f337c06b.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_only_db_null", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "no GPS in EXIF, none in DB"}'::jsonb)
WHERE id = '18a15b17-b02a-426d-8669-5bb9f337c06b';

-- IMG_3263_edited.jpeg (exif_only_db_null): EXIF 2024:12:29 17:56:05 -04:00
UPDATE vehicle_images SET
  taken_at = '2024-12-29 17:56:05-04:00'::timestamptz,
  
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": null, "latitude": null, "longitude": null}, "source": "stored-original EXIF, storage object parts/a70d494c-39ec-4800-ad7a-ee0350458ac1.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_only_db_null", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "no GPS in EXIF, none in DB"}'::jsonb)
WHERE id = 'a70d494c-39ec-4800-ad7a-ee0350458ac1';

-- IMG_3261_edited.jpeg (exif_only_db_null): EXIF 2024:12:29 17:55:53 -04:00
UPDATE vehicle_images SET
  taken_at = '2024-12-29 17:55:53-04:00'::timestamptz,
  
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": null, "latitude": null, "longitude": null}, "source": "stored-original EXIF, storage object parts/b6b58fc2-9ac1-467e-87e5-98cf9fa8a4ad.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_only_db_null", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "no GPS in EXIF, none in DB"}'::jsonb)
WHERE id = 'b6b58fc2-9ac1-467e-87e5-98cf9fa8a4ad';

-- IMG_3260_edited.jpeg (exif_only_db_null): EXIF 2024:12:29 17:55:49 -04:00
UPDATE vehicle_images SET
  taken_at = '2024-12-29 17:55:49-04:00'::timestamptz,
  
  exif_data = COALESCE(exif_data,'{}'::jsonb) || jsonb_build_object('metadata_repair_2026_06_11', '{"repair": "limbo888_metadata_repair", "date": "2026-06-11", "before": {"taken_at": null, "latitude": null, "longitude": null}, "source": "stored-original EXIF, storage object parts/7ac4d537-abb3-477a-a89e-c1c5bfe96001.bin, exiftool pass 2026-06-11 (/tmp/limbo888/all888_exif.json)", "basis": "docs/wiring/output/limbo_888_evidence.csv verdict=exif_only_db_null", "receipt": "docs/wiring/receipts/2026-06-11_reappropriation-complete.md", "note": "no GPS in EXIF, none in DB"}'::jsonb)
WHERE id = '7ac4d537-abb3-477a-a89e-c1c5bfe96001';
