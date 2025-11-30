#!/bin/bash

# Automated BAT Scraping Runner
# This script handles environment setup and runs the scraper

# Set PATH explicitly for cron
export PATH="/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

cd "$(dirname "$0")/.." || exit 1

# Load environment variables safely
# Parse .env file manually to avoid execution issues in cron
if [ -f .env ]; then
  # Read .env file line by line and export variables
  while IFS= read -r line || [ -n "$line" ]; do
    # Skip comments and empty lines
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// }" ]] && continue
    
    # Export variable (handles KEY=value format)
    if [[ "$line" =~ ^[[:space:]]*([^#=]+)=(.*)$ ]]; then
      key="${BASH_REMATCH[1]// /}"
      value="${BASH_REMATCH[2]}"
      # Remove quotes if present
      value="${value#\"}"
      value="${value%\"}"
      value="${value#\'}"
      value="${value%\'}"
      export "$key=$value"
    fi
  done < .env
fi

# Use the edge function monitor (most reliable)
LOG_FILE="/tmp/bat-scrape.log"
echo "$(date): Starting BAT scrape via monitor-bat-seller edge function" >> "$LOG_FILE"

# Verify we have the required environment variable
if [ -z "$VITE_SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "$(date): ERROR - VITE_SUPABASE_SERVICE_ROLE_KEY not set" >> "$LOG_FILE"
  exit 1
fi

curl -X POST "https://qkgaybvrernstplzjaam.supabase.co/functions/v1/monitor-bat-seller" \
  -H "Authorization: Bearer ${VITE_SUPABASE_SERVICE_ROLE_KEY}" \
  -H "Content-Type: application/json" \
  -d '{"sellerUsername":"VivaLasVegasAutos","organizationId":"c433d27e-2159-4f8c-b4ae-32a5e44a77cf"}' \
  >> "$LOG_FILE" 2>&1

CURL_EXIT=$?
if [ $CURL_EXIT -eq 0 ]; then
  echo "$(date): Scrape complete successfully" >> "$LOG_FILE"
else
  echo "$(date): ERROR - Scrape failed with exit code $CURL_EXIT" >> "$LOG_FILE"
  exit $CURL_EXIT
fi

