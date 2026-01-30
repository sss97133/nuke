#!/bin/bash
# INSIGHT ENRICHMENT - Layer 2
# Takes raw extraction, enriches with domain knowledge

cd /Users/skylar/nuke
export $(grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY|VITE_SUPABASE_ANON_KEY)=' .env | xargs)

VEHICLE_ID="$1"

if [ -z "$VEHICLE_ID" ]; then
    echo "Usage: ./scripts/enrich-insights.sh <vehicle_id>"
    exit 1
fi

echo "=== ENRICHING INSIGHTS FOR $VEHICLE_ID ==="

# 1. Get vehicle info
VEHICLE=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/vehicles?select=year,make,model&id=eq.${VEHICLE_ID}" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "apikey: ${VITE_SUPABASE_ANON_KEY}" | jq '.[0]')

YEAR=$(echo "$VEHICLE" | jq -r '.year')
MAKE=$(echo "$VEHICLE" | jq -r '.make')
MODEL=$(echo "$VEHICLE" | jq -r '.model')

echo "Vehicle: $YEAR $MAKE $MODEL"
echo ""

# 2. Get existing extraction
EXTRACTION=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/observation_discoveries?select=raw_extraction&vehicle_id=eq.${VEHICLE_ID}&discovery_type=eq.sentiment&limit=1" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "apikey: ${VITE_SUPABASE_ANON_KEY}" | jq '.[0].raw_extraction')

echo "=== RAW EXTRACTION ==="
echo "$EXTRACTION" | jq '{themes, red_flags, highlights}'
echo ""

# 3. Get known issues for this vehicle
echo "=== KNOWN ISSUES FOR $MAKE $MODEL ==="
KNOWN_ISSUES=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/vehicle_known_issues?select=issue_name,issue_slug,common_names,severity,symptoms,typical_cost_min,typical_cost_max&make=eq.${MAKE}&or=(model.is.null,model.eq.${MODEL})&or=(year_start.is.null,year_start.lte.${YEAR})&or=(year_end.is.null,year_end.gte.${YEAR})" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "apikey: ${VITE_SUPABASE_ANON_KEY}" 2>/dev/null)

if [ "$(echo "$KNOWN_ISSUES" | jq 'length')" -gt 0 ]; then
    echo "$KNOWN_ISSUES" | jq -r '.[] | "• \(.issue_name) (\(.severity)) - $\(.typical_cost_min/100)-$\(.typical_cost_max/100)"'
else
    echo "No known issues in database for this vehicle"
fi
echo ""

# 4. Get terminology matches
echo "=== TERMINOLOGY MATCHES ==="

# Extract all text from extraction
ALL_TEXT=$(echo "$EXTRACTION" | jq -r '[.themes[]?, .red_flags[]?, .highlights[]?] | join(" ")' | tr '[:upper:]' '[:lower:]')

# Check each term
TERMS=$(curl -sS "${VITE_SUPABASE_URL}/rest/v1/domain_terminology?select=term,canonical_meaning,sentiment&or=(applies_to_makes.is.null,applies_to_makes.cs.{${MAKE}})" \
    -H "Authorization: Bearer ${SUPABASE_SERVICE_ROLE_KEY}" \
    -H "apikey: ${VITE_SUPABASE_ANON_KEY}" 2>/dev/null)

MATCHES=""
while IFS= read -r term; do
    term_lower=$(echo "$term" | jq -r '.term' | tr '[:upper:]' '[:lower:]')
    if echo "$ALL_TEXT" | grep -qi "$term_lower"; then
        meaning=$(echo "$term" | jq -r '.canonical_meaning')
        sentiment=$(echo "$term" | jq -r '.sentiment')
        MATCHES="$MATCHES\n• \"$term_lower\" = $meaning [$sentiment]"
    fi
done < <(echo "$TERMS" | jq -c '.[]')

if [ -n "$MATCHES" ]; then
    echo -e "$MATCHES"
else
    echo "No terminology matches found"
fi
echo ""

# 5. Cross-reference red flags with known issues
echo "=== ENRICHED RED FLAGS ==="
RED_FLAGS=$(echo "$EXTRACTION" | jq -r '.red_flags[]?' 2>/dev/null)

if [ -n "$RED_FLAGS" ]; then
    while IFS= read -r flag; do
        flag_lower=$(echo "$flag" | tr '[:upper:]' '[:lower:]')

        # Check if matches a known issue
        MATCH=$(echo "$KNOWN_ISSUES" | jq -r --arg flag "$flag_lower" '
            .[] | select(
                (.issue_name | ascii_downcase | contains($flag)) or
                (.common_names[]? | ascii_downcase | contains($flag)) or
                (.symptoms[]? | ascii_downcase | contains($flag))
            ) | {issue_name, severity, cost_range: "\(.typical_cost_min/100)-\(.typical_cost_max/100)"}
        ' 2>/dev/null | head -1)

        if [ -n "$MATCH" ] && [ "$MATCH" != "" ]; then
            echo "✓ \"$flag\""
            echo "  → KNOWN ISSUE: $(echo "$MATCH" | jq -r '.issue_name')"
            echo "  → Severity: $(echo "$MATCH" | jq -r '.severity')"
            echo "  → Typical cost: \$$(echo "$MATCH" | jq -r '.cost_range')"
            echo "  → ACTION: Get quote, document repair for content"
        else
            echo "? \"$flag\""
            echo "  → No known issue match - needs verification"
        fi
        echo ""
    done <<< "$RED_FLAGS"
else
    echo "No red flags to enrich"
fi

# 6. Summary
echo "=== ENRICHMENT SUMMARY ==="
echo "Raw red flags: $(echo "$EXTRACTION" | jq '.red_flags | length')"
echo "Matched to known issues: $(echo "$KNOWN_ISSUES" | jq 'length')"
echo "Terminology matches: $(echo -e "$MATCHES" | grep -c "•" || echo 0)"
