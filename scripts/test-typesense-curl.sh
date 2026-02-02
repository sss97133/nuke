#!/bin/bash

curl -s -X POST "https://dora.production.collecting.com/multi_search?x-typesense-api-key=pHuIUBo3XGxHk9Ll9g4q71qXbTYAM2w1" \
  -H "Content-Type: application/json" \
  -d '{
    "searches": [{
      "collection": "production_cars",
      "q": "*",
      "filter_by": "listingStage:live",
      "per_page": 5,
      "page": 1
    }]
  }' | jq '.results[0] | {found: .found, hits: (.hits | length), sample: .hits[0].document | {title, slug, currentBid, noBids}}'
