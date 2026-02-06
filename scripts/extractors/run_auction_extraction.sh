#!/bin/bash
#
# Master Auction Data Extraction Script
# Target: 100K+ records from Barrett-Jackson, Mecum, and other high-end auctions
#
# Run this to populate the auction data:
#   ./run_auction_extraction.sh --all
#   ./run_auction_extraction.sh --major
#   ./run_auction_extraction.sh --test
#

set -e
cd /Users/skylar/nuke

echo "=============================================="
echo "AUCTION DATA EXTRACTION PIPELINE"
echo "Target: 100K+ records"
echo "Started: $(date)"
echo "=============================================="

# Create output directories
mkdir -p data/glenmarch data/barrett_jackson data/conceptcarz

# Install dependencies if needed
pip3 install -q requests beautifulsoup4 lxml 2>/dev/null || true

case "$1" in
  --test)
    echo ""
    echo "=== TEST MODE: Small sample ==="
    echo ""

    echo "Testing Glenmarch (Barrett-Jackson house only, 2 auctions)..."
    python3 scripts/extractors/glenmarch_extractor.py --houses 40 --limit 2

    echo ""
    echo "Testing Barrett-Jackson (years 2024-2025)..."
    python3 scripts/extractors/barrett_jackson_extractor.py --years 2024-2025
    ;;

  --major)
    echo ""
    echo "=== MAJOR HOUSES: BJ, Mecum, RM, Gooding, Bonhams ==="
    echo ""

    # Glenmarch has all of them aggregated
    echo "Extracting from Glenmarch (major houses)..."
    python3 scripts/extractors/glenmarch_extractor.py --major

    # Also hit BJ directly for completeness
    echo ""
    echo "Extracting from Barrett-Jackson Archive (2015-2026)..."
    python3 scripts/extractors/barrett_jackson_extractor.py --years 2015-2026
    ;;

  --all)
    echo ""
    echo "=== FULL EXTRACTION: All sources ==="
    echo ""

    # Glenmarch - all 80+ houses
    echo "Extracting from Glenmarch (all houses)..."
    python3 scripts/extractors/glenmarch_extractor.py --all

    # Barrett-Jackson direct
    echo ""
    echo "Extracting from Barrett-Jackson Archive (2000-2026)..."
    python3 scripts/extractors/barrett_jackson_extractor.py --all

    # Conceptcarz if available
    echo ""
    echo "Extracting from Conceptcarz..."
    python3 scripts/extractors/conceptcarz_extractor.py --events --makes
    ;;

  --import)
    echo ""
    echo "=== IMPORTING TO DATABASE ==="
    echo ""

    # Find latest extraction files
    LATEST_GLENMARCH=$(ls -t data/glenmarch/*.json 2>/dev/null | head -1)
    LATEST_BJ=$(ls -t data/barrett_jackson/*.json 2>/dev/null | head -1)

    if [ -n "$LATEST_GLENMARCH" ]; then
      echo "Importing Glenmarch: $LATEST_GLENMARCH"
      python3 scripts/extractors/import_auction_data.py "$LATEST_GLENMARCH"
    fi

    if [ -n "$LATEST_BJ" ]; then
      echo "Importing Barrett-Jackson: $LATEST_BJ"
      python3 scripts/extractors/import_auction_data.py "$LATEST_BJ"
    fi
    ;;

  --status)
    echo ""
    echo "=== EXTRACTION STATUS ==="
    echo ""

    echo "Extracted data:"
    for dir in data/glenmarch data/barrett_jackson data/conceptcarz; do
      if [ -d "$dir" ]; then
        count=$(find "$dir" -name "*.json" -exec cat {} \; 2>/dev/null | grep -c '"year"' || echo 0)
        echo "  $dir: ~$count records"
      fi
    done

    echo ""
    echo "Database status:"
    PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "
    SELECT
      CASE
        WHEN listing_url LIKE '%bringatrailer%' THEN 'BaT'
        WHEN listing_url LIKE '%carsandbids%' THEN 'C&B'
        WHEN listing_url LIKE '%rmsothebys%' THEN 'RM Sothebys'
        WHEN listing_url LIKE '%mecum%' THEN 'Mecum'
        WHEN listing_url LIKE '%barrett%' THEN 'Barrett-Jackson'
        WHEN listing_url LIKE '%glenmarch%' THEN 'Glenmarch'
        ELSE 'Other'
      END as source,
      COUNT(*) as vehicles
    FROM vehicles
    GROUP BY 1
    ORDER BY 2 DESC;
    "
    ;;

  *)
    echo "Usage: $0 [--test|--major|--all|--import|--status]"
    echo ""
    echo "  --test    Run small test extraction"
    echo "  --major   Extract from major houses (BJ, Mecum, RM, etc.)"
    echo "  --all     Full extraction from all sources"
    echo "  --import  Import extracted data to database"
    echo "  --status  Show extraction and database status"
    echo ""
    echo "Recommended workflow:"
    echo "  1. ./run_auction_extraction.sh --test"
    echo "  2. ./run_auction_extraction.sh --major"
    echo "  3. ./run_auction_extraction.sh --import"
    echo "  4. ./run_auction_extraction.sh --status"
    ;;
esac

echo ""
echo "=============================================="
echo "Completed: $(date)"
echo "=============================================="
