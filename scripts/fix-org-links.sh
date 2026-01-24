#!/bin/bash
# Fix organization_vehicles links to use organizations table instead of businesses table

set -e
cd /Users/skylar/nuke

# Load env vars
eval "$(dotenvx run -- printenv | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | sed 's/^/export /')"

echo "=== Organization Link Migration ==="
echo ""

# Function to migrate links
migrate_links() {
    local biz_id="$1"
    local org_id="$2"
    local name="$3"

    # Count existing links
    local count=$(curl -s "$VITE_SUPABASE_URL/rest/v1/organization_vehicles?organization_id=eq.$biz_id&select=id" \
        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
        -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
        -H "Prefer: count=exact" -I 2>/dev/null | grep -i content-range | sed 's/.*\///' | tr -d '\r')

    if [ -n "$count" ] && [ "$count" != "0" ] && [ "$count" != "*" ]; then
        echo "  [$name] Migrating $count links from $biz_id -> $org_id"

        # Update the organization_id
        curl -s -X PATCH "$VITE_SUPABASE_URL/rest/v1/organization_vehicles?organization_id=eq.$biz_id" \
            -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
            -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
            -H "Content-Type: application/json" \
            -d "{\"organization_id\": \"$org_id\"}" > /dev/null

        echo "$count"
    else
        echo "0"
    fi
}

echo "Migrating organization_vehicles links..."
echo ""

total=0

# PCarMarket migrations
n=$(migrate_links "d3bd67bb-0c19-4304-8a6b-89d384328eac" "2a2494ae-cc22-4300-accb-24ed9a054663" "PCarMarket-nowww")
total=$((total + n))
n=$(migrate_links "f7c80592-6725-448d-9b32-2abf3e011cf8" "2a2494ae-cc22-4300-accb-24ed9a054663" "PCarMarket-www")
total=$((total + n))

# Cars and Bids migrations
n=$(migrate_links "c124e282-a99c-4c9a-971d-65a0ddc03224" "4dac1878-b3fc-424c-9e92-3cf552f1e053" "CarsAndBids-1")
total=$((total + n))
n=$(migrate_links "822cae29-f80e-4859-9c48-a1485a543152" "4dac1878-b3fc-424c-9e92-3cf552f1e053" "CarsAndBids-2")
total=$((total + n))

# Bring a Trailer migrations (multiple duplicates)
n=$(migrate_links "222375e1-901e-4a2c-a254-4e412f0e2a56" "d2bd6370-11d1-4af0-8dd2-3de2c3899166" "BaT-1")
total=$((total + n))
n=$(migrate_links "3c0c5a1e-4836-430b-822d-585c70ad6dc1" "d2bd6370-11d1-4af0-8dd2-3de2c3899166" "BaT-2")
total=$((total + n))
n=$(migrate_links "04ded0e8-e31e-4200-bf91-ed5f4fc6af4b" "d2bd6370-11d1-4af0-8dd2-3de2c3899166" "BaT-3")
total=$((total + n))
n=$(migrate_links "93dfd8f8-0eaf-4fd1-b47a-24d5a8fd7965" "d2bd6370-11d1-4af0-8dd2-3de2c3899166" "BaT-4")
total=$((total + n))
n=$(migrate_links "bd035ea4-75f0-4b17-ad02-aee06283343f" "d2bd6370-11d1-4af0-8dd2-3de2c3899166" "BaT-5")
total=$((total + n))
n=$(migrate_links "e1f3c01f-e5e9-47b1-add6-9f7359ba0857" "d2bd6370-11d1-4af0-8dd2-3de2c3899166" "BaT-6")
total=$((total + n))

# SBX Cars migrations
n=$(migrate_links "37b84b5e-ee28-410a-bea5-8d4851e39525" "a35b59b1-0e64-437c-953d-24a6f5bb17c6" "SBX-1")
total=$((total + n))
n=$(migrate_links "23a897dc-7fb3-4464-bae3-2f92e801abb2" "a35b59b1-0e64-437c-953d-24a6f5bb17c6" "SBX-2")
total=$((total + n))

echo ""
echo "=== Verification ==="

for entry in "Bring a Trailer:d2bd6370-11d1-4af0-8dd2-3de2c3899166" \
             "PCarMarket:2a2494ae-cc22-4300-accb-24ed9a054663" \
             "Cars and Bids:4dac1878-b3fc-424c-9e92-3cf552f1e053" \
             "SBX Cars:a35b59b1-0e64-437c-953d-24a6f5bb17c6"; do
    name="${entry%%:*}"
    org_id="${entry##*:}"

    count=$(curl -s "$VITE_SUPABASE_URL/rest/v1/organization_vehicles?organization_id=eq.$org_id&select=id" \
        -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
        -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
        -H "Prefer: count=exact" -I 2>/dev/null | grep -i content-range | sed 's/.*\///' | tr -d '\r')

    echo "  $name: $count vehicles linked"
done

echo ""
echo "Migration complete!"
