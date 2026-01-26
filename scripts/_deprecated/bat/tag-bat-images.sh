#!/bin/bash
# Tag the first 10 BaT images with AI angle detection

VEHICLE_ID="655f224f-d8ae-4fc6-a3ec-4ab8db234fdf"
EDGE_FUNCTION_URL="https://qkgaybvrernstplzjaam.supabase.co/functions/v1/ai-tag-image-angles"

# Get images
echo "🔍 Fetching images to tag..."
IMAGES=$(curl -s "https://qkgaybvrernstplzjaam.supabase.co/rest/v1/vehicle_images?vehicle_id=eq.$VEHICLE_ID&source=eq.bat_import&select=id,image_url&limit=10" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $VITE_SUPABASE_ANON_KEY")

echo "📸 Tagging images with AI..."
echo "$IMAGES" | jq -r '.[] | .id + " " + .image_url' | while read -r IMAGE_ID IMAGE_URL; do
  echo "  [${IMAGE_ID:0:8}...] Analyzing: ${IMAGE_URL:0:80}..."
  
  # Call AI tagging edge function
  curl -s -X POST "$EDGE_FUNCTION_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
    -d "{\"imageId\": \"$IMAGE_ID\", \"imageUrl\": \"$IMAGE_URL\"}" \
    > /tmp/tag-result-${IMAGE_ID}.json
  
  # Check result
  if grep -q "angles" /tmp/tag-result-${IMAGE_ID}.json; then
    echo "    ✅ Tagged successfully"
  else
    echo "    ⚠️  Failed: $(cat /tmp/tag-result-${IMAGE_ID}.json)"
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Image tagging complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
