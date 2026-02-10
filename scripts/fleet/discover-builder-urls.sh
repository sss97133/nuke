#!/bin/bash
# discover-builder-urls.sh — Specialty Builder URL Discovery
# Fetches builder sites and inserts discovered vehicle URLs into import_queue

cd "$(dirname "$0")/../.."

log() { echo "[$(date '+%H:%M:%S')] [DISCOVER] $*"; }

insert_url() {
  local url="$1"
  local source="$2"
  dotenvx run -- bash -c "PGPASSWORD=\"RbzKq32A0uhqvJMQ\" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c \"
    INSERT INTO import_queue (listing_url, source_name, status, attempts)
    VALUES ('$url', '$source', 'pending', 0)
    ON CONFLICT (listing_url) DO NOTHING;
  \"" 2>/dev/null
}

UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"

# ============================================================
# VELOCITY RESTORATIONS
# ============================================================
log "=== Velocity Restorations ==="
VELOCITY_URLS=$(curl -s "https://www.velocityrestorations.com/for-sale/" -H "User-Agent: $UA" | grep -oE 'href="https://www\.velocityrestorations\.com/[^"]*"' | sed 's/href="//;s/"$//' | grep -v '/for-sale/$' | grep -v '/restorations/$' | grep -v '#' | sort -u)
SOLD_URLS=$(curl -s "https://www.velocityrestorations.com/restorations/" -H "User-Agent: $UA" | grep -oE 'href="https://www\.velocityrestorations\.com/[^"]*"' | sed 's/href="//;s/"$//' | grep -v '/restorations/$' | grep -v '#' | sort -u)
ALL_VELOCITY=$(echo -e "$VELOCITY_URLS\n$SOLD_URLS" | sort -u | grep -E '/[a-z0-9-]+/$' | head -100)
COUNT=0
echo "$ALL_VELOCITY" | while read -r url; do
  [ -z "$url" ] && continue
  insert_url "$url" "velocity-restorations"
  COUNT=$((COUNT + 1))
done
log "Velocity: discovered $(echo "$ALL_VELOCITY" | grep -c .)"

# ============================================================
# COOL N VINTAGE
# ============================================================
log "=== Cool N Vintage ==="
CNV_URLS=$(curl -s "https://coolnvintage.com/projects/" -H "User-Agent: $UA" | grep -oE 'href="https://coolnvintage\.com/projects/[^"]*"' | sed 's/href="//;s/"$//' | grep -v '/projects/$' | sort -u | head -100)
echo "$CNV_URLS" | while read -r url; do
  [ -z "$url" ] && continue
  insert_url "$url" "cool-n-vintage"
done
log "Cool N Vintage: discovered $(echo "$CNV_URLS" | grep -c .)"

# ============================================================
# BRABUS
# ============================================================
log "=== BRABUS ==="
BRABUS_URLS=$(curl -s "https://www.brabus.com/en/supercars.html" -H "User-Agent: $UA" | grep -oE 'href="[^"]*supercars/[^"]*"' | sed 's/href="//;s/"$//' | sort -u | head -50)
# Also try the main vehicles page
BRABUS_URLS2=$(curl -s "https://www.brabus.com/en/cars.html" -H "User-Agent: $UA" | grep -oE 'href="/en/[^"]*\.html"' | sed 's/href="//;s/"$//' | grep -v 'cars.html$' | sort -u | head -50)
ALL_BRABUS=$(echo -e "$BRABUS_URLS\n$BRABUS_URLS2" | sort -u)
echo "$ALL_BRABUS" | while read -r url; do
  [ -z "$url" ] && continue
  # Make absolute if relative
  case "$url" in
    http*) insert_url "$url" "brabus" ;;
    *) insert_url "https://www.brabus.com$url" "brabus" ;;
  esac
done
log "BRABUS: discovered $(echo "$ALL_BRABUS" | grep -c .)"

# ============================================================
# RING BROTHERS
# ============================================================
log "=== Ring Brothers ==="
RB_URLS=$(curl -s "https://ringbrothers.com/builds" -H "User-Agent: $UA" | grep -oE 'href="https://ringbrothers\.com/builds/[^"]*"' | sed 's/href="//;s/"$//' | sort -u | head -100)
# Also try alternative URL patterns
RB_URLS2=$(curl -s "https://ringbrothers.com/builds" -H "User-Agent: $UA" | grep -oE 'href="/builds/[^"]*"' | sed 's/href="//;s/"$//' | sort -u | head -100)
ALL_RB=$(echo -e "$RB_URLS\n$RB_URLS2" | sort -u)
echo "$ALL_RB" | while read -r url; do
  [ -z "$url" ] && continue
  case "$url" in
    http*) insert_url "$url" "ring-brothers" ;;
    *) insert_url "https://ringbrothers.com$url" "ring-brothers" ;;
  esac
done
log "Ring Brothers: discovered $(echo "$ALL_RB" | grep -c .)"

# ============================================================
# ICON 4X4
# ============================================================
log "=== ICON 4x4 ==="
ICON_URLS=$(curl -s "https://www.icon4x4.com/" -H "User-Agent: $UA" | grep -oE 'href="https://www\.icon4x4\.com/[^"]*"' | sed 's/href="//;s/"$//' | grep -vE '(/$|\.css|\.js|\.png|\.jpg|#)' | sort -u | head -100)
echo "$ICON_URLS" | while read -r url; do
  [ -z "$url" ] && continue
  insert_url "$url" "icon4x4"
done
log "ICON 4x4: discovered $(echo "$ICON_URLS" | grep -c .)"

# ============================================================
# VANGUARD MOTOR SALES
# ============================================================
log "=== Vanguard Motor Sales ==="
# They have paginated inventory
for page in 1 2 3 4 5; do
  VMS_URLS=$(curl -s "https://www.vanguardmotorsales.com/inventory?page=$page" -H "User-Agent: $UA" | grep -oE 'href="https://www\.vanguardmotorsales\.com/inventory/[^"]*"' | sed 's/href="//;s/"$//' | sort -u)
  echo "$VMS_URLS" | while read -r url; do
    [ -z "$url" ] && continue
    insert_url "$url" "vanguard-motor-sales"
  done
  log "Vanguard page $page: $(echo "$VMS_URLS" | grep -c .)"
  sleep 2
done

log "=== URL Discovery Complete ==="
