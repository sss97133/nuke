#!/bin/bash
# Ingest all source sitemaps into source_targets table
# Usage: ./scripts/ingest-source-targets.sh [source_slug]
# If no source specified, runs all sources
# macOS compatible (no GNU grep)

set -euo pipefail

WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

DB_HOST="aws-0-us-west-1.pooler.supabase.com"
DB_PORT="6543"
DB_USER="postgres.qkgaybvrernstplzjaam"
DB_NAME="postgres"
DB_PASS="RbzKq32A0uhqvJMQ"

PSQL_CMD="PGPASSWORD=$DB_PASS psql -h $DB_HOST -p $DB_PORT -U $DB_USER -d $DB_NAME -q"
UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

log() { echo "[$(date +%H:%M:%S)] $1"; }

# Curl with retry and backoff (for APIs that rate-limit)
curl_retry() {
  local max_retries=3
  local attempt=0
  local result=""
  while [ $attempt -lt $max_retries ]; do
    result=$(curl -s --max-time 30 "$@" 2>/dev/null) && {
      # Check if result is non-empty and starts with JSON/XML character
      if [ -n "$result" ]; then
        local fc="${result:0:1}"
        if [ "$fc" = "{" ] || [ "$fc" = "<" ] || [ "$fc" = "[" ]; then
          printf '%s' "$result"
          return 0
        fi
      fi
    }
    attempt=$((attempt + 1))
    local wait=$((attempt * 3))
    log "  Retry $attempt/$max_retries after ${wait}s..."
    sleep $wait
  done
  echo "{}"
  return 1
}

# Extract <loc>...</loc> URLs from XML (macOS compatible, handles minified XML)
extract_urls() {
  # First split on <loc> to handle minified XML (all on one line)
  tr '<' '\n' | sed -n 's/^loc>\([^<]*\).*/\1/p'
}

# Extract JSON field value (simple, no jq dependency for speed)
json_val() {
  local key="$1"
  sed -n "s/.*\"${key}\":\([0-9]*\).*/\1/p" | head -1
}

# Extract JSON string field
json_str() {
  local key="$1"
  sed -n "s/.*\"${key}\":\"\([^\"]*\)\".*/\1/p"
}

# Bulk load URLs from a file into source_targets
bulk_load() {
  local slug="$1"
  local file="$2"
  local sitemap="${3:-}"
  local count=$(wc -l < "$file" | tr -d ' ')

  if [ "$count" -eq 0 ]; then
    log "  $slug: no URLs to load"
    return
  fi

  log "  $slug: loading $count URLs..."

  local batch_file="$WORK_DIR/${slug}_batch.sql"
  > "$batch_file"

  local i=0
  local values=""
  while IFS= read -r url; do
    [ -z "$url" ] && continue
    url=$(echo "$url" | sed "s/'/''/g")
    if [ -z "$values" ]; then
      values="('$slug', '$url', '$sitemap')"
    else
      values="$values, ('$slug', '$url', '$sitemap')"
    fi
    i=$((i + 1))
    if [ $((i % 1000)) -eq 0 ]; then
      echo "INSERT INTO source_targets (source_slug, listing_url, sitemap_file) VALUES $values ON CONFLICT (listing_url) DO UPDATE SET last_seen_at = now();" >> "$batch_file"
      values=""
      log "  $slug: prepared $i/$count..."
    fi
  done < "$file"

  if [ -n "$values" ]; then
    echo "INSERT INTO source_targets (source_slug, listing_url, sitemap_file) VALUES $values ON CONFLICT (listing_url) DO UPDATE SET last_seen_at = now();" >> "$batch_file"
  fi

  log "  $slug: executing $i inserts..."
  eval $PSQL_CMD < "$batch_file" 2>/dev/null
  log "  $slug: done ($i URLs loaded)"
}

