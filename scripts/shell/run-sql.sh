#!/bin/bash

# Load environment variables
if [ -f .env ]; then
  export $(cat .env | grep -v '^#' | xargs)
fi

# Validate required environment variables
if [ -z "$SUPABASE_SERVICE_ROLE_KEY" ] || [ -z "$Supabase_Database_Password" ]; then
  echo "ERROR: SUPABASE_SERVICE_ROLE_KEY and Supabase_Database_Password environment variables are required"
  exit 1
fi

SERVICE_KEY="$SUPABASE_SERVICE_ROLE_KEY"

# Execute SQL directly
psql "postgresql://postgres.qkgaybvrernstplzjaam:${Supabase_Database_Password}@db.qkgaybvrernstplzjaam.supabase.co:5432/postgres" \
  -f DEPLOY_PROFESSIONAL_FINANCIAL_SYSTEM.sql
