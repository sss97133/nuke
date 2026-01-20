#!/bin/bash
#
# DISCOVERY STATUS - Check in on the discovery snowball system
#
# Usage:
#   ./discovery-status.sh              # Quick status
#   ./discovery-status.sh --detail     # Detailed breakdown
#   ./discovery-status.sh --leads      # Show pending leads
#   ./discovery-status.sh --types      # Show discovered business types
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Load environment (handle whitespace in .env)
if [[ -f "$PROJECT_DIR/.env" ]]; then
  while IFS= read -r line; do
    # Skip comments and empty lines
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "$line" ]] && continue
    # Trim whitespace and export if it matches our vars
    line=$(echo "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    if [[ "$line" =~ ^SUPABASE_URL= ]] || [[ "$line" =~ ^SUPABASE_SERVICE_ROLE_KEY= ]]; then
      export "$line"
    fi
    # Also check for VITE_ prefixed version
    if [[ "$line" =~ ^VITE_SUPABASE_URL= ]] && [[ -z "${SUPABASE_URL:-}" ]]; then
      export SUPABASE_URL="${line#VITE_SUPABASE_URL=}"
    fi
  done < "$PROJECT_DIR/.env"
fi

if [[ -z "${SUPABASE_URL:-}" ]] || [[ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo "ERROR: Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
  exit 1
fi

# Helper to get count
get_count() {
  local table="$1"
  local filter="${2:-}"
  local url="${SUPABASE_URL}/rest/v1/${table}?select=id${filter:+&$filter}"

  curl -sS -I "$url" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Prefer: count=exact" \
    -H "Range: 0-0" 2>/dev/null | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n ' || echo "0"
}

# Helper to query
query() {
  local table="$1"
  local params="${2:-}"

  curl -sS "${SUPABASE_URL}/rest/v1/${table}?${params}" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" 2>/dev/null
}

# Quick status
show_quick_status() {
  echo ""
  echo "=========================================="
  echo "DISCOVERY SNOWBALL STATUS"
  echo "=========================================="
  echo ""

  # Core counts
  local businesses=$(get_count "businesses")
  local sources=$(get_count "scrape_sources")
  local active_sources=$(get_count "scrape_sources" "is_active=eq.true")
  local vehicles=$(get_count "vehicles")

  echo "ENTITIES:"
  echo "  Businesses:      $businesses"
  echo "  Sources:         $sources ($active_sources active)"
  echo "  Vehicles:        $vehicles"
  echo ""

  # Discovery leads (if table exists)
  local pending_leads=$(get_count "discovery_leads" "status=eq.pending" 2>/dev/null || echo "N/A")
  local converted_leads=$(get_count "discovery_leads" "status=eq.converted" 2>/dev/null || echo "N/A")
  local total_leads=$(get_count "discovery_leads" 2>/dev/null || echo "N/A")

  echo "DISCOVERY LEADS:"
  echo "  Pending:         $pending_leads"
  echo "  Converted:       $converted_leads"
  echo "  Total:           $total_leads"
  echo ""

  # YouTube (if table exists)
  local channels=$(get_count "youtube_channels" 2>/dev/null || echo "N/A")
  local videos_pending=$(get_count "youtube_videos" "processing_status=eq.pending" 2>/dev/null || echo "N/A")

  echo "YOUTUBE:"
  echo "  Channels:        $channels"
  echo "  Videos pending:  $videos_pending"
  echo ""

  # Queue
  local queue_pending=$(get_count "import_queue" "status=eq.pending")
  local queue_failed=$(get_count "import_queue" "status=eq.failed")

  echo "IMPORT QUEUE:"
  echo "  Pending:         $queue_pending"
  echo "  Failed:          $queue_failed"
  echo ""
  echo "=========================================="
}

# Detailed breakdown
show_detail() {
  show_quick_status

  echo ""
  echo "BUSINESS TYPES:"
  query "businesses" "select=business_type&order=business_type" | \
    jq -r 'group_by(.business_type) | map({type: .[0].business_type, count: length}) | sort_by(-.count) | .[] | "  \(.type // "null"): \(.count)"' 2>/dev/null || echo "  Could not query"

  echo ""
  echo "SOURCE TYPES:"
  query "scrape_sources" "select=source_type&is_active=eq.true&order=source_type" | \
    jq -r 'group_by(.source_type) | map({type: .[0].source_type, count: length}) | sort_by(-.count) | .[] | "  \(.type // "null"): \(.count)"' 2>/dev/null || echo "  Could not query"

  echo ""
}

# Show pending leads
show_leads() {
  echo ""
  echo "PENDING DISCOVERY LEADS (top 20):"
  echo "=========================================="

  query "discovery_leads" "select=lead_name,lead_url,lead_type,suggested_business_type,confidence_score&status=eq.pending&order=confidence_score.desc&limit=20" | \
    jq -r '.[] | "\(.confidence_score | . * 100 | floor)% | \(.lead_type) | \(.suggested_business_type // "-") | \(.lead_name // .lead_url)"' 2>/dev/null || echo "No leads or table doesn't exist"

  echo ""
}

# Show discovered business types
show_types() {
  echo ""
  echo "DISCOVERED BUSINESS TYPES:"
  echo "=========================================="

  query "business_type_taxonomy" "select=type_name,category,discovery_count&order=discovery_count.desc" | \
    jq -r '.[] | "  \(.type_name) (\(.category)): \(.discovery_count) discoveries"' 2>/dev/null || echo "Taxonomy table doesn't exist yet"

  echo ""
  echo "BUSINESS TYPES IN USE (from businesses table):"
  query "businesses" "select=business_type" | \
    jq -r 'group_by(.business_type) | map({type: .[0].business_type, count: length}) | sort_by(-.count) | .[] | "  \(.type // "unset"): \(.count)"' 2>/dev/null || echo "  Could not query"

  echo ""
}

# Main
case "${1:-}" in
  --detail|-d)
    show_detail
    ;;
  --leads|-l)
    show_leads
    ;;
  --types|-t)
    show_types
    ;;
  --help|-h)
    echo "Discovery Status - Check in on the discovery snowball"
    echo ""
    echo "Usage:"
    echo "  $0              Quick status overview"
    echo "  $0 --detail     Detailed breakdown by type"
    echo "  $0 --leads      Show pending discovery leads"
    echo "  $0 --types      Show discovered business types"
    echo ""
    ;;
  *)
    show_quick_status
    ;;
esac
