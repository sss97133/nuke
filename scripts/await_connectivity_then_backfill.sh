#!/usr/bin/env bash
# Wait until supabase is reachable, then run the pending backfills.
set -u
cd "$(dirname "$0")/.."

probe() {
  PGPASSWORD="${SUPABASE_DB_PASSWORD}" timeout 8 psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 \
    -U postgres.qkgaybvrernstplzjaam -d postgres -c "SELECT 1" >/dev/null 2>&1
}

echo "$(date +%H:%M:%S) waiting for supabase pooler reachability..."
until probe; do sleep 30; done
echo "$(date +%H:%M:%S) connectivity restored"

echo "$(date +%H:%M:%S) === retry: daily-receipt EXIF backfill ==="
dotenvx run -- node scripts/backfill_daily_receipt_exif.mjs 2>&1 | tail -8

echo "$(date +%H:%M:%S) === catch-up: device_attributions for iphoto rows missing it ==="
PGPASSWORD="${SUPABASE_DB_PASSWORD}" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 \
  -U postgres.qkgaybvrernstplzjaam -d postgres -v ON_ERROR_STOP=1 <<'SQL'
SET statement_timeout='120s';
INSERT INTO device_attributions (
  image_id, camera_make, camera_model, device_fingerprint, software,
  attribution_source, extraction_method, confidence_score,
  actual_contributor_id, uploaded_by_user_id,
  datetime_original, latitude, longitude, raw_exif
)
SELECT
  vi.id,
  vi.exif_data->>'camera_make',
  vi.exif_data->>'camera_model',
  format('camera:%s:%s',
    lower(replace(vi.exif_data->>'camera_make',' ','-')),
    lower(replace(vi.exif_data->>'camera_model',' ','-'))),
  vi.exif_data->>'software',
  'photos_library_iphoto_intake',
  'osxphotos_exif_passthrough',
  100,
  vi.user_id, vi.user_id,
  vi.taken_at,
  (vi.exif_data->'location'->>'latitude')::double precision,
  (vi.exif_data->'location'->>'longitude')::double precision,
  vi.exif_data
FROM vehicle_images vi
WHERE vi.source='iphoto'
  AND vi.user_id IS NOT NULL
  AND vi.exif_data ? 'camera_make'
  AND NOT EXISTS (SELECT 1 FROM device_attributions da WHERE da.image_id = vi.id);

SELECT count(*) AS attribs_total FROM device_attributions;
SELECT count(*) AS daily_receipt_with_exif
  FROM vehicle_images WHERE source='daily_receipt' AND exif_data ? 'camera_make';
SQL

echo "$(date +%H:%M:%S) done"
