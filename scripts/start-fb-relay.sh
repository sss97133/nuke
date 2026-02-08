#!/bin/bash
# Start the FB relay server + Cloudflare tunnel
# Usage: ./scripts/start-fb-relay.sh
# The tunnel URL will be printed and set as a Supabase secret automatically.

set -e
cd "$(dirname "$0")/.."

echo "Starting FB relay server..."
deno run --allow-net --allow-env scripts/fb-relay-server.ts &
RELAY_PID=$!
sleep 2

if ! curl -s http://localhost:8787/health > /dev/null; then
  echo "❌ Relay server failed to start"
  exit 1
fi
echo "✅ Relay server running (PID $RELAY_PID)"

echo "Starting Cloudflare tunnel..."
cloudflared tunnel --url http://localhost:8787 2>&1 &
TUNNEL_PID=$!
sleep 5

# Extract tunnel URL from cloudflared metrics
TUNNEL_URL=$(curl -s http://localhost:20241/metrics 2>/dev/null | grep -o 'https://[a-z-]*.trycloudflare.com' | head -1)

if [ -z "$TUNNEL_URL" ]; then
  # Fallback: check process output
  sleep 3
  TUNNEL_URL=$(curl -s http://localhost:20241/metrics 2>/dev/null | grep -o 'https://[a-z-]*.trycloudflare.com' | head -1)
fi

if [ -z "$TUNNEL_URL" ]; then
  echo "⚠️  Could not auto-detect tunnel URL. Check cloudflared output and run:"
  echo "   supabase secrets set FB_RELAY_URL=<tunnel-url>"
else
  echo "✅ Tunnel: $TUNNEL_URL"
  echo "Setting Supabase secret..."
  supabase secrets set FB_RELAY_URL="$TUNNEL_URL" 2>/dev/null
  echo "✅ FB_RELAY_URL set"
fi

echo ""
echo "FB Relay is live. Press Ctrl+C to stop."
echo "Relay PID: $RELAY_PID  |  Tunnel PID: $TUNNEL_PID"

# Wait for either to exit
trap "kill $RELAY_PID $TUNNEL_PID 2>/dev/null; exit" INT TERM
wait
