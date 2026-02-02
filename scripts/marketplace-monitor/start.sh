#!/bin/bash

# Facebook Marketplace Monitor Startup Script
# Run this to start monitoring Facebook Marketplace for classic vehicles

cd /Users/skylar/nuke

echo "🚗 Facebook Marketplace Monitor"
echo "================================"
echo ""
echo "This will:"
echo "  1. Open a browser (first time: you'll need to log into Facebook)"
echo "  2. Search Marketplace for classic cars/trucks"
echo "  3. Store findings in Supabase"
echo "  4. Alert you of new listings"
echo ""
echo "Press Ctrl+C to stop."
echo ""

# Load environment variables and run
dotenvx run -- npx tsx scripts/marketplace-monitor/monitor.ts
