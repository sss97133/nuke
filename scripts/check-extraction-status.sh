#!/bin/bash
# Quick BaT extraction status check
echo "=== BaT Extraction Status $(date '+%Y-%m-%d %H:%M:%S') ==="
PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "
SELECT 
  (SELECT COUNT(*) FROM bat_listings) as bat_listings,
  (SELECT COUNT(*) FROM import_queue WHERE listing_url LIKE '%bringatrailer%' AND status='pending') as pending,
  (SELECT COUNT(*) FROM import_queue WHERE listing_url LIKE '%bringatrailer%' AND status='processing') as processing,
  (SELECT SUM(urls_new) FROM bat_crawl_state) as discovered
;"
echo ""
echo "Active processes: $(ps aux | grep 'curl.*supabase\|bat-extraction' | grep -v grep | wc -l)"