##############################
# Gooding (flat sitemap, ~9K)
##############################
ingest_gooding() {
  log "Gooding: fetching sitemap..."
  curl -s "https://www.goodingco.com/sitemap.xml" | extract_urls | grep '/lot/' > "$WORK_DIR/gooding.txt" || true
  bulk_load "gooding" "$WORK_DIR/gooding.txt" "sitemap.xml"
}

##############################
# Broad Arrow (gzipped on S3, ~2K)
##############################
ingest_broad_arrow() {
  log "Broad Arrow: fetching sitemap..."
  curl -sL "https://dealeraccelerate-all.s3.amazonaws.com/bagauction/sitemaps/sitemap.xml.gz" -o "$WORK_DIR/ba.xml.gz"
  gunzip -f "$WORK_DIR/ba.xml.gz"
  cat "$WORK_DIR/ba.xml" | extract_urls | grep '/vehicles/' > "$WORK_DIR/broadarrow.txt" || true
  bulk_load "broad-arrow" "$WORK_DIR/broadarrow.txt" "sitemap.xml.gz"
}

##############################
# PCarMarket (flat sitemap, ~27K)
##############################
ingest_pcarmarket() {
  log "PCarMarket: fetching sitemap..."
  curl -s "https://pcarmarket.com/sitemap.xml" | extract_urls | grep '/auction/' > "$WORK_DIR/pcarmarket.txt" || true
  bulk_load "pcarmarket" "$WORK_DIR/pcarmarket.txt" "sitemap.xml"
}

##############################
# Collecting Cars (flat sitemap, ~24K)
##############################
ingest_collecting_cars() {
  log "Collecting Cars: fetching sitemap..."
  curl -s "https://collectingcars.com/sitemap.xml" | extract_urls | grep '/for-sale/' > "$WORK_DIR/collectingcars.txt" || true
  bulk_load "collecting-cars" "$WORK_DIR/collectingcars.txt" "sitemap.xml"
}

##############################
# Barrett-Jackson (2 vehicle sitemaps, needs UA)
##############################
ingest_barrett_jackson() {
  log "Barrett-Jackson: fetching vehicle sitemaps..."
  curl -s -H "User-Agent: $UA" "https://www.barrett-jackson.com/sitemap-vehicles.xml" | extract_urls > "$WORK_DIR/bj1.txt" || true
  local c1=$(wc -l < "$WORK_DIR/bj1.txt" | tr -d ' ')
  log "  Barrett-Jackson: sitemap-vehicles.xml: $c1 URLs"

  curl -s -H "User-Agent: $UA" "https://www.barrett-jackson.com/sitemap-vehicles2.xml" | extract_urls > "$WORK_DIR/bj2.txt" || true
  local c2=$(wc -l < "$WORK_DIR/bj2.txt" | tr -d ' ')
  log "  Barrett-Jackson: sitemap-vehicles2.xml: $c2 URLs"

  cat "$WORK_DIR/bj1.txt" "$WORK_DIR/bj2.txt" > "$WORK_DIR/barrett-jackson.txt"
  bulk_load "barrett-jackson" "$WORK_DIR/barrett-jackson.txt" "sitemap-vehicles"
}

##############################
# BarnFinds (60 WP sitemap pages, ~60K)
##############################
ingest_barnfinds() {
  log "BarnFinds: fetching 60 WP sitemaps..."
  > "$WORK_DIR/barnfinds.txt"
  for i in $(seq 1 60); do
    curl -s "https://barnfinds.com/wp-sitemap-posts-post-${i}.xml" | extract_urls >> "$WORK_DIR/barnfinds.txt"
    if [ $((i % 10)) -eq 0 ]; then
      local c=$(wc -l < "$WORK_DIR/barnfinds.txt" | tr -d ' ')
      log "  BarnFinds: fetched $i/60 sitemaps ($c URLs so far)"
    fi
    sleep 0.3
  done
  bulk_load "barnfinds" "$WORK_DIR/barnfinds.txt" "wp-sitemap-posts"
}

