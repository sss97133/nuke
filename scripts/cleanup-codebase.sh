#!/bin/bash

# Major Codebase Cleanup Script
# Archives old files, moves logs, organizes documentation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ARCHIVE_DIR="$PROJECT_ROOT/archive"
LOCAL_ARCHIVE="$HOME/nuke-archive-$(date +%Y%m%d)"

echo "🧹 MAJOR CODEBASE CLEANUP"
echo "========================"
echo ""
echo "Project root: $PROJECT_ROOT"
echo "Archive dir: $ARCHIVE_DIR"
echo "Local archive: $LOCAL_ARCHIVE"
echo ""

# Create local archive directory
mkdir -p "$LOCAL_ARCHIVE"/{docs,logs,sql,scripts,status-files}

# Categories of files to archive
cd "$PROJECT_ROOT"

echo "📋 Step 1: Identifying files to archive..."
echo ""

# 1. Old status/fix/summary markdown files (completed work)
STATUS_FILES=(
  "*_STATUS.md"
  "*_FIX*.md"
  "*_SUMMARY.md"
  "*_COMPLETE*.md"
  "*_READY.md"
  "*_NOW.md"
  "*_RECAP.md"
  "SESSION_*.md"
  "WHY_*.md"
  "WHERE_*.md"
  "WHAT*.md"
  "FIX_*.md"
  "DEPLOY_*.md"
  "APPLY_*.md"
  "START_*.md"
  "INVOKE_*.md"
  "TEST_*.md"
  "RUN_THIS*.md"
  "PASTE_THIS*.md"
  "REMOVE_*.md"
  "URGENT_*.md"
  "TONIGHT_*.md"
  "NEXT_*.md"
  "PRIORITY_*.md"
)

# 2. Log files
LOG_FILES=(
  "*.log"
  "*.pid"
  "*.txt"
)

# 3. Old SQL files in root
SQL_FILES=(
  "*.sql"
)

# 4. Old JSON/HTML scraped data
DATA_FILES=(
  "lmc-*.json"
  "lmc-*.html"
  "lmc-*.md"
  "lmc-*.log"
  "catalog-*.log"
  "assembly-*.log"
  "image-scraping.log"
  "tier1_analysis_errors.log"
)

# 5. Old JavaScript files in root
OLD_JS=(
  "check_vehicle_data.js"
)

echo "📦 Step 2: Archiving status/fix/summary files..."
COUNT=0
for pattern in "${STATUS_FILES[@]}"; do
  for file in $pattern; do
    if [ -f "$file" ] && [ "$file" != "README.md" ]; then
      echo "  → $file"
      mv "$file" "$LOCAL_ARCHIVE/status-files/" 2>/dev/null || true
      COUNT=$((COUNT + 1))
    fi
  done
done
echo "  Archived $COUNT status files"
echo ""

echo "📋 Step 3: Archiving log files..."
COUNT=0
for pattern in "${LOG_FILES[@]}"; do
  for file in $pattern; do
    if [ -f "$file" ]; then
      echo "  → $file"
      mv "$file" "$LOCAL_ARCHIVE/logs/" 2>/dev/null || true
      COUNT=$((COUNT + 1))
    fi
  done
done
echo "  Archived $COUNT log files"
echo ""

echo "🗄️  Step 4: Archiving SQL files from root..."
COUNT=0
for pattern in "${SQL_FILES[@]}"; do
  for file in $pattern; do
    if [ -f "$file" ] && [ "$file" != "*.sql" ]; then
      echo "  → $file"
      mv "$file" "$LOCAL_ARCHIVE/sql/" 2>/dev/null || true
      COUNT=$((COUNT + 1))
    fi
  done
done
echo "  Archived $COUNT SQL files"
echo ""

echo "📊 Step 5: Archiving old data files..."
COUNT=0
for pattern in "${DATA_FILES[@]}"; do
  for file in $pattern; do
    if [ -f "$file" ]; then
      echo "  → $file"
      mv "$file" "$LOCAL_ARCHIVE/logs/" 2>/dev/null || true
      COUNT=$((COUNT + 1))
    fi
  done
done
echo "  Archived $COUNT data files"
echo ""

