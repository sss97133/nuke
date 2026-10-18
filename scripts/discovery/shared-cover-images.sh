#!/bin/bash
# Read-only: cover photos (vehicles.primary_image_url) that more than one public, sold vehicle uses, one make at a time
# so each read stays on the (make, sale_price) index. A cover shared by different cars (different years or models) is
# wrong for all but at most one of them; junk=true means is_junk_listing_image_url() already flags it.
#   scripts/discovery/shared-cover-images.sh Porsche [limit]
set -euo pipefail
make="${1:?usage: shared-cover-images.sh <make> [limit]}"
limit="${2:-25}"
[[ "$make" =~ ^[A-Za-z0-9\ .\&\'-]+$ ]] || { echo "unexpected make: $make" >&2; exit 1; }
[[ "$limit" =~ ^[0-9]+$ ]] || { echo "limit must be a number" >&2; exit 1; }
make_sql="${make//\'/\'\'}"
exec "$(dirname "$0")/../data/q.sh" "
SELECT primary_image_url AS cover, count(*) AS vehicles, count(DISTINCT year) AS years, count(DISTINCT lower(model)) AS models,
       public.is_junk_listing_image_url(primary_image_url) AS junk, primary_image_url !~* '^https?://' AS not_a_url,
       (array_agg(id ORDER BY id))[1:5] AS sample_vehicle_ids
FROM public.vehicles
WHERE make = '$make_sql' AND sale_price > 0 AND is_public AND deleted_at IS NULL AND primary_image_url IS NOT NULL
GROUP BY primary_image_url
HAVING count(*) > 1
ORDER BY count(*) DESC
LIMIT $limit;"
