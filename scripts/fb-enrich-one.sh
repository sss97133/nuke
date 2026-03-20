#!/bin/bash
# Process one vehicle: download images from FB URLs and upload to Supabase storage
# Usage: fb-enrich-one.sh <vehicle_id> <urls_json_file>
# The urls_json_file contains a JSON array of image URLs

VEHICLE_ID="$1"
URLS_FILE="$2"
SUPABASE_URL="${VITE_SUPABASE_URL}"
SERVICE_KEY="${SUPABASE_SERVICE_ROLE_KEY}"
BUCKET="vehicle-photos"

if [ -z "$VEHICLE_ID" ] || [ -z "$URLS_FILE" ] || [ ! -f "$URLS_FILE" ]; then
  echo "Usage: fb-enrich-one.sh <vehicle_id> <urls_json_file>"
  exit 1
fi

URLS=$(python3 -c "import json; urls=json.load(open('$URLS_FILE')); [print(u) for u in urls[:12]]")
COUNT=0
PRIMARY=""

while IFS= read -r URL; do
  [ -z "$URL" ] && continue
  PADDED=$(printf "%02d" $COUNT)
  FILENAME="${VEHICLE_ID}/fb-saved-${PADDED}.jpg"
  TMP="/tmp/fb-img-${VEHICLE_ID}-${COUNT}.jpg"

  # Download
  curl -sL -o "$TMP" "$URL" 2>/dev/null
  SIZE=$(stat -f%z "$TMP" 2>/dev/null || echo 0)

  if [ "$SIZE" -gt 1000 ]; then
    # Upload
    UPLOAD_URL="${SUPABASE_URL}/storage/v1/object/${BUCKET}/${FILENAME}"
    HTTP=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$UPLOAD_URL" \
      -H "Authorization: Bearer ${SERVICE_KEY}" \
      -H "Content-Type: image/jpeg" \
      -H "x-upsert: true" \
      --data-binary "@${TMP}")

    if [ "$HTTP" = "200" ]; then
      PUBLIC_URL="${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${FILENAME}"
      IS_PRIMARY="false"
      [ "$COUNT" = "0" ] && IS_PRIMARY="true" && PRIMARY="$PUBLIC_URL"

      # Insert vehicle_image record + media observation
      PGPASSWORD="RbzKq32A0uhqvJMQ" psql -q -h aws-0-us-west-1.pooler.supabase.com -p 6543 \
        -U postgres.qkgaybvrernstplzjaam -d postgres <<EOSQL
INSERT INTO vehicle_images (vehicle_id, image_url, is_primary, source)
VALUES ('${VEHICLE_ID}', '${PUBLIC_URL}', ${IS_PRIMARY}, 'facebook-saved')
ON CONFLICT DO NOTHING;

INSERT INTO vehicle_observations (vehicle_id, vehicle_match_confidence, observed_at, source_id, source_identifier, kind, content_hash, structured_data)
SELECT '${VEHICLE_ID}', 1.0, NOW(),
  (SELECT id FROM observation_sources WHERE slug = 'facebook-saved'),
  'fb-img-${VEHICLE_ID}-${PADDED}', 'media',
  encode(sha256(('facebook-saved:media:${VEHICLE_ID}:${PUBLIC_URL}')::bytea), 'hex'),
  jsonb_build_object('image_url', '${PUBLIC_URL}', 'is_primary', ${IS_PRIMARY}, 'source', 'facebook-saved')
ON CONFLICT (source_id, source_identifier, kind, content_hash) DO NOTHING;
EOSQL

      COUNT=$((COUNT + 1))
    fi
  fi
  rm -f "$TMP"
done <<< "$URLS"

# Set primary image on vehicle
if [ -n "$PRIMARY" ]; then
  PGPASSWORD="RbzKq32A0uhqvJMQ" psql -q -h aws-0-us-west-1.pooler.supabase.com -p 6543 \
    -U postgres.qkgaybvrernstplzjaam -d postgres \
    -c "UPDATE vehicles SET primary_image_url = '${PRIMARY}' WHERE id = '${VEHICLE_ID}';"
fi

echo "${COUNT} images uploaded for ${VEHICLE_ID}"
