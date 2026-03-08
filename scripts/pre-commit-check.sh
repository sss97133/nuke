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

# Design system enforcement: check only staged .tsx/.ts files for NEW violations
echo "Checking design system rules on staged files..."
STAGED_TSX=$(git diff --cached --name-only --diff-filter=ACM -- '*.tsx' '*.ts' | grep '^src/' || true)
if [ -n "$STAGED_TSX" ]; then
    # Run ESLint design-system rules only, fail on errors (warnings are OK for now)
    DS_VIOLATIONS=$(npx eslint --no-error-on-unmatched-pattern --rule '{"design-system/no-hardcoded-colors":"warn","design-system/no-border-radius":"warn","design-system/no-box-shadow":"warn","design-system/no-gradient":"warn","design-system/no-banned-fonts":"warn"}' $STAGED_TSX 2>/dev/null | grep -c "design-system/" || true)
    if [ "$DS_VIOLATIONS" -gt 0 ]; then
        echo "⚠️  $DS_VIOLATIONS design system violations in staged files (warnings — fix before merging)"
    fi
fi

echo "✅ Pre-commit checks passed"
exit 0

