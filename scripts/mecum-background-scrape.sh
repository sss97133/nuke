#!/bin/bash
# Mecum Background Scraper
# Runs headlessly to catalog videos and prepare processing queue
# Usage: nohup ./scripts/mecum-background-scrape.sh > /tmp/mecum-scrape.log 2>&1 &

set -e
cd /Users/skylar/nuke

LOG="/tmp/mecum-scrape.log"
CATALOG="/tmp/mecum-video-catalog.json"

echo "$(date): Starting Mecum background scrape" >> $LOG

# Function to search YouTube and append to catalog
search_youtube() {
  local query="$1"
  echo "$(date): Searching: $query" >> $LOG

  yt-dlp "ytsearch50:$query" --flat-playlist \
    --print "%(id)s|%(title)s|%(duration)s|%(channel)s" 2>/dev/null | \
    grep -i "mecum" >> /tmp/mecum-raw-videos.txt || true
}

# Expand video catalog with more searches
echo "$(date): Expanding video catalog..." >> $LOG

# Search by year
for year in 2020 2021 2022 2023 2024 2025 2026; do
  search_youtube "mecum auction $year full"
  search_youtube "mecum kissimmee $year"
  search_youtube "mecum indy $year"
  sleep 2
done

# Search by location
for loc in "houston" "glendale" "dallas" "las vegas" "harrisburg" "monterey" "chicago" "portland" "tulsa"; do
  search_youtube "mecum $loc auction"
  sleep 2
done

# Deduplicate
echo "$(date): Deduplicating results..." >> $LOG
sort -u /tmp/mecum-raw-videos.txt > /tmp/mecum-videos-deduped.txt
wc -l /tmp/mecum-videos-deduped.txt >> $LOG

# Convert to JSON format
echo "$(date): Converting to JSON..." >> $LOG
echo "[" > /tmp/mecum-catalog-new.json
first=true
while IFS='|' read -r id title duration channel; do
  if [ -n "$id" ] && [ -n "$title" ]; then
    if [ "$first" = true ]; then
      first=false
    else
      echo "," >> /tmp/mecum-catalog-new.json
    fi

    # Determine video type
    type="other"
    if echo "$title" | grep -qi "block cam"; then
      type="block_cam"
    elif echo "$title" | grep -qi "full broadcast\|full show"; then
      type="full_broadcast"
    elif echo "$title" | grep -qi "lot #\|lot#"; then
      type="lot_clip"
    fi

    # Extract location
    location=""
    for loc in Kissimmee Houston Indy Glendale Dallas Vegas Harrisburg Monterey Chicago; do
      if echo "$title" | grep -qi "$loc"; then
        location="$loc"
        break
      fi
    done

    cat >> /tmp/mecum-catalog-new.json << EOF
  {
    "id": "$id",
    "title": $(echo "$title" | jq -R .),
    "duration": ${duration:-0},
    "channel": $(echo "$channel" | jq -R .),
    "videoType": "$type",
    "auctionLocation": "$location"
  }
EOF
  fi
done < /tmp/mecum-videos-deduped.txt
echo "]" >> /tmp/mecum-catalog-new.json

# Merge with existing catalog if present
if [ -f "$CATALOG" ]; then
  echo "$(date): Merging with existing catalog..." >> $LOG
  jq -s '.[0] + .[1] | unique_by(.id)' "$CATALOG" /tmp/mecum-catalog-new.json > /tmp/mecum-merged.json
  mv /tmp/mecum-merged.json "$CATALOG"
else
  mv /tmp/mecum-catalog-new.json "$CATALOG"
fi

# Final stats
total=$(jq 'length' "$CATALOG")
broadcasts=$(jq '[.[] | select(.videoType == "full_broadcast" or .videoType == "block_cam")] | length' "$CATALOG")
hours=$(jq '[.[].duration] | add / 3600' "$CATALOG")

echo "$(date): Catalog complete" >> $LOG
echo "  Total videos: $total" >> $LOG
echo "  Broadcasts: $broadcasts" >> $LOG
echo "  Total hours: $hours" >> $LOG

# Cleanup
rm -f /tmp/mecum-raw-videos.txt /tmp/mecum-videos-deduped.txt /tmp/mecum-catalog-new.json

echo "$(date): Background scrape complete!" >> $LOG
echo "Results saved to $CATALOG" >> $LOG