echo "📜 Step 6: Archiving old JS files..."
COUNT=0
for pattern in "${OLD_JS[@]}"; do
  for file in $pattern; do
    if [ -f "$file" ]; then
      echo "  → $file"
      mv "$file" "$LOCAL_ARCHIVE/scripts/" 2>/dev/null || true
      COUNT=$((COUNT + 1))
    fi
  done
done
echo "  Archived $COUNT JS files"
echo ""

echo "📚 Step 7: Moving old documentation to archive..."
# Move old implementation/complete docs to archive
OLD_DOCS=(
  "AUTONOMOUS_AGENTS*.md"
  "BAT_*.md"
  "BUILD_*.md"
  "BUNDLE_*.md"
  "CAMERON_*.md"
  "CATALOG_*.md"
  "CLASSIC_*.md"
  "COMPLETE_*.md"
  "COMPREHENSIVE_*.md"
  "CONSOLIDATION_*.md"
  "CORRECT_*.md"
  "CRAIGSLIST_*.md"
  "CSV_*.md"
  "CURATOR_*.md"
  "DATA_*.md"
  "DEBUG_*.md"
  "FACEBOOK_*.md"
  "FLUID_*.md"
  "GITHUB_*.md"
  "HIGH_*.md"
  "IDEAL_*.md"
  "IMAGE_*.md"
  "IMPLEMENTATION_*.md"
  "INDEX_*.md"
  "INGESTION_*.md"
  "INVESTMENT_*.md"
  "KNOWLEDGE_*.md"
  "NEXT_*.md"
  "ORG_*.md"
  "OVERNIGHT_*.md"
  "PARTICIPANT_*.md"
  "PRICE_*.md"
  "PROFILE_*.md"
  "REALITY_*.md"
  "RECEIPT_*.md"
  "ROADMAP.md"
  "SCALE_*.md"
  "SCAN_*.md"
  "SCRAPER_*.md"
  "SEARCH_*.md"
  "SPID_*.md"
  "SQUAREBODY_*.md"
  "SYNC_*.md"
  "THE_*.md"
  "TOOL_*.md"
  "TOOLING_*.md"
  "UI_*.md"
  "UNIFIED_*.md"
  "VALUE_*.md"
  "VERIFICATION_*.md"
  "VERIFIED_*.md"
  "VIDEO_*.md"
  "WILD_*.md"
  "WIREFRAME_*.md"
  "YOUR_*.md"
  "API_*.md"
  "AUTH_*.md"
  "AUTO_*.md"
)

COUNT=0
for pattern in "${OLD_DOCS[@]}"; do
  for file in $pattern; do
    if [ -f "$file" ] && [ "$file" != "README.md" ]; then
      echo "  → $file"
      mv "$file" "$LOCAL_ARCHIVE/docs/" 2>/dev/null || true
      COUNT=$((COUNT + 1))
    fi
  done
done
echo "  Archived $COUNT documentation files"
echo ""

# Also move to project archive for git tracking
echo "📦 Step 8: Moving to project archive (for git)..."
mkdir -p "$ARCHIVE_DIR/root-docs-$(date +%Y%m%d)"
if [ -d "$LOCAL_ARCHIVE/docs" ] && [ "$(ls -A $LOCAL_ARCHIVE/docs 2>/dev/null)" ]; then
  cp -r "$LOCAL_ARCHIVE/docs/"* "$ARCHIVE_DIR/root-docs-$(date +%Y%m%d)/" 2>/dev/null || true
fi

echo ""
echo "✅ CLEANUP COMPLETE"
echo "=================="
echo ""
echo "📊 Summary:"
echo "  Local archive: $LOCAL_ARCHIVE"
echo "  Project archive: $ARCHIVE_DIR/root-docs-$(date +%Y%m%d)"
echo ""
echo "📋 Remaining root files:"
ls -1 *.md 2>/dev/null | head -10 || echo "  (none or very few)"
echo ""
echo "💡 Next steps:"
echo "  1. Review archived files in: $LOCAL_ARCHIVE"
echo "  2. Delete local archive if satisfied: rm -rf $LOCAL_ARCHIVE"
echo "  3. Commit changes: git add archive/ && git commit -m 'Archive old root files'"
echo ""


