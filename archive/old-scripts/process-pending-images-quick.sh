#!/bin/bash
# Quick script to process pending images using Node.js

cd "$(dirname "$0")/.."

echo "🚀 Processing pending images..."
echo ""

# Check if we have the right environment
if [ ! -f "nuke_frontend/.env.local" ] && [ ! -f "nuke_frontend/.env" ]; then
  echo "⚠️  No .env file found. Using default Supabase URL."
fi

# Run the script
node -e "
import('./scripts/process-all-pending-images.js').then(m => {
  const batchSize = parseInt(process.argv[2]) || 10;
  const maxBatches = parseInt(process.argv[3]) || 10;
  m.processPendingImages(batchSize, maxBatches).catch(console.error);
});
" "$@"
