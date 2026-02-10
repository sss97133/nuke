#!/bin/bash
# worker-specialty.sh — Specialty Builder Worker
# Processes queued URLs for Velocity, ICON, Cool N Vintage, BRABUS, Ring Brothers

DURATION="${1:-28800}"
END_TIME=$(($(date +%s) + DURATION))
cd "$(dirname "$0")/../.."

log() { echo "[$(date '+%H:%M:%S')] [SPECIALTY-WORKER] $*"; }

call_fn() {
  dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/extract-specialty-builder\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '$1'" 2>/dev/null
}

query() {
  dotenvx run -- bash -c "PGPASSWORD=\"RbzKq32A0uhqvJMQ\" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -t -c \"$1\"" 2>/dev/null
}

log "Starting specialty builder extraction"

DOMAINS=("velocityrestorations.com" "icon4x4.com" "coolnvintage.com" "brabus.com" "ringbrothers.com")

for domain in "${DOMAINS[@]}"; do
  [ "$(date +%s)" -ge "$END_TIME" ] && break
  log "Processing domain: $domain"

  # Get pending URLs for this domain
  URLS=$(query "SELECT listing_url FROM import_queue WHERE listing_url LIKE '%${domain}%' AND status='pending' LIMIT 50;")

  URL_COUNT=0
  echo "$URLS" | while read -r url; do
    url=$(echo "$url" | tr -d ' ')
    [ -z "$url" ] && continue
    [ "$(date +%s)" -ge "$END_TIME" ] && break

    URL_COUNT=$((URL_COUNT + 1))
    log "  [$URL_COUNT] $url"
    RESULT=$(call_fn "{\"url\": \"$url\", \"action\": \"extract\"}")
    SUCCESS=$(echo "$RESULT" | jq -r '.success' 2>/dev/null)
    log "  -> success=$SUCCESS"
    sleep 3
  done

  log "  Completed $domain"
done

log "Specialty builder worker complete."
