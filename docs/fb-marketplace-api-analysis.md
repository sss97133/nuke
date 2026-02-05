# Facebook Marketplace API Analysis

Based on analysis of [kyleronayne/marketplace-api](https://github.com/kyleronayne/marketplace-api)

---

## GraphQL Endpoint Details

**Endpoint:** `https://www.facebook.com/api/graphql/`

| Purpose | doc_id |
|---------|--------|
| Location Search | `5585904654783609` |
| Marketplace Search | `7111939778879383` |

---

## Required Headers

```python
GRAPHQL_HEADERS = {
    "sec-fetch-site": "same-origin",
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.74 Safari/537.36"
}
```

---

## Data Returned Per Listing

| Field | Path in Response |
|-------|------------------|
| id | `listing.id` |
| title | `listing.marketplace_listing_title` |
| price | `listing.listing_price.formatted_amount` |
| previous price | `listing.strikethrough_price.formatted_amount` |
| pending status | `listing.is_pending` |
| photo URL | `listing.primary_listing_photo.image.uri` |
| seller name | `listing.marketplace_listing_seller.name` |
| seller location | `listing.location.reverse_geocode.city_page.display_name` |
| seller type | `listing.marketplace_listing_seller.__typename` |

---

## Rate Limits (CRITICAL)

From GitHub Issue #1:
- Rate limiting triggers after **~10 minutes of continuous use**
- Cooldown period is **24+ hours**
- Rate limits are IP-based
- No authentication option to increase limits

---

## Filter Parameters

```python
{
    "commerce_enable_local_pickup": true,
    "commerce_enable_shipping": true,
    "commerce_search_and_rp_available": true,  # true=Available, false=Sold
    "commerce_search_and_rp_condition": null,  # null, "new", or "used;open_box_new;..."
    "filter_location_latitude": 29.7602,
    "filter_location_longitude": -95.3694,
    "filter_price_lower_bound": 0,
    "filter_price_upper_bound": 214748364700,
    "filter_radius_km": 16
}
```

---

## Pagination

Cursor-based using:
- `page_info.has_next_page` (boolean)
- `page_info.end_cursor` (string)

For subsequent pages, add `"cursor": "<end_cursor>"` to variables.

---

## Comparison: GraphQL API vs Bot User Agent

| Aspect | GraphQL API | Bot User Agent |
|--------|-------------|----------------|
| Authentication | None (but limited) | None |
| Rate Limit | 10 min → 24h block | Unknown (likely higher) |
| Data Quality | Structured JSON | Parse from HTML |
| Reliability | May break (doc_id changes) | More stable (SEO requirement) |
| Implementation | POST with doc_id | GET with bot UA |

**Recommendation:** Use Bot User Agent approach as primary. GraphQL as fallback for specific queries.

---

## Source Code Reference

Full implementation in `MarketplaceScraper.py`:
- `getLocations(locationQuery)` - resolve location to lat/long
- `getListings(lat, lng, query, numPages)` - paginated search
