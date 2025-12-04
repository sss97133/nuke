#!/bin/bash

# START PROCESSING NOW - Load credentials from environment

cd /Users/skylar/nuke

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Validate required environment variables
if [ -z "$VITE_SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required"
  echo "Please check your .env file"
  exit 1
fi

echo "🚀 Starting image processing..."
echo ""

echo "Processing 2,742 images with Claude 3 Haiku..."
echo "Cost: ~\$8-11"
echo "Time: ~1 hour"
echo ""
echo "Watch progress:"
echo "  tail -f /tmp/processing.log"
echo "  OR visit: https://n-zero.dev/admin/image-processing"
echo ""

# Run with output to log file
node scripts/tiered-batch-processor.js > /tmp/processing.log 2>&1 &
PID=$!

echo "✅ Processing started (PID: $PID)"
echo ""

sleep 5

# Show first results
echo "First results:"
tail -20 /tmp/processing.log

echo ""
echo "Monitor live:"
echo "  tail -f /tmp/processing.log"

