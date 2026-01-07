# Agent Quick Reference: Data Ingestion

> **TL;DR for AI agents**: Read this before touching any extraction/repair code.

---

## The Three Laws

### 1. Fix the Scraper, Not the Data
Bad data in DB → find broken extractor → fix extractor → re-run → verify

### 2. Evidence First, Write Second
Save snapshot → validate extraction → then update vehicles table

### 3. Null is Valid, Placeholders are Forbidden
Source doesn't provide field? → `null` with reason
Never use default images, never guess values

---

## Before You Extract

```
□ Is there a recent successful attempt for this vehicle? (check extraction_attempts)
□ Which extractor version is preferred? (check extractor_registry)
□ Do I have the source URL? (required)
```

---

## Extraction Checklist

```
□ Save snapshot of source HTML
□ Run extractor (use preferred version)
□ Record attempt in extraction_attempts
□ Validate against acceptance criteria
□ Only if valid: update vehicles table
□ If failed: classify failure, follow repair protocol
```

---

## Failure Response Matrix

| Failure | Action | Retry? |
|---------|--------|--------|
| `BLOCKED` | Wait + backoff | Yes, with delay |
| `NOT_FOUND` | Mark delisted | No |
| `SELECTOR_DRIFT` | Try alt extractor or alert dev | Maybe |
| `PARSE_ERROR` | Alert dev | No auto-retry |
| `VALIDATION_FAIL` | Queue manual review | No |
| `TIMEOUT` | Retry once | Yes, once |

---

## Required Fields for extraction_attempts

```javascript
{
  vehicle_id: "uuid",           // Required
  source_url: "https://...",    // Required
  source_type: "bat",           // Required
  extractor_name: "bat-listing",// Required
  extractor_version: "v6",      // Required
  status: "success|partial|failed", // Required
  failure_reason: "CODE",       // If failed
  metrics: { /* counts, timing */ }, // Required
  snapshot_ref: "path/to/snapshot",  // If we got the page
  extracted_data: { /* values */ }   // If we got data
}
```

---

## Image Rules

```
✓ Images from source domain only (e.g., bringatrailer.com)
✓ Store in vehicle_images with is_canonical = true
✓ Hash every image (file_hash) for deduplication
✓ Link to extraction_attempt_id for provenance

✗ No fallback images
✗ No placeholder images  
✗ No images from other domains in gallery
✗ No duplicate image URLs or hashes
```

---

## Repair Report Format

When fixing a vehicle, produce this:

```json
{
  "vehicle_id": "...",
  "before": {
    "extractor": "v5",
    "status": "failed",
    "reason": "SELECTOR_DRIFT",
    "images": 0
  },
  "after": {
    "extractor": "v6", 
    "status": "success",
    "images": 47
  },
  "evidence": {
    "snapshot": "snapshots/...",
    "diff": "Description of what changed"
  }
}
```

---

## Common Mistakes

| Mistake | Why It's Wrong | Do This Instead |
|---------|----------------|-----------------|
| `image_url \|\| defaultImage` | Pollutes DB with fake data | `image_url \|\| null` |
| Updating vehicle directly | No audit trail | Go through extraction_attempts |
| Retrying same extractor 10x | Won't fix selector drift | Classify failure, pick action |
| Skipping snapshot | Can't prove correctness later | Always snapshot first |
| Using retired extractor | Known to fail | Check registry status |

---

## SQL Snippets

### Find vehicles needing extraction
```sql
SELECT v.id, v.source_url 
FROM vehicles v
LEFT JOIN extraction_attempts ea 
  ON ea.vehicle_id = v.id 
  AND ea.status = 'success'
  AND ea.completed_at > now() - interval '30 days'
WHERE ea.id IS NULL
LIMIT 100;
```

### Check recent failures
```sql
SELECT failure_reason, count(*), max(completed_at)
FROM extraction_attempts
WHERE status = 'failed' 
  AND completed_at > now() - interval '24 hours'
GROUP BY failure_reason
ORDER BY count DESC;
```

### Get preferred extractor
```sql
SELECT name, version 
FROM extractor_registry 
WHERE source_type = 'bat' 
  AND status = 'preferred';
```

---

## When In Doubt

1. Re-read [DATA_INGESTION_AND_REPAIR_SYSTEM.md](./DATA_INGESTION_AND_REPAIR_SYSTEM.md)
2. Ask: "Am I fixing the extractor or patching data?"
3. Ask: "Do I have evidence for this change?"
4. Ask: "Is null a valid answer here?"

If still stuck: escalate to human review.