##############################
# Mecum (269 lot sitemaps, ~269K)
##############################
ingest_mecum() {
  log "Mecum: fetching 269 lot sitemaps..."
  > "$WORK_DIR/mecum.txt"
  for i in $(seq 1 269); do
    curl_retry "https://www.mecum.com/sitemaps/lot-sitemap${i}.xml" | extract_urls >> "$WORK_DIR/mecum.txt"
    if [ $((i % 25)) -eq 0 ]; then
      local c=$(wc -l < "$WORK_DIR/mecum.txt" | tr -d ' ')
      log "  Mecum: fetched $i/269 sitemaps ($c URLs so far)"
    fi
    sleep 1.5
  done
  bulk_load "mecum" "$WORK_DIR/mecum.txt" "lot-sitemap"
}

##############################
# Hemmings (1034 per-make sitemaps, ~90K)
##############################
ingest_hemmings() {
  log "Hemmings: fetching make sitemap index..."
  curl -s "https://www.hemmings.com/sitemap_makes.xml" | extract_urls > "$WORK_DIR/hemmings_makes.txt"
  local total=$(wc -l < "$WORK_DIR/hemmings_makes.txt" | tr -d ' ')
  log "  Hemmings: found $total make sitemaps"

  > "$WORK_DIR/hemmings.txt"
  local count=0
  while IFS= read -r make_url; do
    [ -z "$make_url" ] && continue
    curl_retry "$make_url" | extract_urls | grep '/classifieds/' >> "$WORK_DIR/hemmings.txt" || true
    count=$((count + 1))
    if [ $((count % 100)) -eq 0 ]; then
      local c=$(wc -l < "$WORK_DIR/hemmings.txt" | tr -d ' ')
      log "  Hemmings: fetched $count/$total make sitemaps ($c URLs so far)"
    fi
    sleep 0.2
  done < "$WORK_DIR/hemmings_makes.txt"
  bulk_load "hemmings" "$WORK_DIR/hemmings.txt" "make-sitemaps"
}

##############################
# BaT (WP REST API, ~230K)
##############################
ingest_bat() {
  # Persistent file survives crashes; resume from last completed year
  local bat_file="/tmp/bat_targets.txt"
  local bat_progress="/tmp/bat_progress.txt"
  local start_year=1890

  if [ -f "$bat_progress" ]; then
    start_year=$(cat "$bat_progress")
    start_year=$((start_year + 1))
    log "BaT: resuming from year $start_year..."
  else
    > "$bat_file"
    log "BaT: fetching via WP REST API year-by-year..."
  fi

  for year in $(seq $start_year 2026); do
    # Decade cooldown: pause 60s every 10 years to avoid rate-limit blocks
    if [ $((year % 10)) -eq 0 ] && [ "$year" -gt "$start_year" ]; then
      local c=$(wc -l < "$bat_file" | tr -d ' ')
      log "  BaT: through year $((year - 1)) ($c URLs so far) — cooling down 60s..."
      # Bulk-load progress so far (idempotent upsert)
      cp "$bat_file" "$WORK_DIR/bat_partial.txt"
      bulk_load "bat" "$WORK_DIR/bat_partial.txt" "wp-rest-api"
      sleep 60
    fi

    local response
    response=$(curl -s --max-time 30 -X POST "https://bringatrailer.com/wp-json/bringatrailer/1.0/data/listings-filter" \
      -H "Content-Type: application/json" \
      -d "{\"page\":\"1\",\"get_items\":true,\"get_stats\":false,\"minimum_year\":\"$year\",\"maximum_year\":\"$year\"}" 2>/dev/null) || true

    local items_total
    items_total=$(echo "$response" | jq -r '.items_total // 0' 2>/dev/null || echo "0")

    if [ "$items_total" -gt 0 ] 2>/dev/null; then
      echo "$response" | jq -r '.items[]?.url // empty' 2>/dev/null >> "$bat_file"

      local pages_total
      pages_total=$(echo "$response" | jq -r '.pages_total // 1' 2>/dev/null || echo "1")

      if [ "$pages_total" -gt 1 ] 2>/dev/null; then
        for page in $(seq 2 "$pages_total"); do
          [ "$page" -gt 277 ] && break
          local page_resp
          page_resp=$(curl -s --max-time 30 -X POST "https://bringatrailer.com/wp-json/bringatrailer/1.0/data/listings-filter" \
            -H "Content-Type: application/json" \
            -d "{\"page\":\"$page\",\"get_items\":true,\"get_stats\":false,\"minimum_year\":\"$year\",\"maximum_year\":\"$year\"}" 2>/dev/null) || true
          echo "$page_resp" | jq -r '.items[]?.url // empty' 2>/dev/null >> "$bat_file"
          sleep 2
        done
      fi
    fi

    echo "$year" > "$bat_progress"
    sleep 3
  done

  sort -u "$bat_file" > "$WORK_DIR/bat_dedup.txt"
  bulk_load "bat" "$WORK_DIR/bat_dedup.txt" "wp-rest-api"
  rm -f "$bat_progress" "$bat_file"
}

