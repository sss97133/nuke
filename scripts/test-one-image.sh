#!/bin/bash
# Test image analysis with one image (no local API keys needed!)

echo "Testing image analysis system..."
echo ""
echo "This calls the Edge Function which already has all API keys ✓"
echo ""

# Get one unprocessed image from database
IMAGE_DATA=$(supabase db execute -c "
SELECT id, image_url, vehicle_id 
FROM vehicle_images 
WHERE ai_scan_metadata->>'scanned_at' IS NULL
LIMIT 1
" --output json)

if [ -z "$IMAGE_DATA" ] || [ "$IMAGE_DATA" = "[]" ]; then
  echo "✓ All images are already processed!"
  echo ""
  echo "Check results:"
  supabase db execute -c "
  SELECT 
    COUNT(*) as total,
    COUNT(CASE WHEN ai_scan_metadata->>'scanned_at' IS NOT NULL THEN 1 END) as processed
  FROM vehicle_images
  "
  exit 0
fi

echo "Found unprocessed image. Analyzing..."
echo ""

IMAGE_ID=$(echo "$IMAGE_DATA" | jq -r '.[0].id')
IMAGE_URL=$(echo "$IMAGE_DATA" | jq -r '.[0].image_url')
VEHICLE_ID=$(echo "$IMAGE_DATA" | jq -r '.[0].vehicle_id')

echo "Image ID: $IMAGE_ID"
echo "Vehicle ID: $VEHICLE_ID"
echo ""

# Call Edge Function (it has all the API keys)
curl -X POST \
  "$(supabase status | grep 'API URL' | awk '{print $3}')/functions/v1/analyze-image" \
  -H "Authorization: Bearer $(supabase status | grep 'Anon' | awk '{print $3}')" \
  -H "Content-Type: application/json" \
  -d "{\"image_url\":\"$IMAGE_URL\",\"vehicle_id\":\"$VEHICLE_ID\"}"

echo ""
echo ""
echo "Checking if data was saved..."

sleep 2

supabase db execute -c "
SELECT 
  ai_scan_metadata->>'scanned_at' as scanned_at,
  CASE WHEN ai_scan_metadata->'rekognition' IS NOT NULL THEN 'Yes' ELSE 'No' END as has_rekognition,
  CASE WHEN ai_scan_metadata->'appraiser' IS NOT NULL THEN 'Yes' ELSE 'No' END as has_appraiser
FROM vehicle_images 
WHERE id = '$IMAGE_ID'
"

echo ""
echo "✓ Test complete!"
