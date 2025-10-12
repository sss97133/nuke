#!/bin/bash

# Shop Migrations Runner
# Run all 4 shop migrations in order

: ${PGPASSWORD:?Missing PGPASSWORD}
: ${DB_URL:?Missing DB_URL}

echo "Running shop migrations..."

echo "1/4: Running shops_core.sql..."
psql "$DB_URL" -f supabase/migrations/20250105_shops_core.sql

echo "2/4: Running shops_admin_integration.sql..."
psql "$DB_URL" -f supabase/migrations/20250105_shops_admin_integration.sql

echo "3/4: Running shops_business_verification.sql..."
psql "$DB_URL" -f supabase/migrations/20250105_shops_business_verification.sql

echo "4/4: Running shops_business_structure.sql..."
psql "$DB_URL" -f supabase/migrations/20250105_shops_business_structure.sql

echo "Done! All shop migrations completed."
