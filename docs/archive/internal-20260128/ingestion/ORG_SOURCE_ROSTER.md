# Organization Source Roster

The `businesses` table already **is** the roster. Every organization profile that contains a `website` value is a candidate source that needs ongoing inspection, mapping, and extraction. This document captures the SQL snippets we use to surface those targets and prioritize runs.

---

## 1. Baseline Roster (All Organizations With Websites)

```sql
SELECT
  b.id,
  b.business_name,
  b.website,
  COALESCE(vc.vehicle_count, 0) AS vehicle_count,
  b.updated_at
FROM businesses b
LEFT JOIN LATERAL (
  SELECT COUNT(*) AS vehicle_count
  FROM organization_vehicles ov
  WHERE ov.organization_id = b.id
) vc ON TRUE
WHERE b.website IS NOT NULL
ORDER BY b.business_name;
```

Use this to export the full target list or to feed automation (CLI, MCP, or Edge Functions).

---

## 2. Orgs Missing Vehicles (Highest Priority)

```sql
SELECT
  b.id,
  b.business_name,
  b.website,
  b.business_type,
  b.updated_at
FROM businesses b
LEFT JOIN organization_vehicles ov
  ON ov.organization_id = b.id
WHERE b.website IS NOT NULL
GROUP BY b.id
HAVING COUNT(ov.vehicle_id) = 0
ORDER BY b.updated_at NULLS FIRST, b.business_name;
```

Use this to queue organizations for their first ingestion pass.

---

## 3. Orgs With Stale Schemas

```sql
SELECT
  b.id,
  b.business_name,
  b.website,
  ss.last_verified_at,
  ss.site_type,
  ss.extraction_confidence
FROM businesses b
LEFT JOIN source_site_schemas ss
  ON ss.domain = LOWER(REGEXP_REPLACE(b.website, '^https?://', ''))
WHERE b.website IS NOT NULL
  AND (ss.last_verified_at IS NULL OR ss.last_verified_at < NOW() - INTERVAL '30 days')
ORDER BY ss.last_verified_at NULLS FIRST, ss.extraction_confidence DESC NULLS LAST;
```

This exposes sites that either have no stored DOM map or need a refresh.

---

## 4. Orgs Without Schemas

```sql
SELECT
  b.id,
  b.business_name,
  b.website
FROM businesses b
LEFT JOIN source_site_schemas ss
  ON ss.domain = LOWER(REGEXP_REPLACE(b.website, '^https?://', ''))
WHERE b.website IS NOT NULL
  AND ss.id IS NULL
ORDER BY b.updated_at NULLS FIRST, b.business_name;
```

Use this list to trigger the mapping agent (Opus 4.5) for first-time schema creation.

---

## 5. Usage Notes

- Run queries with `supabase db remote commit`, the MCP Supabase SQL executor, or the Supabase Dashboard SQL editor.
- Keep exports lightweight (limit columns) when handing off to automation.
- Append additional filters for specialization (builder, broker, etc.) once classification fields are populated.
- As new ingestion tables (e.g., `ingestion_jobs`, `schema_proposals`) come online, extend these snippets so agents can quickly identify backlog segments.



