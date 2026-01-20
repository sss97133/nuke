#!/bin/bash
#
# RALPH INSPECTOR - Intelligent Data Extraction Inspector
#
# Uses Claude to:
# 1. Inspect what data exists on a page
# 2. Compare against what was extracted
# 3. Identify missing fields
# 4. Detect pollution/junk data
# 5. Handle duplicates intelligently
#
# This is the "intelligent layer" that catches the remaining 60%
# that hardcoded extraction misses.
#
# Usage:
#   ./ralph-inspector.sh inspect <url>           # Inspect a single URL
#   ./ralph-inspector.sh compare <vehicle_id>    # Compare extracted vs available
#   ./ralph-inspector.sh detect-pollution        # Find junk data
#   ./ralph-inspector.sh find-duplicates         # Find duplicate handling opportunities
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$PROJECT_DIR/logs/ralph-inspector"
mkdir -p "$LOG_DIR"

# Load environment
if [[ -f "$PROJECT_DIR/.env" ]]; then
  export $(grep -E "^(SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|FIRECRAWL_API_KEY)=" "$PROJECT_DIR/.env" | xargs)
fi

# Check for Claude CLI
if ! command -v claude &> /dev/null; then
  echo "ERROR: Claude CLI not found. Install with: npm install -g @anthropic-ai/claude-cli"
  exit 1
fi

# Inspect a URL and identify all available data
inspect_url() {
  local url="$1"
  local output_file="$LOG_DIR/inspect-$(date +%s).json"

  echo "RALPH INSPECTOR: Inspecting $url"
  echo ""

  # First, fetch the page content
  echo "Step 1: Fetching page content..."
  local page_content
  page_content=$(curl -sS "$url" \
    -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" \
    --max-time 30 2>/dev/null | head -c 50000)  # Limit to 50KB

  if [[ -z "$page_content" ]]; then
    echo "ERROR: Could not fetch page content"
    return 1
  fi

  echo "Step 2: Analyzing with Claude..."

  # Use Claude to analyze what data is available
  local analysis
  analysis=$(echo "$page_content" | claude --print -p "
You are a vehicle data extraction expert. Analyze this HTML page and identify ALL available vehicle data fields.

Your task:
1. Identify every piece of vehicle data on this page
2. Categorize each field (basic_info, specs, history, pricing, media, seller)
3. Note the CSS selector or extraction method for each
4. Flag any potential pollution (ads, unrelated content, junk data)

Output as JSON:
{
  \"url\": \"$url\",
  \"page_type\": \"listing|search|dealer|auction\",
  \"available_fields\": [
    {
      \"field_name\": \"year\",
      \"value\": \"1985\",
      \"category\": \"basic_info\",
      \"selector\": \".listing-year\",
      \"confidence\": 0.95
    }
  ],
  \"potential_pollution\": [
    {
      \"type\": \"ad|unrelated|duplicate\",
      \"description\": \"what and why\"
    }
  ],
  \"extraction_difficulty\": \"easy|medium|hard\",
  \"notes\": \"any special observations\"
}

Only output the JSON, nothing else.
")

  echo "$analysis" > "$output_file"
  echo ""
  echo "Analysis saved to: $output_file"
  echo ""
  echo "$analysis" | jq '.' 2>/dev/null || echo "$analysis"
}

# Compare what we extracted vs what's available
compare_extraction() {
  local vehicle_id="$1"

  echo "RALPH INSPECTOR: Comparing extraction for vehicle $vehicle_id"
  echo ""

  # Get the vehicle data from Supabase
  echo "Step 1: Fetching extracted data..."
  local vehicle_data
  vehicle_data=$(curl -sS "${SUPABASE_URL}/rest/v1/vehicles?id=eq.${vehicle_id}&select=*" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" 2>/dev/null)

  local source_url
  source_url=$(echo "$vehicle_data" | jq -r '.[0].discovery_url // .[0].listing_url // empty')

  if [[ -z "$source_url" ]]; then
    echo "ERROR: No source URL found for vehicle"
    return 1
  fi

  echo "Source URL: $source_url"
  echo ""

  # Fetch the original page
  echo "Step 2: Fetching original page..."
  local page_content
  page_content=$(curl -sS "$source_url" \
    -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)" \
    --max-time 30 2>/dev/null | head -c 50000)

  # Use Claude to compare
  echo "Step 3: Comparing with Claude..."

  local comparison
  comparison=$(echo "EXTRACTED DATA:
$vehicle_data

ORIGINAL PAGE:
$page_content" | claude --print -p "
Compare the extracted vehicle data against the original page content.

Identify:
1. Fields that were correctly extracted
2. Fields that exist on the page but were NOT extracted (MISSING)
3. Fields that were extracted incorrectly (ERRORS)
4. Any pollution that was incorrectly included

Output as JSON:
{
  \"vehicle_id\": \"$vehicle_id\",
  \"extraction_completeness\": 0.85,
  \"correctly_extracted\": [\"year\", \"make\", \"model\"],
  \"missing_fields\": [
    {
      \"field\": \"transmission\",
      \"available_value\": \"4-speed manual\",
      \"selector\": \".specs-transmission\"
    }
  ],
  \"errors\": [
    {
      \"field\": \"mileage\",
      \"extracted\": \"12000\",
      \"actual\": \"120000\",
      \"issue\": \"missing zero\"
    }
  ],
  \"pollution_detected\": [],
  \"recommended_actions\": []
}

Only output the JSON, nothing else.
")

  echo ""
  echo "$comparison" | jq '.' 2>/dev/null || echo "$comparison"
}

