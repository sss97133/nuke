#!/bin/bash

# Apply Auto-Buy System Migration
# This script applies the auto-buy execution system to the database

set -e

echo "🚀 Applying Auto-Buy System Migration"
echo "======================================"
echo ""

# Check if Supabase CLI is available
if command -v supabase &> /dev/null; then
  echo "📋 Applying migration via Supabase CLI..."
  
  # Try to apply migration
  if supabase db push 2>/dev/null; then
    echo "✅ Migration applied successfully!"
  else
    echo "⚠️  CLI migration failed. Please apply manually via Supabase Dashboard."
    echo ""
    echo "📝 SQL file location:"
    echo "   supabase/migrations/20251127000002_auto_buy_execution_system.sql"
    echo ""
    echo "To apply manually:"
    echo "  1. Go to Supabase Dashboard → SQL Editor"
    echo "  2. Copy contents of the migration file"
    echo "  3. Paste and run"
  fi
else
  echo "⚠️  Supabase CLI not found. Please apply migration manually."
  echo ""
  echo "📝 SQL file location:"
  echo "   supabase/migrations/20251127000002_auto_buy_execution_system.sql"
  echo ""
  echo "To apply manually:"
  echo "  1. Go to Supabase Dashboard → SQL Editor"
  echo "  2. Copy contents of the migration file"
  echo "  3. Paste and run"
fi

echo ""
echo "📦 Next steps:"
echo "  1. Deploy edge functions: ./scripts/deploy-auto-buy-functions.sh"
echo "  2. Build frontend UI: npm run build (in nuke_frontend)"
echo "  3. Deploy to production: vercel --prod --force --yes"
echo ""

