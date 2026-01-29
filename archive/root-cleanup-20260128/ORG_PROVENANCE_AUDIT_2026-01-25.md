# Nuke Organization Provenance Audit

**Date:** 2026-01-25
**Database:** Nuke Production (qkgaybvrernstplzjaam.supabase.co)
**Total Organizations:** 224
**Active Contributors:** 8

---

## Executive Summary

The Nuke database has **POOR** organization provenance health:

- ✅ **1 org (0.4%)** has full provenance (discovered_by + URL)
- ⚠️ **216 orgs (96.4%)** need discovered_by field (system-created)
- ❌ **7 orgs (3.1%)** need immediate attention (missing data)

### Critical Issues

1. **96.4% of orgs lack user attribution** - Most orgs were likely created by scrapers/imports and have no `discovered_by` field
2. **Only 3.6% of orgs have active contributors** - 8 orgs out of 224
3. **1 orphan org** exists with no provenance and no data - should be deleted
4. **No org_intake metadata** - No tracking of how orgs were created

---

## Provenance Quality Breakdown

| Category | Count | % | Definition |
|----------|-------|---|------------|
| **Good Provenance** | 1 | 0.4% | Has discovered_by + (source_url OR website) |
| **Has User, No URL** | 6 | 2.7% | Has discovered_by but no source/website |
| **Has URL, No User** | 216 | 96.4% | Has source/website but no discovered_by |
| **Orphan Garbage** | 1 | 0.4% | No discovered_by, no source_url, no website |

---

## Detailed Findings

### 1. Good Provenance (1 org, 0.4%)

These orgs have proper user attribution AND source URLs:

- **Nuke** (`f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb`)
  - Discovered by: `0b9f107a-d124-49de-9ded-94698f63c1c4`
  - Website: https://www.nukeltd.com
  - Has 1 contributor (owner)

### 2. Has User But No URL (6 orgs, 2.7%)

These orgs were created by users but lack source_url/website. All were discovered by the same user (`0b9f107a-d124-49de-9ded-94698f63c1c4`):

1. **Desert Performance** - specialty_shop (created 2025-12-06)
   - Has logo, no description
   - 1 contributor (photographer)

2. **Taylor Customs** - body_shop (created 2025-11-22)
   - Has description and logo
   - 1 contributor (photographer)

3. **FBM** - garage (created 2025-11-02)
   - Has description and logo
   - 1 contributor (contractor)

4. **Viva! Las Vegas Autos** - dealership (created 2025-11-02)
   - Has description and logo
   - 1 contributor (board_member)

5. **Ernies Upholstery** - specialty_shop (created 2025-11-01)
   - Has description and logo
   - 1 contributor (technician)

6. **Hot Kiss Restoration** - restoration_shop (created 2025-11-01)
   - Has description and logo
   - 1 contributor (moderator)

**Action needed:** Add website URLs for these orgs.

### 3. Has URL But No User (216 orgs, 96.4%)

This is the LARGEST category. These orgs have website/source_url but no `discovered_by` field. They are likely system-created from scrapers/imports.

**Breakdown by business type:**

| Type | Count |
|------|-------|
| dealership | 113 |
| specialty_shop | 59 |
| auction_house | 17 |
| builder | 5 |
| other | 4 |
| unknown | 3 |
| restoration_shop | 3 |
| performance_shop | 3 |
| rally_event | 2 |
| marketplace | 1 |
| dealer | 1 |
| motorsport_event | 1 |
| automotive_expo | 1 |
| concours | 1 |
| fabrication | 1 |
| detailing | 1 |

**Major platforms include:**
- Bring a Trailer (multiple instances)
- Cars and Bids (multiple instances)
- PCarMarket
- SBX Cars
- Craigslist
- RM Sotheby's
- Bonhams
- Gooding and Company

**Action needed:** Set `discovered_by` to a system user ID for these orgs.

### 4. Orphan Garbage (1 org, 0.4%)

These orgs have NO provenance at all:

- **Seller** (`29b6c470-b96a-492d-a818-c64e9f9450a0`)
  - Type: dealership
  - Created: 2026-01-24
  - No description, no logo, no contributors
  - **RECOMMENDATION: DELETE**

