#!/bin/bash
# Pre-commit hook to check build before pushing
# This prevents pushing code that will fail in CI

set -e

echo "🔍 Pre-commit: Checking build..."

cd nuke_frontend

# Check if critical files exist
echo "Checking critical component files..."
MISSING=0
for file in "src/components/parts/SpatialPartPopup.tsx" "src/components/parts/PartCheckoutModal.tsx" "src/components/parts/PartEnrichmentModal.tsx" "src/components/parts/ClickablePartModal.tsx"; do
  if [ ! -f "$file" ]; then
    echo "❌ Missing: $file"
    MISSING=1
  fi
done

if [ $MISSING -eq 1 ]; then
  echo "❌ Critical files missing - commit blocked"
  exit 1
fi

# Quick type check (fast)
echo "Running type check..."
if ! npm run type-check > /dev/null 2>&1; then
  echo "⚠️  Type check failed, but continuing..."
fi

# Try build (this is the real test)
echo "Attempting build..."
if ! npm run build > /tmp/build-check.log 2>&1; then
  echo "❌ Build failed! Check /tmp/build-check.log for details"
  echo "Last 20 lines:"
  tail -20 /tmp/build-check.log
  exit 1
fi

echo "✅ Build check passed"
exit 0

