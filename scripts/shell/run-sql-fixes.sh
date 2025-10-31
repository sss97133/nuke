#!/bin/bash
# Execute SQL fixes via psql

set -e

echo "🔧 Applying SQL fixes to production database..."
echo ""

# Use the credentials from .env files
DB_PASSWORD="RbzKq32A0uhqvJMQ"
PROJECT_REF="qkgaybvrernstplzjaam"
DB_URL="postgresql://postgres:${DB_PASSWORD}@db.${PROJECT_REF}.supabase.co:5432/postgres"

# Run the SQL fix file
psql "$DB_URL" -f APPLY_THESE_SQL_FIXES.sql

echo ""
echo "✅ SQL fixes applied!"
echo ""
echo "📱 Now test on mobile:"
echo "1. Add vehicle (should work - no more created_by error)"
echo "2. Edit price (should work - permissive policy)"  
echo "3. Upload document (should work - permissive policy)"