---

## Organization Contributors Analysis

**Total orgs with active contributors:** 8 (3.6%)
**Total orgs without contributors:** 216 (96.4%)

### Orgs WITH Contributors

1. **e068f208-e3d3-4937-ae4d-ea3f417e25cb** - 1 contributor (contributor)
2. **Desert Performance** - 1 contributor (photographer)
3. **Taylor Customs** - 1 contributor (photographer)
4. **FBM** - 1 contributor (contractor)
5. **Viva! Las Vegas Autos** - 1 contributor (board_member)
6. **Ernies Upholstery** - 1 contributor (technician)
7. **Hot Kiss Restoration** - 1 contributor (moderator)
8. **Nuke** - 1 contributor (owner)

**Observation:** All contributors belong to the same 8 orgs that have user attribution. There's a clear correlation between user-created orgs and contributor engagement.

---

## Recommendations

### 1. IMMEDIATE CLEANUP

- **Delete 1 orphan org** with no data:
  - `Seller` (29b6c470-b96a-492d-a818-c64e9f9450a0)

```sql
DELETE FROM businesses WHERE id = '29b6c470-b96a-492d-a818-c64e9f9450a0';
```

### 2. BACKFILL DISCOVERED_BY

- **216 orgs** have URLs but no `discovered_by`
- These are likely system-created from scrapers/imports
- **Recommended action:** Create a system user and set it as `discovered_by` for all system-imported orgs

```sql
-- Create system user (if not exists)
INSERT INTO auth.users (id, email, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'system@nuke.internal', 'service_role')
ON CONFLICT DO NOTHING;

-- Backfill discovered_by for system-created orgs
UPDATE businesses
SET discovered_by = '00000000-0000-0000-0000-000000000001'
WHERE discovered_by IS NULL AND (source_url IS NOT NULL OR website IS NOT NULL);
```

### 3. ADD MISSING URLS

- **6 orgs** have `discovered_by` but no `source_url`/`website`
- These are user-created orgs that need URLs added
- **Recommended action:** Contact the user or research URLs for:
  - Desert Performance
  - Taylor Customs
  - FBM
  - Viva! Las Vegas Autos
  - Ernies Upholstery
  - Hot Kiss Restoration

### 4. IMPLEMENT ORG_INTAKE METADATA

- **0 orgs** currently have `org_intake` metadata
- **Recommended action:** Add metadata tracking for new org creation:

```typescript
interface OrgIntakeMetadata {
  method: 'user_created' | 'scraper_import' | 'api_import' | 'manual_entry';
  source?: string;
  imported_at?: string;
  imported_by?: string;
}
```

### 5. ENCOURAGE CONTRIBUTOR RELATIONSHIPS

- **Only 8 orgs** (3.6%) have active contributors
- **Recommended action:**
  - Add UI prompts for users to connect with orgs they interact with
  - Gamify contributor relationships
  - Auto-suggest contributor relationships based on activity

---

## Data Quality Metrics

| Metric | Count | % |
|--------|-------|---|
| **Total orgs** | 224 | 100% |
| **Has discovered_by** | 7 | 3.1% |
| **Has source_url** | 162 | 72.3% |
| **Has website** | 217 | 96.9% |
| **Has org_intake metadata** | 0 | 0.0% |
| **Has description** | 196 | 87.5% |
| **Has logo** | 165 | 73.7% |
| **Has active contributors** | 8 | 3.6% |

---

## Conclusion

The Nuke organization database has **poor provenance health** with only 0.4% of orgs having full provenance tracking. The primary issue is that 96.4% of orgs lack user attribution (`discovered_by`), indicating they were created by automated systems without proper tracking.

**Immediate priorities:**
1. Delete 1 orphan org
2. Backfill `discovered_by` for 216 system-created orgs
3. Add URLs for 6 user-created orgs
4. Implement `org_intake` metadata for future tracking

**Long-term priorities:**
1. Encourage contributor relationships (currently only 3.6% of orgs)
2. Audit and deduplicate auction house entries (multiple BaT/C&B instances)
3. Establish clear org creation workflows with provenance tracking
