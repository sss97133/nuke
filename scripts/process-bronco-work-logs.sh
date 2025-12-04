#!/bin/bash

# Process Bronco work logs at Ernie's Upholstery
# Limit to 10 sessions to control OpenAI costs

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Validate required environment variables
if [ -z "$VITE_SUPABASE_URL" ] || [ -z "$SUPABASE_SERVICE_ROLE_KEY" ]; then
  echo "ERROR: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required"
  exit 1
fi

export SUPABASE_URL="$VITE_SUPABASE_URL"

cd /Users/skylar/nuke/scripts

node intelligent-work-log-generator.js \
  79fe1a2b-9099-45b5-92c0-54e7f896089e \
  e796ca48-f3af-41b5-be13-5335bb422b41

