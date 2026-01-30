#!/bin/bash
#
# 2-HOUR NAIVE VS PLAYWRIGHT EXTRACTION COMPARISON
#
# Compares cheap/fast naive fetch against compute-heavy Playwright
# to classify sites by extraction difficulty.
#
# Deliverables after 2 hours:
# 1. JSON reports in /extraction-comparison-results/
# 2. CSV exports ready for graphing
# 3. Site difficulty classification (easy/medium/hard)
#
# Expected coverage: ~200-400 URLs (depending on site response times)
# Avg time per URL: 8-15 seconds (2 methods in parallel)
#

set -e
cd /Users/skylar/nuke

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  NAIVE vs PLAYWRIGHT EXTRACTION COMPARISON                 ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║  Started: $(date)"
echo "║  Expected completion: 2 hours from now                     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Pre-flight checks
echo "=== PRE-FLIGHT CHECKS ==="
echo ""

# 1. Check Node/tsx
echo -n "✓ Node.js: "
node --version

# 2. Check Playwright
echo -n "✓ Playwright: "
if [ -d "node_modules/playwright" ]; then
  echo "installed"
else
  echo "installing..."
  npm install playwright
fi

# 3. Check results directory
echo -n "✓ Results directory: "
mkdir -p /Users/skylar/nuke/extraction-comparison-results/csv
echo "ready"

# 4. Check test sites response
echo -n "✓ Network connectivity: "
curl -s -o /dev/null -w "%{http_code}" https://bringatrailer.com && echo " OK" || echo " FAIL"

echo ""
echo "=== DELIVERY EXPECTATIONS ==="
echo ""
echo "After 2 hours you will have:"
echo "  1. Comparison data for 200-400 URLs across difficulty levels"
echo "  2. JSON reports in extraction-comparison-results/"
echo "  3. Run 'npm run compare:export-csv' for graphable CSV files"
echo "  4. Site difficulty classification (easy/medium/hard)"
echo ""
echo "Metrics captured:"
echo "  - Success rate: Naive vs Playwright"
echo "  - Quality score: 0-100 per method"
echo "  - Timing: Naive (~500ms) vs Playwright (~6s)"
echo "  - Vehicle data extraction accuracy"
echo "  - Site difficulty classification"
echo ""

# Create URL list from test sites + database
echo "=== BUILDING URL LIST ==="

# Start with curated test sites covering various difficulties
cat > /tmp/comparison-urls.txt << 'URLS'
# Easy sites - simple HTML, good structure (naive should work)
https://bringatrailer.com/listing/1988-porsche-911-carrera-targa-50/
https://bringatrailer.com/listing/1973-porsche-911t-targa-3/
https://bringatrailer.com/listing/1967-chevrolet-c10/
https://www.hemmings.com/classifieds/dealer/chevrolet/c10/2729389.html

# Medium difficulty - some JS, may need Playwright
https://www.carsandbids.com/auctions/
https://www.dupontregistry.com/autos/listing/2024/porsche/911/4016155
https://www.hagerty.com/apps/valuationtools/market-trends/1973/Porsche/911%20S

# Hard sites - heavy JS, lazy loading, SPAs
https://www.pcarmarket.com/auctions/
https://collectingcars.com/for-sale/
https://rfrm.com/inventory/
URLS

URL_COUNT=$(grep -v "^#" /tmp/comparison-urls.txt | grep -v "^$" | wc -l | tr -d ' ')
echo "Loaded $URL_COUNT curated test URLs"

# Try to add URLs from database
echo -n "Querying database for more URLs... "
if [ -n "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  curl -s "${VITE_SUPABASE_URL:-https://qkgaybvrernstplzjaam.supabase.co}/rest/v1/vehicles?select=listing_url&listing_url=not.is.null&limit=200" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" 2>/dev/null | \
    grep -oE '"listing_url":"[^"]+"' | \
    sed 's/"listing_url":"//g;s/"//g' >> /tmp/comparison-urls.txt 2>/dev/null && \
    echo "added database URLs" || echo "failed (continuing with curated list)"
else
  echo "skipped (no SUPABASE_SERVICE_ROLE_KEY)"
fi

TOTAL_URLS=$(grep -v "^#" /tmp/comparison-urls.txt | grep -v "^$" | sort -u | wc -l | tr -d ' ')
echo "Total unique URLs to process: $TOTAL_URLS"
echo ""

# Calculate timeout (2 hours = 7200 seconds)
TIMEOUT=7200
START_TIME=$(date +%s)
END_TIME=$((START_TIME + TIMEOUT))

echo "=== STARTING 2-HOUR RUN ==="
echo "Running until $(date -d @$END_TIME 2>/dev/null || date -r $END_TIME)"
echo "Press Ctrl+C to stop early"
echo ""

# Run the batch comparison
npx tsx scripts/parallel-free-vs-paid-extractor.ts --batch /tmp/comparison-urls.txt 2>&1

echo ""
echo "=== GENERATING CSV EXPORTS ==="
npx tsx scripts/export-comparison-csv.ts 2>&1

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                    RUN COMPLETE                            ║"
echo "╠════════════════════════════════════════════════════════════╣"
echo "║  Results: /Users/skylar/nuke/extraction-comparison-results ║"
echo "║                                                            ║"
echo "║  Files generated:                                          ║"
echo "║    - comparison-*.json  (raw data)                         ║"
echo "║    - csv/summary.csv    (per-URL comparison)               ║"
echo "║    - csv/methods.csv    (all extraction attempts)          ║"
echo "║    - csv/investor-deck.csv (aggregate stats)               ║"
echo "║    - csv/domain-breakdown.csv (per-domain analysis)        ║"
echo "╚════════════════════════════════════════════════════════════╝"
