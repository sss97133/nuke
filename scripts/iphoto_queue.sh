#!/usr/bin/env bash
# Sequential iPhoto intake queue — pairs of (album, vehicle_id), processed one at a time
# to avoid osxphotos concurrent iCloud fetch conflicts.
set -u
cd "$(dirname "$0")/.."

# Wait for any in-flight iphoto-intake to finish
while pgrep -fl "node.*scripts/iphoto-intake.mjs" >/dev/null 2>&1; do
  sleep 30
done
echo "$(date +%H:%M:%S) prior intake done, starting queue"

# Queue: tuple per line: album|vehicle_id|label
QUEUE=(
  "1977 K5 Chevrolet Blazer|e04bf9c5-b488-433b-be9a-3d307861d90b|K5 Blazer"
  "1972 K10 Chevrolet SWB|e8a9c558-a930-4e55-9e5c-4a2711cab081|72 K10 SWB"
  "1973 Dodge charger 360|043c6d8b-c81e-420a-9d20-77cf3385fc2a|73 Charger 360"
)

for entry in "${QUEUE[@]}"; do
  IFS='|' read -r ALBUM VEHICLE_ID LABEL <<< "$entry"
  if [ "$VEHICLE_ID" = "TBD" ]; then
    echo "$(date +%H:%M:%S) [$LABEL] skip — vehicle id not resolved"
    continue
  fi
  echo "$(date +%H:%M:%S) === [$LABEL] album=\"$ALBUM\" vehicle=$VEHICLE_ID ==="
  dotenvx run -- node scripts/iphoto-intake.mjs \
    --album "$ALBUM" \
    --vehicle-id "$VEHICLE_ID" \
    --force --download-missing 2>&1 | tail -100
  echo "$(date +%H:%M:%S) [$LABEL] done"

  # After each intake: catch-up device_attributions
  PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 \
    -U postgres.qkgaybvrernstplzjaam -d postgres -v ON_ERROR_STOP=1 <<SQL
SET statement_timeout='120s';
INSERT INTO device_attributions (
  image_id, camera_make, camera_model, device_fingerprint, software,
  attribution_source, extraction_method, confidence_score,
  actual_contributor_id, uploaded_by_user_id,
  datetime_original, latitude, longitude, raw_exif
)
SELECT vi.id, vi.exif_data->>'camera_make', vi.exif_data->>'camera_model',
  format('camera:%s:%s', lower(replace(vi.exif_data->>'camera_make',' ','-')), lower(replace(vi.exif_data->>'camera_model',' ','-'))),
  vi.exif_data->>'software', 'photos_library_iphoto_intake', 'osxphotos_exif_passthrough', 100,
  vi.user_id, vi.user_id, vi.taken_at,
  (vi.exif_data->'location'->>'latitude')::double precision,
  (vi.exif_data->'location'->>'longitude')::double precision,
  vi.exif_data
FROM vehicle_images vi
WHERE vi.vehicle_id = '$VEHICLE_ID'
  AND vi.source='iphoto' AND vi.user_id IS NOT NULL AND vi.exif_data ? 'camera_make'
  AND NOT EXISTS (SELECT 1 FROM device_attributions da WHERE da.image_id = vi.id);
SQL
done
echo "$(date +%H:%M:%S) === QUEUE COMPLETE ==="
