# P11: Cross-Platform Seller Resolution

## Context
Read these before executing:
- `docs/library/intellectual/papers/entity-resolution-design.md` — matching cascade, 0.80 threshold
- `docs/library/intellectual/papers/user-simulation-methodology.md` — stylometric fingerprinting, 520K BaT usernames
- `docs/library/reference/encyclopedia/README.md` Section 18 — entity resolution, Organization Sandbox
- `docs/library/reference/atlas/` — source profiles and access methods
- `scripts/backfill-bat-seller-to-org.mjs` — current seller→org wiring (BaT only)

## Problem
A dealer sells on multiple platforms. "CollectibleClassics" on BaT is "Collectible Classics Inc." on Cars & Bids is "collectibleclassics" on eBay Motors is "Collectible Classics" on their own website. We have `external_identities` to model this, but no cross-platform resolution logic.

The data already exists to solve this:
- `vehicles.bat_seller` — BaT seller username per vehicle
- `vehicle_events.seller_username` — per-event seller across platforms
- `vehicle_events.source_platform` — which platform
- `external_identities` — claimed/unclaimed platform handles
- `businesses` — organizations with optional `website` field
- `organization_website_mappings` — website URL → org mapping

What's missing: connecting the same dealer across platforms. A vehicle listed by "CollectibleClassics" on BaT and "Collectible Classics Inc." on C&B should link to the same organization.

## Scope
One resolution script. Updates to existing tables. No new tables. No new edge functions.

## Steps

1. Inventory the cross-platform seller data:
```sql
-- Unique seller usernames per platform
SELECT source_platform, count(DISTINCT seller_username) as sellers, count(*) as events
FROM vehicle_events
WHERE seller_username IS NOT NULL
GROUP BY source_platform
ORDER BY events DESC;

-- Top sellers per platform (non-BaT)
SELECT source_platform, seller_username, count(*) as listings
FROM vehicle_events
WHERE seller_username IS NOT NULL AND source_platform != 'bat'
GROUP BY 1, 2
ORDER BY listings DESC
LIMIT 50;
```

2. Build resolution cascade in `scripts/resolve-cross-platform-sellers.mjs`:

**Pass 1: Exact handle match**
For each `external_identities` record with platform='bat', check if the same handle exists on other platforms:
```sql
SELECT DISTINCT ve.source_platform, ve.seller_username
FROM vehicle_events ve
WHERE ve.seller_username ILIKE $bat_handle
  AND ve.source_platform != 'bat';
```
Confidence: 0.85 (high but not certain — same username on different platforms could be coincidence)

**Pass 2: Fuzzy handle match**
Normalize handles (lowercase, strip spaces, strip "inc", "llc", "auto", "motors"):
```javascript
function normalizeHandle(h) {
  return h.toLowerCase()
    .replace(/[\s_-]+/g, '')
    .replace(/(inc|llc|corp|auto|motors|cars|classics|vintage)$/i, '')
    .trim();
}
```
Match normalized handles across platforms. Confidence: 0.70 (needs verification)

**Pass 3: Vehicle overlap**
If two sellers on different platforms listed the same VIN, they're likely the same entity:
```sql
-- Find sellers that share vehicles across platforms
SELECT a.seller_username as bat_seller, b.seller_username as other_seller,
       b.source_platform as other_platform, count(DISTINCT a.vehicle_id) as shared_vehicles
FROM vehicle_events a
JOIN vehicle_events b ON a.vehicle_id = b.vehicle_id
WHERE a.source_platform = 'bat' AND b.source_platform != 'bat'
  AND a.seller_username IS NOT NULL AND b.seller_username IS NOT NULL
GROUP BY 1, 2, 3
HAVING count(DISTINCT a.vehicle_id) >= 2
ORDER BY shared_vehicles DESC;
```
2+ shared vehicles = confidence 0.90. 5+ shared vehicles = confidence 0.95.

**Pass 4: Website domain match**
Check if a seller's BaT profile URL or business website matches an organization already in the database:
```sql
SELECT b.id, b.business_name, b.website
FROM businesses b
WHERE b.website IS NOT NULL
  AND b.website ILIKE '%' || $normalized_handle || '%';
```

3. For matches at confidence >= 0.80:
- Upsert `external_identities` for the new platform handle
- Link to the same organization via `organization_vehicles`
- Wire `vehicle_events.source_organization_id` for the new platform's events

4. For matches at confidence 0.60-0.79:
- Create `merge_proposals` records for human review
- Do NOT auto-link

5. Add to package.json:
```json
"resolve:cross-platform-sellers": "dotenvx run -- node scripts/resolve-cross-platform-sellers.mjs",
"resolve:cross-platform-sellers:dry-run": "dotenvx run -- node scripts/resolve-cross-platform-sellers.mjs --dry-run"
```

## Verify
```sql
-- Cross-platform org links
SELECT b.business_name,
  array_agg(DISTINCT ei.platform) as platforms,
  count(DISTINCT ei.id) as identity_count
FROM businesses b
JOIN external_identities ei ON ei.claimed_by_user_id IS NOT NULL
  -- or link through organization somehow
GROUP BY b.business_name
HAVING count(DISTINCT ei.platform) > 1
ORDER BY identity_count DESC;

-- Shared vehicle count between platforms for resolved orgs
SELECT b.business_name, ve.source_platform, count(DISTINCT ve.vehicle_id) as vehicles
FROM businesses b
JOIN organization_vehicles ov ON ov.organization_id = b.id
JOIN vehicle_events ve ON ve.vehicle_id = ov.vehicle_id
GROUP BY b.business_name, ve.source_platform
ORDER BY b.business_name, vehicles DESC;
```

## Anti-Patterns
- Do NOT auto-merge below confidence 0.80. Per entity resolution design paper: false positive merge cost is 20-50x false negative cost.
- Do NOT assume same username = same entity across platforms without corroboration. "911r" on BaT might be a different person than "911r" on Instagram.
- Do NOT resolve individual sellers (non-dealers). Cross-platform resolution is only meaningful for businesses. Individual sellers rarely use the same handle across platforms.
- Do NOT fetch external profile pages. Use only data already in the database. Cross-platform resolution is a database operation, not a scraping operation.
- Do NOT modify the entity resolution threshold (0.80). It is derived from cost asymmetry analysis and applies universally.

## Library Contribution
After completing:
- Add "Cross-Platform Entity Resolution" paper to `docs/library/intellectual/papers/`
- Update `docs/library/technical/engineering-manual/03-entity-resolution.md` — add cross-platform section
- Update `docs/library/reference/atlas/` — add cross-platform identity mappings for resolved orgs
- Update `docs/library/reference/almanac/` with cross-platform overlap statistics
