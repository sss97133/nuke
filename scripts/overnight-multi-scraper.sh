#!/bin/bash
# Overnight Multi-Source Scraper
# Runs discovery scrapers in parallel background processes

cd /Users/skylar/nuke

echo "╔════════════════════════════════════════════════════════════╗"
echo "║  OVERNIGHT MULTI-SCRAPER                                   ║"
echo "║  Sources: PCarMarket, Mecum, Hagerty                       ║"
echo "║  (Hemmings excluded - rate limiting issues)                ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Kill any existing scrapers
pkill -f "pcarmarket-fast-discover" 2>/dev/null
pkill -f "mecum-fast-discover" 2>/dev/null
pkill -f "hagerty-fast-discover" 2>/dev/null

sleep 2

echo "Starting scrapers..."
echo ""

# PCarMarket - scroll-based, 200 iterations
echo "→ PCarMarket starting..."
dotenvx run -- node scripts/pcarmarket-fast-discover.js 200 3 > /tmp/pcarmarket-fast.log 2>&1 &
PCAR_PID=$!
echo "  PID: $PCAR_PID → /tmp/pcarmarket-fast.log"

# Mecum - 22 auctions × 50 pages each = 1100 pages total
echo "→ Mecum starting..."
dotenvx run -- node scripts/mecum-fast-discover.js 50 3 > /tmp/mecum-fast.log 2>&1 &
MECUM_PID=$!
echo "  PID: $MECUM_PID → /tmp/mecum-fast.log"

# Hagerty - 500 pages
echo "→ Hagerty starting..."
dotenvx run -- node scripts/hagerty-fast-discover.js 500 3 > /tmp/hagerty-fast.log 2>&1 &
HAGERTY_PID=$!
echo "  PID: $HAGERTY_PID → /tmp/hagerty-fast.log"

echo ""
echo "All scrapers started. Monitor with:"
echo "  tail -f /tmp/pcarmarket-fast.log"
echo "  tail -f /tmp/mecum-fast.log"
echo "  tail -f /tmp/hagerty-fast.log"
echo ""
echo "Check status:"
echo "  ps aux | grep fast-discover"
echo ""
echo "PIDs: $PCAR_PID $MECUM_PID $HAGERTY_PID"