##############################
# RM Sotheby's (POST SearchLots API, ~64K)
# Paginate per-auction: POST /api/search/SearchLots {"page":N,"pageSize":40,"auction":"mo24"}
##############################
ingest_rm_sothebys() {
  log "RM Sotheby's: discovering auctions via search API..."
  > "$WORK_DIR/rmsothebys.txt"

  # Known auction codes (2-letter location + 2-digit year)
  # Locations: mo=Monterey, az=Arizona, pa=Paris, lo=London, mi=Milan,
  #   am=Amelia Island, fo=Fort Lauderdale, vi=Villa Erba, ab=Abu Dhabi,
  #   ce=Cernobbio, af=Auburn Fall, as=Auburn Spring, ps=Private Sales
  #   hf=Hershey Fall, ny=New York, mu=Munich, ge=Geneva, st=Stuttgart
  local locations="mo az pa lo mi am fo vi ab ce af as hf ny mu ge st"
  local fetched=0

  for loc in $locations; do
    for yr in $(seq 5 25); do
      local code=$(printf "%s%02d" "$loc" "$yr")
      local response
      response=$(curl -s --max-time 15 -X POST "https://rmsothebys.com/api/search/SearchLots" \
        -H "Content-Type: application/json" \
        -d "{\"page\":1,\"pageSize\":40,\"auction\":\"$code\"}" 2>/dev/null) || true

      local total_items
      total_items=$(echo "$response" | jq -r '.pager.totalItems // 0' 2>/dev/null || echo "0")
      [ "$total_items" -eq 0 ] 2>/dev/null && continue

      # Extract links from page 1
      echo "$response" | jq -r '.lots[]?.link // empty' 2>/dev/null | sed 's|^|https://rmsothebys.com|' >> "$WORK_DIR/rmsothebys.txt"

      local total_pages
      total_pages=$(echo "$response" | jq -r '.pager.totalPages // 1' 2>/dev/null || echo "1")

      if [ "$total_pages" -gt 1 ] 2>/dev/null; then
        for page in $(seq 2 "$total_pages"); do
          local page_resp
          page_resp=$(curl -s --max-time 15 -X POST "https://rmsothebys.com/api/search/SearchLots" \
            -H "Content-Type: application/json" \
            -d "{\"page\":$page,\"pageSize\":40,\"auction\":\"$code\"}" 2>/dev/null) || true
          echo "$page_resp" | jq -r '.lots[]?.link // empty' 2>/dev/null | sed 's|^|https://rmsothebys.com|' >> "$WORK_DIR/rmsothebys.txt"
          sleep 0.3
        done
      fi

      fetched=$((fetched + total_items))
      log "  RM Sotheby's: $code = $total_items lots (total: $fetched)"
      sleep 0.3
    done
  done

  # Also try private sales
  local ps_resp
  ps_resp=$(curl -s --max-time 15 -X POST "https://rmsothebys.com/api/search/SearchLots" \
    -H "Content-Type: application/json" \
    -d '{"page":1,"pageSize":40,"auction":"ps00"}' 2>/dev/null) || true
  echo "$ps_resp" | jq -r '.lots[]?.link // empty' 2>/dev/null | sed 's|^|https://rmsothebys.com|' >> "$WORK_DIR/rmsothebys.txt"

  sort -u "$WORK_DIR/rmsothebys.txt" > "$WORK_DIR/rmsothebys_dedup.txt"
  local total_count=$(wc -l < "$WORK_DIR/rmsothebys_dedup.txt" | tr -d ' ')
  log "  RM Sotheby's: $total_count unique URLs"
  bulk_load "rm-sothebys" "$WORK_DIR/rmsothebys_dedup.txt" "search-api"
}

