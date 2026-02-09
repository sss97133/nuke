#!/usr/bin/env bash
# Run the frontend-expected-columns migration against the database.
# Requires DATABASE_URL in .env (direct Postgres connection string from Supabase Dashboard → Settings → Database).
set -e
cd "$(dirname "$0")/.."
if [ -z "$DATABASE_URL" ]; then
  if [ -f .env ]; then
    set -a
    source .env 2>/dev/null || true
    set +a
  fi
fi
if [ -z "$DATABASE_URL" ] || [ "$DATABASE_URL" = "your-database-url" ]; then
  echo "Set DATABASE_URL to your Supabase direct connection string (Settings → Database → Connection string → URI)."
  echo "Then run: psql \"\$DATABASE_URL\" -f supabase/migrations/20260208190000_frontend_expected_columns.sql"
  exit 1
fi
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/migrations/20260208190000_frontend_expected_columns.sql
echo "Migration applied."
