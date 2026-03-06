#!/bin/bash
# Prepare ZCTA (ZIP Code Tabulation Area) TopoJSON for the Nuke map
# Downloads Census Bureau cartographic boundaries and simplifies to reasonable size

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
OUTPUT_DIR="$PROJECT_DIR/nuke_frontend/public/data"
TEMP_DIR=$(mktemp -d)

echo "=== ZCTA TopoJSON Preparation ==="
echo "Temp dir: $TEMP_DIR"
echo "Output: $OUTPUT_DIR"

# Download Census Bureau ZCTA 500k cartographic boundaries (2020)
ZCTA_URL="https://www2.census.gov/geo/tiger/GENZ2020/shp/cb_2020_us_zcta520_500k.zip"
echo ""
echo "Downloading ZCTA boundaries..."
curl -L -o "$TEMP_DIR/zcta.zip" "$ZCTA_URL"

echo "Extracting..."
cd "$TEMP_DIR"
unzip -q zcta.zip

echo "Simplifying with mapshaper..."
# Simplify aggressively to get ~8-10MB TopoJSON
# -simplify dp 15% keeps enough detail for z14 rendering
# -filter-fields keeps only ZCTA5CE20 (the 5-digit zip code)
npx mapshaper cb_2020_us_zcta520_500k.shp \
  -simplify dp 15% keep-shapes \
  -filter-fields ZCTA5CE20 \
  -rename-fields zip=ZCTA5CE20 \
  -o format=topojson "$OUTPUT_DIR/us-zcta-500k.json" quantization=1e5

echo ""
echo "Output file:"
ls -lh "$OUTPUT_DIR/us-zcta-500k.json"

# Cleanup
rm -rf "$TEMP_DIR"
echo ""
echo "Done!"