##############################
# Cars & Bids (sitemap, ~9K current + growing)
##############################
ingest_cars_and_bids() {
  log "Cars & Bids: fetching sitemap..."
  > "$WORK_DIR/carsandbids.txt"

  # Fetch the sitemap index first
  local sitemap_index
  sitemap_index=$(curl -s "https://carsandbids.com/cab-sitemap/xml_sitemap.xml" 2>/dev/null) || true

  # Extract child sitemap URLs and fetch each
  local child_urls
  child_urls=$(echo "$sitemap_index" | extract_urls)

  for child_url in $child_urls; do
    curl -s "$child_url" 2>/dev/null | extract_urls | grep '/auctions/' >> "$WORK_DIR/carsandbids.txt" || true
    sleep 0.5
  done

  local count=$(wc -l < "$WORK_DIR/carsandbids.txt" | tr -d ' ')
  log "  Cars & Bids: $count listing URLs from sitemap"
  bulk_load "cars-and-bids" "$WORK_DIR/carsandbids.txt" "sitemap"
}

##############################
# Classic.com (Firecrawl through Cloudflare, ~1M)
# Requires FIRECRAWL_API_KEY env var (use dotenvx run)
##############################
ingest_classic_com() {
  log "Classic.com: fetching sitemaps via Firecrawl..."
  local classic_file="/tmp/classic_targets.txt"
  local classic_progress="/tmp/classic_progress.txt"
  local start_type="vehicle"
  local start_page=1

  if [ -f "$classic_progress" ]; then
    start_type=$(cut -d: -f1 "$classic_progress")
    start_page=$(cut -d: -f2 "$classic_progress")
    start_page=$((start_page + 1))
    log "  Classic.com: resuming from $start_type page $start_page..."
  else
    > "$classic_file"
  fi

  local fc_key="${FIRECRAWL_API_KEY:-}"
  if [ -z "$fc_key" ]; then
    log "  Classic.com: ERROR - FIRECRAWL_API_KEY not set. Run with: dotenvx run -- bash ..."
    return 1
  fi

  # Process each sitemap type
  local types="vehicle:147 dealerlot:39 vehiclelot:20"
  local started=false

  for entry in $types; do
    local type=$(echo "$entry" | cut -d: -f1)
    local max_page=$(echo "$entry" | cut -d: -f2)

    # Skip types before resume point
    if [ "$started" = false ]; then
      if [ "$type" != "$start_type" ]; then
        continue
      fi
      started=true
    else
      start_page=1
    fi

    log "  Classic.com: fetching $type sitemaps ($start_page-$max_page)..."
    for i in $(seq $start_page $max_page); do
      local response
      response=$(curl -s --max-time 60 -X POST "https://api.firecrawl.dev/v1/scrape" \
        -H "Authorization: Bearer $fc_key" \
        -H "Content-Type: application/json" \
        -d "{\"url\": \"https://www.classic.com/sitemap-${type}.xml?p=${i}\", \"formats\": [\"rawHtml\"]}" 2>/dev/null) || true

      echo "$response" | jq -r '.data.rawHtml // empty' 2>/dev/null | extract_urls >> "$classic_file" || true
      echo "${type}:${i}" > "$classic_progress"

      if [ $((i % 10)) -eq 0 ]; then
        local c=$(wc -l < "$classic_file" | tr -d ' ')
        log "  Classic.com $type: $i/$max_page ($c URLs total)"
      fi

      # Bulk-load every 50 pages to save progress
      if [ $((i % 50)) -eq 0 ]; then
        local c=$(wc -l < "$classic_file" | tr -d ' ')
        log "  Classic.com: checkpoint at $type:$i ($c URLs) — loading to DB..."
        sort -u "$classic_file" > "$WORK_DIR/classic_partial.txt"
        bulk_load "classic-com" "$WORK_DIR/classic_partial.txt" "firecrawl-sitemap"
      fi

      sleep 2  # Firecrawl rate limit
    done
  done

  sort -u "$classic_file" > "$WORK_DIR/classic_dedup.txt"
  local deduped=$(wc -l < "$WORK_DIR/classic_dedup.txt" | tr -d ' ')
  log "  Classic.com: $deduped unique URLs"
  bulk_load "classic-com" "$WORK_DIR/classic_dedup.txt" "firecrawl-sitemap"
  rm -f "$classic_progress" "$classic_file"
}

