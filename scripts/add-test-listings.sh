#!/bin/bash
#
# Add test listings to import_queue for specialty builders
#

set -euo pipefail

cd "$(dirname "$0")/.."

export $(dotenvx run -- env | grep -E '^(VITE_SUPABASE_URL|SUPABASE_SERVICE_ROLE_KEY)=' | xargs)

# Sample URLs to test (replace with real listings as discovered)
TEST_URLS=(
  "https://www.velocityrestorations.com/for-sale/"
  "https://kindredmotorworks.com/for-sale"
)

echo "Adding test listings to import_queue..."

for url in "${TEST_URLS[@]}"; do
  echo "Adding: $url"

  # Get source_id for the builder
  source_id=$(PGPASSWORD="RbzKq32A0uhqvJMQ" psql \
    -h aws-0-us-west-1.pooler.supabase.com \
    -p 6543 \
    -U postgres.qkgaybvrernstplzjaam \
    -d postgres \
    -t -A \
    -c "SELECT id FROM scrape_sources WHERE url LIKE '%$(echo $url | sed 's|https://||' | sed 's|/.*||')%' AND scrape_config->>'builder_type' IS NOT NULL LIMIT 1;" 2>/dev/null)

  if [ -z "$source_id" ]; then
    echo "  ⚠️  Source not found, adding without source_id"
    source_id="NULL"
  else
    echo "  ✅ Source ID: $source_id"
  fi

  # Insert to import_queue
  PGPASSWORD="RbzKq32A0uhqvJMQ" psql \
    -h aws-0-us-west-1.pooler.supabase.com \
    -p 6543 \
    -U postgres.qkgaybvrernstplzjaam \
    -d postgres \
    -c "
    INSERT INTO import_queue (listing_url, source_id, status, priority)
    VALUES ('$url', $([ "$source_id" = "NULL" ] && echo "NULL" || echo "'$source_id'"), 'pending', 10)
    ON CONFLICT (listing_url) DO UPDATE SET
      status = 'pending',
      priority = 10,
      attempts = 0,
      next_attempt_at = NOW();
    " 2>&1 | grep -E '(INSERT|UPDATE)' || echo "  Added/updated"
done

echo ""
echo "✅ Test listings added"
echo ""
echo "Next: Run the coordinator to process them:"
echo "  ./scripts/specialty-builder-coordinator.sh"
