# Nuke Organization Provenance Audit - Final Report

**Date:** 2026-01-25
**Database:** Nuke Production (qkgaybvrernstplzjaam.supabase.co)
**Total Organizations:** 224
**Active Contributors:** 8
**Audit Queries:** `/Users/skylar/nuke/audit-org-provenance.sql`
**Analysis Scripts:** `/Users/skylar/nuke/analyze-org-provenance.js`, `/Users/skylar/nuke/org-provenance-report.js`

---

## Executive Summary

The Nuke database has **POOR** organization provenance health:

- ✅ **1 org (0.4%)** has full provenance (discovered_by + URL)
- ⚠️ **216 orgs (96.4%)** need discovered_by field (system-created)
- ❌ **7 orgs (3.1%)** need immediate attention (missing standard provenance fields)
- 🔍 **1 orphan org** has provenance data in metadata but not in standard fields

### Overall Provenance Health: 🔴 POOR (0.4% fully compliant)

---

## Data Quality Metrics

| Metric | Count | Percentage |
|--------|-------|------------|
| **Total public orgs** | 224 | 100.0% |
| **Has discovered_by** | 7 | 3.1% |
| **Has source_url** | 162 | 72.3% |
| **Has website** | 217 | 96.9% |
| **Has org_intake metadata** | 0 | 0.0% |
| **Has description** | 196 | 87.5% |
| **Has logo** | 165 | 73.7% |
| **Has active contributors** | 8 | 3.6% |

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

### 1. Good Provenance (1 org, 0.4%) ✅

**Only 1 org** has proper user attribution AND source URLs:

- **Nuke** (`f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb`)
  - Discovered by: `0b9f107a-d124-49de-9ded-94698f63c1c4`
  - Website: https://www.nukeltd.com
  - Has 1 active contributor (owner)
  - **Status: GOOD - This is the gold standard**

---

### 2. Has User But No URL (6 orgs, 2.7%) ⚠️

These orgs were created by users but lack `source_url`/`website`. All were discovered by the same user (`0b9f107a-d124-49de-9ded-94698f63c1c4`):

| Organization | Type | Created | Description | Logo | Contributors |
|--------------|------|---------|-------------|------|--------------|
| **Desert Performance** | specialty_shop | 2025-12-06 | No | Yes | 1 (photographer) |
| **Taylor Customs** | body_shop | 2025-11-22 | Yes | Yes | 1 (photographer) |
| **FBM** | garage | 2025-11-02 | Yes | Yes | 1 (contractor) |
| **Viva! Las Vegas Autos** | dealership | 2025-11-02 | Yes | Yes | 1 (board_member) |
| **Ernies Upholstery** | specialty_shop | 2025-11-01 | Yes | Yes | 1 (technician) |
| **Hot Kiss Restoration** | restoration_shop | 2025-11-01 | Yes | Yes | 1 (moderator) |

**Action needed:** Add website URLs for these 6 orgs.

---

### 3. Has URL But No User (216 orgs, 96.4%) ⚠️

This is the **LARGEST category**. These orgs have website/source_url but no `discovered_by` field. They are likely system-created from scrapers/imports.

#### Breakdown by Business Type

| Type | Count | % of Category |
|------|-------|---------------|
| dealership | 113 | 52.3% |
| specialty_shop | 59 | 27.3% |
| auction_house | 17 | 7.9% |
| builder | 5 | 2.3% |
| other | 4 | 1.9% |
| unknown | 3 | 1.4% |
| restoration_shop | 3 | 1.4% |
| performance_shop | 3 | 1.4% |
| rally_event | 2 | 0.9% |
| marketplace | 1 | 0.5% |
| dealer | 1 | 0.5% |
| motorsport_event | 1 | 0.5% |
| automotive_expo | 1 | 0.5% |
| concours | 1 | 0.5% |
| fabrication | 1 | 0.5% |
| detailing | 1 | 0.5% |

#### Major Platforms Included

- **Auction Houses:** Bring a Trailer (multiple), Cars and Bids (multiple), PCarMarket, SBX Cars, RM Sotheby's, Bonhams, Gooding and Company
- **Marketplaces:** Craigslist
- **System orgs:** Internet Archive, Carfax, SearchTempest