##############################
# AutoHunter (via Firecrawl on Classic.com index, ~7.6K)
# Requires FIRECRAWL_API_KEY env var (use dotenvx run)
##############################
ingest_autohunter() {
  log "AutoHunter: fetching via Classic.com index (317 pages) with Firecrawl..."
  > "$WORK_DIR/autohunter.txt"

  local fc_key="${FIRECRAWL_API_KEY:-}"
  if [ -z "$fc_key" ]; then
    log "  AutoHunter: ERROR - FIRECRAWL_API_KEY not set. Run with: dotenvx run -- bash ..."
    return 1
  fi

  for page in $(seq 1 317); do
    local response
    response=$(curl -s --max-time 60 -X POST "https://api.firecrawl.dev/v1/scrape" \
      -H "Authorization: Bearer $fc_key" \
      -H "Content-Type: application/json" \
      -d "{\"url\": \"https://www.classic.com/a/autohunter-auctions-knXlwMn/?page=${page}\", \"formats\": [\"rawHtml\"]}" 2>/dev/null) || true

    # Extract AutoHunter URLs from the HTML
    echo "$response" | jq -r '.data.rawHtml // empty' 2>/dev/null | tr '"' '\n' | grep 'autohunter.com/Listing/Details/' | sort -u >> "$WORK_DIR/autohunter.txt" || true

    if [ $((page % 50)) -eq 0 ]; then
      local c=$(wc -l < "$WORK_DIR/autohunter.txt" | tr -d ' ')
      log "  AutoHunter: $page/317 pages ($c URLs)"
    fi
    sleep 2  # Firecrawl rate limit
  done

  sort -u "$WORK_DIR/autohunter.txt" > "$WORK_DIR/autohunter_dedup.txt"
  local count=$(wc -l < "$WORK_DIR/autohunter_dedup.txt" | tr -d ' ')
  log "  AutoHunter: $count unique URLs"
  bulk_load "autohunter" "$WORK_DIR/autohunter_dedup.txt" "classic-com-index"
}

