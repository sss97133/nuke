#!/bin/bash

# Pre-commit hook to catch build issues before they reach production

set -e

echo "🔍 Pre-commit validation..."
echo ""

cd "$(git rev-parse --show-toplevel)"

# Check if we're in nuke_frontend or root
if [ -d "nuke_frontend" ]; then
    cd nuke_frontend
fi

# Check for missing critical files
MISSING_FILES=()

check_file() {
    if [ ! -f "$1" ]; then
        MISSING_FILES+=("$1")
    fi
}

# Check parts components
check_file "src/components/parts/SpatialPartPopup.tsx"
check_file "src/components/parts/PartCheckoutModal.tsx"
check_file "src/components/parts/PartEnrichmentModal.tsx"
check_file "src/components/parts/ClickablePartModal.tsx"

if [ ${#MISSING_FILES[@]} -ne 0 ]; then
    echo "❌ Missing required files:"
    for file in "${MISSING_FILES[@]}"; do
        echo "   - $file"
    done
    echo ""
    echo "Run: git add src/components/parts/*.tsx"
    exit 1
fi

# Check TypeScript config
if ! grep -q '"baseUrl"' tsconfig.app.json 2>/dev/null; then
    echo "❌ Missing baseUrl in tsconfig.app.json"
    exit 1
fi

# Quick type check (fast)
echo "Running type check..."
if command -v npx &> /dev/null; then
    npx tsc --noEmit --skipLibCheck || {
        echo "❌ TypeScript errors found"
        exit 1
    }
fi

echo "✅ Pre-commit checks passed"
exit 0

