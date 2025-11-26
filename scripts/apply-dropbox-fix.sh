#!/bin/bash

# Apply Dropbox Import Origin Tracking Fix
# This script applies the migration to fix the 26 orphaned vehicles

set -e

echo "🔧 Applying Dropbox Import Origin Tracking Fix..."
echo ""

# Check if we have the database password
if [ -z "$SUPABASE_DB_PASSWORD" ]; then
  echo "❌ Error: SUPABASE_DB_PASSWORD environment variable not set"
  echo "   Please set it: export SUPABASE_DB_PASSWORD='your-password'"
  exit 1
fi

# Database connection details
DB_HOST="db.qkgaybvrernstplzjaam.supabase.co"
DB_PORT="5432"
DB_NAME="postgres"
DB_USER="postgres.qkgaybvrernstplzjaam"
DB_URL="postgresql://${DB_USER}:${SUPABASE_DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}"

echo "📋 Applying migration: 20251126000001_fix_dropbox_import_tracking.sql"
echo ""

# Apply the migration
psql "$DB_URL" -f supabase/migrations/20251126000001_fix_dropbox_import_tracking.sql

if [ $? -eq 0 ]; then
  echo ""
  echo "✅ Migration applied successfully!"
  echo ""
  echo "📊 Verifying backfill..."
  
  # Verify the backfill
  psql "$DB_URL" -c "
    SELECT 
      COUNT(*) as vehicles_fixed,
      COUNT(CASE WHEN uploaded_by IS NOT NULL THEN 1 END) as with_uploaded_by,
      COUNT(CASE WHEN discovery_source = 'dropbox_bulk_import' THEN 1 END) as with_discovery_source,
      COUNT(CASE WHEN profile_origin = 'dropbox_import' THEN 1 END) as with_correct_origin
    FROM vehicles
    WHERE origin_metadata->>'backfilled_uploaded_by' = 'true';
  "
  
  echo ""
  echo "✅ Done! The 26 orphaned vehicles have been fixed."
else
  echo ""
  echo "❌ Migration failed. Please check the error above."
  exit 1
fi

