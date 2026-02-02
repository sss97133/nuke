#!/bin/bash
# Collecting Cars Discovery Examples
# Usage: ./scripts/collecting-cars-discovery-examples.sh [command]

function call_api() {
    local action=$1
    local stage=${2:-""}

    if [ -z "$stage" ]; then
        dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/collecting-cars-discovery\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '{\"action\": \"$action\"}'" | jq
    else
        dotenvx run -- bash -c "curl -s -X POST \"\$VITE_SUPABASE_URL/functions/v1/collecting-cars-discovery\" -H \"Authorization: Bearer \$SUPABASE_SERVICE_ROLE_KEY\" -H \"Content-Type: application/json\" -d '{\"action\": \"$action\", \"stage\": \"$stage\"}'" | jq
    fi
}

function status() {
    echo "Checking Collecting Cars discovery status..."
    call_api "status"
}

function discover_live() {
    echo "Discovering live Collecting Cars listings..."
    call_api "discover" "live"
}

function discover_sold() {
    echo "Discovering sold Collecting Cars listings..."
    call_api "discover" "sold"
}

function discover_coming_soon() {
    echo "Discovering upcoming Collecting Cars listings..."
    call_api "discover" "comingsoon"
}

function help() {
    echo "Collecting Cars Discovery Commands:"
    echo ""
    echo "  status           - Show current discovery status"
    echo "  discover-live    - Discover all live auctions"
    echo "  discover-sold    - Discover sold listings"
    echo "  discover-coming  - Discover upcoming listings"
    echo "  help            - Show this help"
    echo ""
    echo "Examples:"
    echo "  ./scripts/collecting-cars-discovery-examples.sh status"
    echo "  ./scripts/collecting-cars-discovery-examples.sh discover-live"
}

# Parse command
CMD=${1:-help}
case "$CMD" in
    status)
        status
        ;;
    discover-live)
        discover_live
        ;;
    discover-sold)
        discover_sold
        ;;
    discover-coming)
        discover_coming_soon
        ;;
    help|*)
        help
        ;;
esac