##############################
# Bonhams (Typesense search API, ~142K)
##############################
ingest_bonhams() {
  log "Bonhams: fetching via Typesense search API..."
  > "$WORK_DIR/bonhams.txt"

  local page=1
  local per_page=250
  local total=0
  local fetched=0

  while true; do
    local response
    response=$(curl_retry -X POST 'https://api01.bonhams.com/search-proxy/multi_search' \
      -H 'Content-Type: application/json' \
      -H 'X-TYPESENSE-API-KEY: 7YZqOyG0twgst4ACc2VuCyZxpGAYzM0weFTLCC20FQY' \
      -d "{\"searches\":[{\"collection\":\"lots\",\"q\":\"*\",\"query_by\":\"title\",\"filter_by\":\"brand:bonhams-cars\",\"per_page\":${per_page},\"page\":${page},\"include_fields\":\"auctionId,lotId,slug\"}]}")

    if [ "$total" -eq 0 ]; then
      total=$(echo "$response" | jq -r '.results[0].found // 0' 2>/dev/null || echo "0")
      log "  Bonhams: total items = $total"
      if [ "$total" -eq 0 ]; then
        log "  Bonhams: API returned 0 items, aborting"
        return
      fi
    fi

    # Construct URLs from auctionId + lotId + slug
    local urls
    urls=$(echo "$response" | jq -r '.results[0].hits[]?.document | "https://www.bonhams.com/auction/\(.auctionId)/lot/\(.lotId)/\(.slug)"' 2>/dev/null || true)
    local items_on_page=0
    if [ -n "$urls" ]; then
      echo "$urls" >> "$WORK_DIR/bonhams.txt"
      items_on_page=$(echo "$urls" | wc -l | tr -d ' ')
    fi
    fetched=$((fetched + items_on_page))

    if [ "$items_on_page" -lt "$per_page" ] || [ "$fetched" -ge "$total" ]; then
      break
    fi

    page=$((page + 1))
    if [ $((page % 50)) -eq 0 ]; then
      log "  Bonhams: fetched $fetched/$total..."
    fi
    sleep 1
  done

  sort -u "$WORK_DIR/bonhams.txt" > "$WORK_DIR/bonhams_dedup.txt"
  mv "$WORK_DIR/bonhams_dedup.txt" "$WORK_DIR/bonhams.txt"
  bulk_load "bonhams" "$WORK_DIR/bonhams.txt" "typesense-api"
}

##############################
# Main
##############################
SOURCE="${1:-all}"

case "$SOURCE" in
  gooding)          ingest_gooding ;;
  broad-arrow)      ingest_broad_arrow ;;
  pcarmarket)       ingest_pcarmarket ;;
  collecting-cars)  ingest_collecting_cars ;;
  barrett-jackson)  ingest_barrett_jackson ;;
  barnfinds)        ingest_barnfinds ;;
  mecum)            ingest_mecum ;;
  hemmings)         ingest_hemmings ;;
  bat)              ingest_bat ;;
  rm-sothebys)      ingest_rm_sothebys ;;
  bonhams)          ingest_bonhams ;;
  cars-and-bids)    ingest_cars_and_bids ;;
  classic-com)      ingest_classic_com ;;
  autohunter)       ingest_autohunter ;;
  all)
    log "=== Starting full ingestion ==="
    ingest_gooding
    ingest_broad_arrow
    ingest_pcarmarket
    ingest_collecting_cars
    ingest_barrett_jackson
    ingest_barnfinds
    ingest_mecum
    ingest_hemmings
    ingest_bat
    ingest_rm_sothebys
    ingest_bonhams
    ingest_cars_and_bids
    ingest_classic_com
    ingest_autohunter
    ;;
  *)
    echo "Unknown source: $SOURCE"
    echo "Available: gooding, broad-arrow, pcarmarket, collecting-cars, barrett-jackson, barnfinds, mecum, hemmings, bat, rm-sothebys, bonhams, cars-and-bids, classic-com, autohunter, all"
    exit 1
    ;;
esac

log "=== Ingestion complete. Coverage report: ==="
eval $PSQL_CMD -c "SELECT * FROM source_target_coverage;" 2>/dev/null

log "Done."