**Action needed:** Backfill `discovered_by` with a system user ID for these 216 orgs.

---

### 4. Orphan Garbage (1 org, 0.4%) 🔍

**Special case discovered during audit:**

- **Seller** (`29b6c470-b96a-492d-a818-c64e9f9450a0`)
  - Type: dealership
  - Created: 2026-01-24
  - No `discovered_by`, no `source_url`, no `website`
  - **BUT** has metadata with provenance:
    ```json
    {
      "platform": "sbxcars",
      "discovered_at": "2026-01-24T12:58:29.762Z",
      "discovered_from": "https://sbxcars.com/listing/581/2021-ford-hennessey-venom-775"
    }
    ```
  - **FINDING:** This org was created by the SBX Cars scraper but the provenance data was stored in `metadata` instead of proper columns
  - **RECOMMENDATION:** Migrate metadata provenance to `source_url` field

---

## Organization Contributors Analysis

**Total orgs with active contributors:** 8 (3.6%)
**Total orgs without contributors:** 216 (96.4%)

### Orgs WITH Active Contributors

All 8 orgs with contributors are also the orgs with user attribution (discovered_by):

| Organization | Contributors | Roles |
|--------------|--------------|-------|
| **Nuke** | 1 | owner |
| **Desert Performance** | 1 | photographer |
| **Taylor Customs** | 1 | photographer |
| **FBM** | 1 | contractor |
| **Viva! Las Vegas Autos** | 1 | board_member |
| **Ernies Upholstery** | 1 | technician |
| **Hot Kiss Restoration** | 1 | moderator |
| **Unknown org** (e068f208...) | 1 | contributor |

**Key Finding:** There's a **100% correlation** between user-created orgs (`discovered_by` is set) and orgs having active contributors. None of the 216 system-created orgs have contributors.

---

## Critical Issues Found

### Issue 1: Provenance Data Stored in Wrong Fields

**Problem:** At least 1 org (Seller) has provenance data in `metadata` field instead of proper columns (`source_url`, `discovered_by`, etc.)

**Impact:** Queries looking for orgs with provenance miss these orgs

**Fix:** Run migration to extract provenance from metadata into proper columns:

```sql
-- Extract source_url from metadata.discovered_from
UPDATE businesses
SET source_url = metadata->>'discovered_from'
WHERE source_url IS NULL
  AND metadata->>'discovered_from' IS NOT NULL;

-- Extract discovered_via from metadata.platform
UPDATE businesses
SET discovered_via = metadata->>'platform'
WHERE discovered_via IS NULL
  AND metadata->>'platform' IS NOT NULL;
```

### Issue 2: No org_intake Metadata Tracking

**Problem:** 0 orgs have `metadata->org_intake` tracking

**Impact:** No way to know how orgs were created

**Fix:** Implement `org_intake` metadata for all new org creation:

```typescript
interface OrgIntakeMetadata {
  method: 'user_created' | 'scraper_import' | 'api_import' | 'manual_entry';
  source?: string;
  user_id?: string;
  timestamp?: string;
}
```

### Issue 3: 96.4% of Orgs Lack User Attribution

**Problem:** 216 orgs have no `discovered_by` field

**Impact:** No accountability for org creation, no ownership

**Fix:** Create system user and backfill:

```sql
-- Option 1: Use existing system user if available
-- Option 2: Create new system user
INSERT INTO auth.users (id, email, role)
VALUES ('00000000-0000-0000-0000-000000000001', 'system@nuke.internal', 'service_role')
ON CONFLICT DO NOTHING;

-- Backfill discovered_by for system-created orgs
UPDATE businesses
SET discovered_by = '00000000-0000-0000-0000-000000000001'
WHERE discovered_by IS NULL;
```

---

## Recommendations

### Priority 1: IMMEDIATE (This Week)

1. **Migrate provenance from metadata to proper columns**
   ```sql
   UPDATE businesses
   SET source_url = metadata->>'discovered_from'
   WHERE source_url IS NULL
     AND metadata->>'discovered_from' IS NOT NULL;
   ```

