#!/bin/bash
# Apply simplified RLS policies to fix permission issues
# Run this to allow any authenticated user to edit vehicles

echo "Applying simplified vehicle RLS policies..."

# Run the migrations using Supabase CLI
supabase db push --db-url "$(grep SUPABASE_DB_URL .env | cut -d '=' -f2)" \
  --file supabase/migrations/20251024_simple_vehicle_rls.sql

supabase db push --db-url "$(grep SUPABASE_DB_URL .env | cut -d '=' -f2)" \
  --file supabase/migrations/20251024_vehicle_edit_audit.sql

echo "✓ RLS policies updated!"
echo "✓ Audit log system created!"
echo ""
echo "You can now edit any vehicle as an authenticated user."
echo "All changes are tracked in the vehicle_edit_audit table."

