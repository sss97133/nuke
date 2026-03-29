# P08: Organization Profile as Provenance Container

## Context
Read these before executing:
- `docs/library/reference/encyclopedia/README.md` Section 18 — Organization Sandbox (provenance container)
- `docs/library/reference/dictionary/README.md` — "Organization Sandbox" definition
- `docs/library/intellectual/papers/applied-ontology-vehicle-domain.md` — PROV-O lineage model
- `docs/library/intellectual/papers/trust-scoring-methodology.md` — source trust hierarchy (dealer = 0.65-0.75)
- `nuke_frontend/src/services/profileStatsService.ts` — seller_track_record just added in org profile work
- `nuke_frontend/src/pages/OrganizationProfile.tsx` — current org profile page

## Problem
Organization profiles now show per-vehicle data (P3), ownership classification (P4), and competitive context (P5). But they treat every vehicle the same. A vehicle that sold 4 years ago through consignment is displayed identically to one the dealer personally restored and sold last month.

The encyclopedia defines the Organization Sandbox: "Data from organizations without verifiable identifiers sits in a sandbox — a trust boundary at the Claims layer." But we don't render this distinction. We don't show:
- **Provenance depth per vehicle** — how much evidence supports each vehicle's data
- **Claim vs. verified fields** — which vehicle facts came from the org vs. independent sources
- **Outcome tracking** — did the vehicle sell above or below estimate? Was the description accurate?
- **Trust trajectory** — is this org's data getting more or less reliable over time?

This is the difference between a dealer profile that says "780 consigned vehicles" and one that says "780 consigned, 94% had accurate descriptions, estimates averaged 8% below sale price, trending more accurate over 3 years."

## Scope
Service layer extension + frontend rendering. No new tables. No new edge functions. Uses existing observation/estimate data.

## Steps

1. Read the existing data we already have per vehicle:
```sql
-- For a single org, what do we know about outcome accuracy?
SELECT
  ov.vehicle_id,
  v.sale_price,
  ne.estimated_value,
  ne.comp_method,
  ne.confidence_score,
  ne.is_circular,
  (SELECT count(*) FROM vehicle_observations vo WHERE vo.vehicle_id = ov.vehicle_id) as observation_count,
  v.description IS NOT NULL as has_description,
  (SELECT count(*) FROM vehicle_images vi WHERE vi.vehicle_id = ov.vehicle_id) as image_count
FROM organization_vehicles ov
JOIN vehicles v ON v.id = ov.vehicle_id
LEFT JOIN nuke_estimates ne ON ne.vehicle_id = v.id
WHERE ov.organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf' -- Viva
LIMIT 20;
```

2. Extend `getOrganizationProfileData` in `profileStatsService.ts` with an `org_data_quality` object:

```typescript
export interface OrgDataQuality {
  total_vehicles: number;
  with_description: number;
  with_images: number;      // vehicles that have at least 1 image
  with_sale_price: number;
  with_nuke_estimate: number;
  with_non_circular_estimate: number;
  // Estimate accuracy (only where both sale_price and non-circular estimate exist)
  estimate_accuracy: {
    sample_size: number;
    mean_absolute_pct_error: number | null;  // |estimate - sale_price| / sale_price
    median_pct_error: number | null;
    overestimate_count: number;  // estimate > sale_price
    underestimate_count: number; // estimate < sale_price
  } | null;
  // Provenance depth: avg observations per vehicle
  avg_observations_per_vehicle: number | null;
  // Data completeness tiers
  tier_distribution: {
    rich: number;   // description + 10+ images + estimate + sale_price
    adequate: number; // description + images + (estimate OR sale_price)
    thin: number;     // some data but gaps
    stub: number;     // just year/make/model
  };
}
```

3. Compute `org_data_quality` from the per-vehicle data already loaded in `seller_track_record`. This does NOT require additional queries — derive from existing data plus one count query for observations and images:

```sql
-- Batch observation counts
SELECT vehicle_id, count(*) as obs_count
FROM vehicle_observations
WHERE vehicle_id = ANY($vehicle_ids)
GROUP BY vehicle_id;

-- Batch image counts
SELECT vehicle_id, count(*) as img_count
FROM vehicle_images
WHERE vehicle_id = ANY($vehicle_ids)
GROUP BY vehicle_id;
```

4. Render the data quality section in OrganizationProfile.tsx overview tab, between the metrics bar and the sold vehicles table:

```
DATA QUALITY
───────────────────────────────────────────────────
Descriptions: 412 of 694 owned vehicles (59%)
Images: 589 of 694 (85%, avg 24/vehicle)
Estimates: 203 non-circular of 694 (29%)
  Accuracy: ±12% median error (143 with known sale price)
  Overestimates: 67  |  Underestimates: 76
Observations: avg 8.3 per vehicle
───────────────────────────────────────────────────
RICH (31%)  ADEQUATE (44%)  THIN (18%)  STUB (7%)
```

Use the same design system: 9px uppercase labels, Courier New for numbers, no borders on this section (it's informational density, not a table).

5. Only render when `org_data_quality.total_vehicles >= 5`. No empty shells.

## Verify
- Load Viva org profile (`/org/c433d27e-2159-4f8c-b4ae-32a5e44a77cf`)
- Data quality section should appear between metrics bar and sold vehicles table
- Numbers should match SQL reality checks:
```sql
SELECT
  count(*) as total,
  count(v.description) as with_desc,
  count(ne.estimated_value) FILTER (WHERE ne.is_circular IS NOT TRUE) as non_circular_est
FROM organization_vehicles ov
JOIN vehicles v ON v.id = ov.vehicle_id
LEFT JOIN nuke_estimates ne ON ne.vehicle_id = v.id
WHERE ov.organization_id = 'c433d27e-2159-4f8c-b4ae-32a5e44a77cf';
```

## Anti-Patterns
- Do NOT use averages for estimate accuracy. Use median. Outliers (modified vehicles with no comps) skew the mean.
- Do NOT show accuracy metrics with sample_size < 10. The number is meaningless. Show "insufficient data" instead.
- Do NOT fetch all observations per vehicle. Just the count. The observation text is irrelevant for this feature.
- Do NOT create a new component file. Add this inline in OrganizationProfile.tsx overview tab section.
- Do NOT compute tier_distribution on the backend. The data is already in the frontend — compute client-side.

## Library Contribution
After completing:
- Update `docs/library/reference/encyclopedia/README.md` Section 18 — add "Data Quality Scoring" subsection
- Update `docs/library/reference/dictionary/README.md` — add "Data Quality Tier" (rich/adequate/thin/stub) definitions
- Add empirical accuracy findings to `docs/library/intellectual/studies/` as "Estimate Accuracy by Organization Type"
