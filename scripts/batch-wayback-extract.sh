#!/bin/bash
# Batch extract old eBay Motors listings from Wayback Machine

cd /Users/skylar/nuke

# Load environment
eval "$(dotenvx run -- printenv | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | sed 's/^/export /')"

echo "[$(date)] Starting batch Wayback extraction..."

# Get a batch of old eBay Motors URLs
URLS=$(curl -s "https://web.archive.org/cdx/search/cdx?url=cgi.ebay.com/ebaymotors/*&matchType=prefix&from=2005&to=2009&output=json&limit=100&filter=statuscode:200&filter=mimetype:text/html" 2>/dev/null)

# Skip header row, process each URL
echo "$URLS" | jq -r '.[1:][] | "https://web.archive.org/web/\(.[0])/\(.[1])"' | while read snapshot_url; do
  # Skip parts listings (look for vehicle categories or specific patterns)
  if echo "$snapshot_url" | grep -qiE "(trucks|cars|suv|sedan|coupe|convertible|wagon|van|motor|vehicle)"; then
    echo "[$(date)] Extracting: $snapshot_url"

    # Extract the listing
    result=$(curl -s -X POST \
      "$VITE_SUPABASE_URL/functions/v1/extract-wayback-listing" \
      -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
      -H "Content-Type: application/json" \
      -d "{\"mode\": \"extract_snapshot\", \"snapshot_url\": \"$snapshot_url\"}" \
      --max-time 30 2>/dev/null)

    # Check if we got valid data
    price=$(echo "$result" | jq -r '.listing.price // empty')
    title=$(echo "$result" | jq -r '.listing.title // empty')
    year=$(echo "$result" | jq -r '.listing.year // empty')

    if [ -n "$price" ] && [ "$price" != "null" ] && [ "$price" -gt 500 ] 2>/dev/null; then
      echo "[$(date)] Found: $title - \$$price"

      # Try to extract year/make/model from title
      # Pattern: "Make : Model" or "Year Make Model"
      make=$(echo "$title" | sed -n 's/.*\([A-Z][a-z]*\) : .*/\1/p' | head -1)
      model=$(echo "$title" | sed -n 's/.*: \([^(]*\).*/\1/p' | head -1 | xargs)

      # Extract year from title if not already found
      if [ -z "$year" ] || [ "$year" = "null" ]; then
        year=$(echo "$title" | grep -oE '\b(19[0-9]{2}|20[0-2][0-9])\b' | head -1)
      fi

      # Extract VIN from image URLs if present
      vin=$(echo "$result" | jq -r '.listing.image_urls[]?' | grep -oE '[A-HJ-NPR-Z0-9]{17}' | head -1)

      # Get other fields
      mileage=$(echo "$result" | jq -r '.listing.mileage // empty')
      snapshot_date=$(echo "$result" | jq -r '.listing.snapshot_date // empty')
      domain=$(echo "$result" | jq -r '.listing.domain // "cgi.ebay.com"')
      images=$(echo "$result" | jq -c '.listing.image_urls[:5] // []')

      # Build ingest request
      if [ -n "$year" ] && [ -n "$make" ]; then
        echo "[$(date)] Ingesting: $year $make $model"

        ingest_result=$(curl -s -X POST \
          "$VITE_SUPABASE_URL/functions/v1/ingest-wayback-vehicle" \
          -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
          -H "Content-Type: application/json" \
          -d "{
            \"listing\": {
              \"snapshot_url\": \"$snapshot_url\",
              \"original_url\": \"$snapshot_url\",
              \"snapshot_date\": \"$snapshot_date\",
              \"domain\": \"$domain\",
              \"title\": \"$title\",
              \"year\": $year,
              \"make\": \"$make\",
              \"model\": \"$model\",
              $([ -n "$vin" ] && echo "\"vin\": \"$vin\",")
              \"price\": $price,
              $([ -n "$mileage" ] && [ "$mileage" != "null" ] && echo "\"mileage\": $mileage,")
              \"image_urls\": $images
            }
          }" --max-time 20 2>/dev/null)

        vehicle_id=$(echo "$ingest_result" | jq -r '.vehicle_id // empty')
        if [ -n "$vehicle_id" ]; then
          echo "[$(date)] Created vehicle: $vehicle_id"
        else
          echo "[$(date)] Ingest result: $(echo "$ingest_result" | jq -c '.warnings // .error // "unknown"')"
        fi
      fi
    fi

    # Rate limit
    sleep 1
  fi
done

echo "[$(date)] Batch extraction complete"
