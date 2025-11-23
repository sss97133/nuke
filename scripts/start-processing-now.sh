#!/bin/bash

# START PROCESSING NOW - Direct execution with hardcoded credentials

cd /Users/skylar/nuke

echo "🚀 Starting image processing..."
echo ""

# Export credentials directly
export VITE_SUPABASE_URL="https://qkgaybvrernstplzjaam.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFrZ2F5YnZyZXJuc3RwbHpqYWFtIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTcyNzc3NTQzMCwiZXhwIjoxNzQzMzUxNDMwfQ.JvLlgbw5T7yfS6eL8Ct5W0tPJRgzkkBWkEeQI7xJGJg"

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

