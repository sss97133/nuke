#!/bin/bash
cd /Users/skylar/nuke
dotenvx run -- bash -c '
  PGPASSWORD="RbzKq32A0uhqvJMQ" psql -h aws-0-us-west-1.pooler.supabase.com -p 6543 -U postgres.qkgaybvrernstplzjaam -d postgres -c "
  SELECT 
    (SELECT COUNT(*) FROM marketplace_listings) as total_listings,
    (SELECT COUNT(*) FROM marketplace_listings WHERE scraped_at > NOW() - INTERVAL '"'"'24 hours'"'"') as last_24h,
    (SELECT COUNT(*) FROM marketplace_listings WHERE scraped_at > NOW() - INTERVAL '"'"'1 hour'"'"') as last_1h,
    (SELECT COUNT(*) FROM vehicles WHERE discovery_source = '"'"'facebook_marketplace'"'"') as vehicles_created,
    (SELECT COUNT(*) FROM marketplace_listings WHERE mileage IS NOT NULL) as with_details;
  "
' 2>/dev/null
