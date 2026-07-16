#!/bin/bash
# prep_from_bat_url.sh — front of the Eye runner: a BaT URL → a vehicle with a
# local image dir named by image_id, ready for the read workflow.
#
#   bash scripts/appraise/prep_from_bat_url.sh <bat_listing_url> [out_base_dir]
#
# Emits: <out_base>/read_<vehicle_id>/{imgs/<image_id>.jpg, manifest.json,
#        story.txt}. Prints the vehicle_id and the read dir on the last line.
# Only 1965-66 Mustangs produce a valid read today (canon is Mustang-specific).
set -euo pipefail
cd "$(dirname "$0")/../.."   # repo root

URL="${1:?usage: prep_from_bat_url.sh <bat_url> [out_base]}"
OUT_BASE="${2:-/tmp/eye_reads}"
[[ "$URL" == *"bringatrailer.com/listing/"* ]] || { echo "not a BaT listing URL"; exit 1; }

echo "== import: $URL"
# URL is exported into the child env so the single-quoted body expands
# $VITE_SUPABASE_URL / $SUPABASE_SERVICE_ROLE_KEY / $URL all INSIDE dotenvx.
# Body is one line: backslash-newline is literal inside single quotes.
RESP=$(URL="$URL" dotenvx run -- bash -c 'curl -sS --max-time 200 -X POST "$VITE_SUPABASE_URL/functions/v1/complete-bat-import" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d "{\"bat_url\":\"$URL\"}"' 2>/dev/null)
# strip any dotenvx banner: pull the JSON object out of RESP before parsing
VID=$(echo "$RESP" | python3 -c "import sys,json,re;s=sys.stdin.read();m=re.search(r'\{.*\}',s,re.S);print(json.loads(m.group(0)).get('vehicle_id','') if m else '')")
[[ -n "$VID" ]] || { echo "import failed: $RESP"; exit 1; }
echo "== vehicle_id: $VID"

DIR="$OUT_BASE/read_$VID"
mkdir -p "$DIR/imgs" "$DIR/out"
ANON=$(dotenvx run -- printenv VITE_SUPABASE_ANON_KEY | tail -1)
SUPA=$(dotenvx run -- printenv VITE_SUPABASE_URL | tail -1)

curl -sS --max-time 60 "$SUPA/rest/v1/vehicle_images?vehicle_id=eq.$VID&select=id,image_url,large_url&order=display_order.asc,position.asc" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" > "$DIR/manifest.json"
curl -sS --max-time 30 "$SUPA/rest/v1/vehicles?id=eq.$VID&select=description" \
  -H "apikey: $ANON" -H "Authorization: Bearer $ANON" \
  | python3 -c "import json,sys;d=json.load(sys.stdin)[0];open('$DIR/story.txt','w').write(d.get('description') or '')"

python3 -c "import json;rows=json.load(open('$DIR/manifest.json'));open('$DIR/dl.txt','w').write('\n'.join(f\"{r['id']}\t{r.get('large_url') or r.get('image_url')}\" for r in rows if (r.get('large_url') or r.get('image_url'))))"
( cd "$DIR/imgs" && xargs -P 10 -L1 bash -c 'curl -sS --max-time 45 -o "$0.jpg" "$1"' < "$DIR/dl.txt" ) 2>/dev/null || true

N=$(ls "$DIR/imgs"/*.jpg 2>/dev/null | wc -l | tr -d ' ')
echo "== $N images downloaded to $DIR/imgs"
echo "VEHICLE_ID=$VID"
echo "READ_DIR=$DIR"
