#!/bin/bash
# REMOTE-CMD: Send commands to portable machine via Supabase
# Usage: ./remote-cmd.sh "ls -la"
# Usage: ./remote-cmd.sh status
# Usage: ./remote-cmd.sh watch

cd "$(dirname "$0")/.."
source .env 2>/dev/null || { echo "Run from nuke dir"; exit 1; }

ACTION="${1:-status}"
SUPABASE_FUNC="$VITE_SUPABASE_URL/functions/v1/remote-agent"
AUTH="Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"

case "$ACTION" in
  status|s)
    echo "=== Recent Commands ==="
    curl -s -X POST "$SUPABASE_FUNC" -H "$AUTH" -H "Content-Type: application/json" \
      -d '{"action": "status"}' | jq -r '.commands[] | "\(.status | if . == "pending" then "⏳" elif . == "completed" then "✅" else "❌" end) \(.command[0:50]) → \(.output[0:80] // "waiting...")"'
    ;;

  watch|w)
    echo "=== Watching (Ctrl+C to stop) ==="
    while true; do
      clear
      $0 status
      sleep 3
    done
    ;;

  *)
    # Send command
    echo "📤 Sending: $ACTION"
    result=$(curl -s -X POST "$SUPABASE_FUNC" -H "$AUTH" -H "Content-Type: application/json" \
      -d "{\"action\": \"send\", \"command\": \"$ACTION\"}")

    id=$(echo "$result" | jq -r '.id')
    echo "📋 Command ID: $id"
    echo "⏳ Waiting for execution..."

    # Poll for result
    for i in {1..60}; do
      sleep 2
      resp=$(curl -s -X POST "$SUPABASE_FUNC" -H "$AUTH" -H "Content-Type: application/json" \
        -d '{"action": "status"}')

      status=$(echo "$resp" | jq -r ".commands[] | select(.id == \"$id\") | .status")
      if [ "$status" = "completed" ]; then
        echo ""
        echo "=== Output ==="
        echo "$resp" | jq -r ".commands[] | select(.id == \"$id\") | .output"
        exit 0
      fi
      printf "."
    done
    echo "⏰ Timeout - check 'remote-cmd.sh status'"
    ;;
esac