# Detect pollution in recent extractions
detect_pollution() {
  echo "RALPH INSPECTOR: Scanning for data pollution..."
  echo ""

  # Get recent vehicles with potential issues
  local recent_vehicles
  recent_vehicles=$(curl -sS "${SUPABASE_URL}/rest/v1/vehicles?select=id,year,make,model,description&order=created_at.desc&limit=20" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" 2>/dev/null)

  echo "Analyzing 20 recent vehicles for pollution..."
  echo ""

  # Use Claude to identify pollution patterns
  local analysis
  analysis=$(echo "$recent_vehicles" | claude --print -p "
Analyze these vehicle records for data pollution:

Types of pollution to detect:
1. Junk/placeholder data (N/A, TBD, unknown, etc.)
2. HTML/code artifacts in text fields
3. Obvious errors (year 1800, price \$1)
4. Unrelated content (ads, disclaimers in wrong fields)
5. Encoding issues (weird characters)

For each vehicle, identify:
- Pollution detected (yes/no)
- Type of pollution
- Affected fields
- Suggested fix

Output as JSON array.
")

  echo "$analysis" | jq '.' 2>/dev/null || echo "$analysis"
}

# Find duplicate handling opportunities
find_duplicates() {
  echo "RALPH INSPECTOR: Finding duplicate data opportunities..."
  echo ""

  # Get vehicles that might be duplicates
  local vehicles
  vehicles=$(curl -sS "${SUPABASE_URL}/rest/v1/vehicles?select=id,vin,year,make,model,listing_url,discovery_url,created_at&order=vin&limit=100" \
    -H "apikey: ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" 2>/dev/null)

  echo "Analyzing for duplicate patterns..."
  echo ""

  # Use Claude to identify duplicates
  local analysis
  analysis=$(echo "$vehicles" | claude --print -p "
Analyze these vehicles for duplicates. Remember:

GOOD duplicates (keep both, cross-reference):
- Same VIN from different sources (BaT + Craigslist)
- Same car listed at different times (price history)

BAD duplicates (merge/remove):
- Same listing scraped twice
- Identical data with no new information

For each potential duplicate set:
1. Identify the vehicles involved
2. Classify as GOOD (multi-source verification) or BAD (redundant)
3. Note what data differs (valuable time-series data)
4. Recommend action

Output as JSON:
{
  \"duplicate_sets\": [
    {
      \"vehicles\": [\"id1\", \"id2\"],
      \"type\": \"good|bad\",
      \"reason\": \"same VIN, different sources\",
      \"unique_data_points\": [\"sale_price differs\", \"sale_date differs\"],
      \"action\": \"link_as_citations|merge|delete_duplicate\"
    }
  ],
  \"summary\": {
    \"good_duplicates\": 5,
    \"bad_duplicates\": 2,
    \"action_required\": 2
  }
}
")

  echo "$analysis" | jq '.' 2>/dev/null || echo "$analysis"
}

# Main
main() {
  case "${1:-}" in
    inspect)
      if [[ -z "${2:-}" ]]; then
        echo "Usage: $0 inspect <url>"
        exit 1
      fi
      inspect_url "$2"
      ;;
    compare)
      if [[ -z "${2:-}" ]]; then
        echo "Usage: $0 compare <vehicle_id>"
        exit 1
      fi
      compare_extraction "$2"
      ;;
    detect-pollution)
      detect_pollution
      ;;
    find-duplicates)
      find_duplicates
      ;;
    *)
      echo "RALPH INSPECTOR - Intelligent Data Extraction Inspector"
      echo ""
      echo "Usage:"
      echo "  $0 inspect <url>           Inspect what data is available on a page"
      echo "  $0 compare <vehicle_id>    Compare extracted vs available data"
      echo "  $0 detect-pollution        Find junk/pollution in recent extractions"
      echo "  $0 find-duplicates         Find duplicate handling opportunities"
      echo ""
      ;;
  esac
}

main "$@"