2. **Do NOT delete the "Seller" org** - it has valid provenance in metadata, just needs migration

### Priority 2: HIGH (This Month)

3. **Backfill discovered_by for 216 system-created orgs**
   - Create system user ID
   - Set `discovered_by` for all orgs created by scrapers/imports

4. **Add website URLs for 6 user-created orgs**
   - Research and add URLs for Desert Performance, Taylor Customs, FBM, etc.

### Priority 3: MEDIUM (This Quarter)

5. **Implement org_intake metadata tracking**
   - Add metadata on all new org creation
   - Track creation method, source, timestamp

6. **Audit and deduplicate auction house entries**
   - Found multiple instances of "Bring a Trailer", "Cars and Bids"
   - Consolidate duplicates

### Priority 4: LOW (Future)

7. **Encourage contributor relationships**
   - Only 3.6% of orgs have contributors
   - Add UI prompts for users to connect with orgs
   - Gamify contributor relationships

---

## SQL Queries Used

All audit queries are saved in: `/Users/skylar/nuke/audit-org-provenance.sql`

Key queries:
1. Overall provenance health
2. Provenance quality breakdown
3. Garbage org identification
4. org_intake metadata patterns
5. Organization contributors analysis

---

## Analysis Scripts

- **Data fetch:** `/tmp/nuke_orgs_audit.json` (224 orgs)
- **Contributors fetch:** `/tmp/nuke_org_contributors.json` (8 contributors)
- **Analysis script:** `/Users/skylar/nuke/analyze-org-provenance.js`
- **Detailed report:** `/Users/skylar/nuke/org-provenance-report.js`

---

## Conclusion

The Nuke organization database has **poor provenance health** with only 0.4% of orgs having full provenance tracking. However, the situation is better than initial analysis suggested - the 1 "orphan" org actually has provenance data, just stored in the wrong field.

**Key Insights:**

1. **User attribution is critical** - All orgs with `discovered_by` also have active contributors (100% correlation)
2. **Provenance field inconsistency** - Some scrapers store provenance in `metadata` instead of proper columns
3. **System orgs dominate** - 96.4% of orgs are system-created without user attribution
4. **Low contributor engagement** - Only 3.6% of orgs have active contributors

**The good news:** Most orgs (96.9%) have website data, and 72.3% have source_url. The main issue is missing user attribution, which can be fixed by backfilling with a system user ID.

**Next steps:**
1. Migrate metadata provenance to proper columns (fixes "orphan" org)
2. Backfill discovered_by for system-created orgs
3. Add URLs for 6 user-created orgs
4. Implement org_intake metadata for future tracking

---

## Appendix: Raw Data Samples

### Sample "Good Provenance" Org

```json
{
  "id": "f32ea08c-c2c5-4ca9-896d-cb99ce6c7bfb",
  "business_name": "Nuke",
  "discovered_by": "0b9f107a-d124-49de-9ded-94698f63c1c4",
  "website": "https://www.nukeltd.com",
  "has_contributors": true
}
```

### Sample "Orphan" Org (Actually Has Metadata Provenance)

```json
{
  "id": "29b6c470-b96a-492d-a818-c64e9f9450a0",
  "business_name": "Seller",
  "business_type": "dealership",
  "discovered_by": null,
  "source_url": null,
  "website": null,
  "metadata": {
    "platform": "sbxcars",
    "discovered_at": "2026-01-24T12:58:29.762Z",
    "discovered_from": "https://sbxcars.com/listing/581/2021-ford-hennessey-venom-775"
  }
}
```

---

**Audit completed:** 2026-01-25
**Audited by:** Claude Code (Nuke Development Team)
**Files generated:**
- `/Users/skylar/nuke/ORG_PROVENANCE_AUDIT_2026-01-25.md`
- `/Users/skylar/nuke/ORG_PROVENANCE_AUDIT_FINAL_2026-01-25.md`
- `/Users/skylar/nuke/audit-org-provenance.sql`
- `/Users/skylar/nuke/analyze-org-provenance.js`
- `/Users/skylar/nuke/org-provenance-report.js`
