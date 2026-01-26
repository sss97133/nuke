#!/bin/bash

# Batch tag K10 images with AI angle detection
# Sample 10 images to demonstrate the system

VEHICLE_ID="d7962908-9a01-4082-a85e-6bbe532550b2"

# Sample image IDs from the K10 (from the query above)
IMAGES=(
  "7fcc784f-1378-4239-95f4-c6880f629648"
  "07226f94-484e-49e9-b7f0-f6c2d6b10d8d"
  "bf03a0ba-e38c-4be1-96af-9cd15deb3de3"
  "6c8e7d59-0fe1-49ca-8493-031bc05a60fc"
  "b324db02-f8f9-4d98-822f-0295df758fb6"
)

for IMAGE_ID in "${IMAGES[@]}"; do
  echo "Tagging image $IMAGE_ID..."
  
  # Get image URL from database
  IMAGE_URL=$(psql "$DATABASE_URL" -t -c "SELECT image_url FROM vehicle_images WHERE id = '$IMAGE_ID';")
  
  if [ -z "$IMAGE_URL" ]; then
    echo "  ❌ Image not found"
    continue
  fi
  
  # Call AI tagging function
  curl -X POST 'https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ai-tag-image-angles' \
    -H 'Content-Type: application/json' \
    -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
    -d "{\"imageId\":\"$IMAGE_ID\",\"imageUrl\":\"$IMAGE_URL\",\"vehicleId\":\"$VEHICLE_ID\"}"
  
  echo ""
  sleep 2
done

echo "✅ Tagging complete! Check coverage:"
psql "$DATABASE_URL" -c "SELECT * FROM vehicle_image_coverage WHERE vehicle_id = '$VEHICLE_ID';"

