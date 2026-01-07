# Data Ingestion and Repair System

> **Purpose**: This document is the authoritative specification for how vehicle data enters the system, how failures are detected and repaired, and how extractors evolve. Any agent (AI or human) implementing ingestion, validation, or repair logic MUST follow this specification.

---

## Table of Contents

1. [First Principles](#first-principles)
2. [Allowed Field States](#allowed-field-states)
3. [Data Flow Architecture](#data-flow-architecture)
4. [Extraction Attempts Model](#extraction-attempts-model)
5. [Failure Classification](#failure-classification)
6. [Repair Loop Protocol](#repair-loop-protocol)
7. [Evidence and Proof Requirements](#evidence-and-proof-requirements)
8. [Extractor Versioning and Promotion](#extractor-versioning-and-promotion)
9. [Agent Behavior Rules](#agent-behavior-rules)
10. [Anti-Patterns (What NOT To Do)](#anti-patterns-what-not-to-do)
11. [Acceptance Criteria](#acceptance-criteria)
12. [Schema Reference](#schema-reference)

---

## First Principles

### 1. Fix the Scraper, Not the Data

When bad data appears in the database:
- **DO**: Find why the extractor produced bad data, fix the extractor, re-run it, verify the fix.
- **DO NOT**: Manually patch the database row as a one-off fix.

Manual patches don't generalize. A fixed extractor fixes all future vehicles from that source.

### 2. Evidence-Based Everything

Every data change must be traceable to:
- A **source URL** (where the data came from)
- An **extractor version** (what code produced it)
- A **snapshot reference** (proof of what the source looked like at extraction time)

Without evidence, data is unverifiable and disputes are unresolvable.

### 3. Null is Not an Error

A field being `null` is valid if:
- The source genuinely doesn't provide that information
- The extractor correctly determined "not present"

A field being `null` is a **failure** only if:
- The source provides the data but the extractor missed it
- The extractor crashed before completion

### 4. Multiple Attempts Are Expected (During Prototyping)

Early in system development:
- A vehicle may have 5+ extraction attempts from different extractor versions
- This is normal and expected
- The system learns which extractor works

Later (steady state):
- New vehicles should have 1-2 attempts max
- Old extractors are retired
- Only proven extractors run

### 5. The UI Shows Trusted Data Only

Users should never see:
- Data from failed extractions
- Data pending verification
- Placeholder/fallback images

If data isn't verified, it shouldn't be displayed. Show "data unavailable" rather than wrong data.

---

## Allowed Field States

Every field in a vehicle profile has exactly these valid states:

| State | Meaning | Stored As | UI Display |
|-------|---------|-----------|------------|
| **Present** | Source provided it, extractor captured it | Actual value | Show value |
| **Absent** | Source doesn't provide this field | `null` | "Not provided" or hide field |
| **Pending** | Extraction in progress | `null` + status flag | Loading indicator |
| **Failed** | Extractor crashed or was blocked | `null` + failure record | "Unavailable" + trigger repair |

### Critical Rule: No Invented Data

If the source doesn't provide a field, the extractor MUST NOT:
- Guess a value
- Use a default/placeholder
- Copy from another vehicle
- Use a "fallback" image

The only valid response to missing source data is `null` with reason `"source_not_provided"`.

---

## Data Flow Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         DATA FLOW                                    │
└─────────────────────────────────────────────────────────────────────┘

    ┌──────────┐     ┌──────────────┐     ┌──────────────┐
    │  Source  │────▶│  Extractor   │────▶│  Validator   │
    │  (URL)   │     │  (versioned) │     │  (rules)     │
    └──────────┘     └──────────────┘     └──────────────┘
                            │                    │
                            ▼                    ▼
                     ┌──────────────┐     ┌──────────────┐
                     │   Attempt    │     │   Pass?      │
                     │   Record     │     │              │
                     └──────────────┘     └──────┬───────┘
                                                 │
                          ┌──────────────────────┴──────────────────────┐
                          │                                             │
                          ▼                                             ▼
                   ┌──────────────┐                              ┌──────────────┐
                   │   SUCCESS    │                              │   FAILURE    │
                   │              │                              │              │
                   │ • Write to   │                              │ • Log reason │
                   │   vehicles   │                              │ • Queue for  │
                   │ • Mark       │                              │   repair     │
                   │   trusted    │                              │ • Alert if   │
                   │              │                              │   pattern    │
                   └──────────────┘                              └──────────────┘
                                                                        │
                                                                        ▼
                                                                 ┌──────────────┐
                                                                 │  REPAIR LOOP │
                                                                 │  (see below) │
                                                                 └──────────────┘
```

### Key Components

1. **Source**: The canonical URL where data lives (e.g., BaT listing page)
2. **Extractor**: Versioned code that parses the source into structured data
3. **Validator**: Rules that check if extracted data meets acceptance criteria
4. **Attempt Record**: Audit log of what happened during extraction
5. **Repair Loop**: Automated system that fixes failures

---

## Extraction Attempts Model

Every extraction attempt is recorded. This is non-negotiable.

### Required Fields

```sql
CREATE TABLE extraction_attempts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- What we tried to extract
    vehicle_id UUID REFERENCES vehicles(id),
    source_url TEXT NOT NULL,
    source_type TEXT NOT NULL,  -- 'bat', 'craigslist', 'ebay', etc.
    
    -- What code ran
    extractor_name TEXT NOT NULL,      -- 'bat-listing-extractor'
    extractor_version TEXT NOT NULL,   -- 'v6', 'v6.1', 'v7-beta'
    
    -- What happened
    status TEXT NOT NULL,              -- 'success', 'partial', 'failed'
    failure_reason TEXT,               -- Structured reason if failed
    failure_details JSONB,             -- Additional context
    
    -- What we got
    metrics JSONB NOT NULL DEFAULT '{}',  -- Counts, timings, etc.
    extracted_data JSONB,                  -- The actual extracted values
    
    -- Evidence
    snapshot_ref TEXT,                 -- Storage path to raw HTML/DOM
    screenshot_ref TEXT,               -- Optional: visual proof
    
    -- Timestamps
    started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    completed_at TIMESTAMPTZ,
    
    -- Indexes for common queries
    CONSTRAINT valid_status CHECK (status IN ('success', 'partial', 'failed'))
);

CREATE INDEX idx_attempts_vehicle ON extraction_attempts(vehicle_id);
CREATE INDEX idx_attempts_status ON extraction_attempts(status);
CREATE INDEX idx_attempts_extractor ON extraction_attempts(extractor_name, extractor_version);
```

### Metrics JSONB Structure

```json
{
  "images": {
    "lead_found": 1,
    "gallery_found": 47,
    "additional_found": 12,
    "total": 60
  },
  "fields": {
    "title": true,
    "price": true,
    "description": true,
    "vin": false,
    "mileage": true
  },
  "timing": {
    "fetch_ms": 1200,
    "parse_ms": 340,
    "total_ms": 1540
  },
  "source": {
    "page_size_bytes": 245000,
    "dom_nodes": 3400
  }
}
```

---

## Failure Classification

Failures are categorized to enable automated repair decisions.

### Failure Types

| Code | Name | Cause | Repair Action |
|------|------|-------|---------------|
| `BLOCKED` | Access Denied | Rate limit, IP ban, auth required | Retry with delay/proxy |
| `NOT_FOUND` | Page Gone | 404, listing removed | Mark vehicle as delisted |
| `SELECTOR_DRIFT` | DOM Changed | Site updated their HTML | Update extractor selectors |
| `PARSE_ERROR` | Extraction Bug | Code threw exception | Fix extractor code |
| `VALIDATION_FAIL` | Bad Data | Extracted but doesn't meet criteria | Review acceptance criteria |
| `TIMEOUT` | Too Slow | Network/parsing timeout | Retry or optimize |
| `PARTIAL` | Incomplete | Some fields succeeded, some failed | Analyze which failed |
| `POLLUTION` | Wrong Data | Extracted data from wrong element | Fix selectors |

### Failure Reason Structure

```json
{
  "code": "SELECTOR_DRIFT",
  "message": "Gallery container selector returned 0 elements",
  "selector": ".gallery-container .image-item",
  "expected": "array of image URLs",
  "actual": "empty array",
  "suggestion": "Check if BaT changed gallery markup"
}
```

---

## Repair Loop Protocol

When an extraction fails, this protocol executes:

### Step 1: Detect

```
INPUT: Extraction attempt with status != 'success'
OUTPUT: Failure classification + severity
```

- Classify failure using the taxonomy above
- Determine if this is a one-off or pattern (check recent attempts for same source_type)
- Assign severity: `critical` (blocking user value), `high`, `medium`, `low`

### Step 2: Decide

```
INPUT: Classified failure
OUTPUT: Repair action
```

Decision tree:

```
IF failure.code == 'BLOCKED':
    IF recent_block_rate > 50%:
        ALERT: "Source is blocking us systematically"
        ACTION: pause_source + human_review
    ELSE:
        ACTION: retry_with_backoff(delay=exponential)

ELIF failure.code == 'NOT_FOUND':
    ACTION: mark_vehicle_delisted + no_retry

ELIF failure.code == 'SELECTOR_DRIFT':
    IF alternative_extractor_exists:
        ACTION: try_alternative_extractor
    ELSE:
        ACTION: queue_for_extractor_update + alert_dev

ELIF failure.code == 'PARSE_ERROR':
    ACTION: log_exception + alert_dev + no_auto_retry

ELIF failure.code == 'VALIDATION_FAIL':
    ACTION: queue_for_manual_review

ELIF failure.code == 'PARTIAL':
    ACTION: merge_partial_data + queue_retry_for_missing

ELSE:
    ACTION: retry_once + alert_if_still_fails
```

### Step 3: Execute

```
INPUT: Repair action
OUTPUT: New extraction attempt
```

- Run the chosen action
- Create a new `extraction_attempts` record
- Link to previous attempt (`previous_attempt_id`)

### Step 4: Verify

```
INPUT: New extraction attempt
OUTPUT: Pass/fail determination + evidence
```

- Run validator against extracted data
- Compare against acceptance criteria
- Generate before/after diff if this was a repair
- Store evidence (snapshot_ref, metrics)

### Step 5: Report

```
INPUT: Verification result
OUTPUT: Audit record + optional alert
```

If repair succeeded:
```json
{
  "event": "repair_success",
  "vehicle_id": "abc-123",
  "source_url": "https://bringatrailer.com/listing/...",
  "before": {
    "extractor": "bat-v5",
    "status": "failed",
    "failure_code": "SELECTOR_DRIFT",
    "images_found": 0
  },
  "after": {
    "extractor": "bat-v6",
    "status": "success",
    "images_found": 47
  },
  "evidence": {
    "snapshot": "snapshots/2026-01-07/abc-123.html",
    "diff": "Vehicle now has 47 images from gallery"
  }
}
```

---

## Evidence and Proof Requirements

### What Counts as Evidence

1. **Snapshot**: Raw HTML of the source page at extraction time
   - Storage: `snapshots/{date}/{vehicle_id}.html`
   - Retention: 90 days minimum
   - Purpose: Prove what the source showed

2. **Screenshot**: Visual capture of the page (optional but valuable)
   - Storage: `screenshots/{date}/{vehicle_id}.png`
   - Purpose: Prove rendering matched expectation

3. **Extracted Data Log**: The exact values pulled out
   - Storage: `extraction_attempts.extracted_data` JSONB column
   - Purpose: Prove what the extractor produced

4. **Diff Record**: Before/after comparison for repairs
   - Storage: Computed at report time
   - Purpose: Prove the repair fixed the problem

### Evidence Rules

- **Never delete evidence** while a dispute is possible (90 days)
- **Always reference evidence** when claiming a repair succeeded
- **Store evidence before writing to vehicles table** (evidence-first)

---

## Extractor Versioning and Promotion

### Version Naming

```
{source}-{purpose}-v{major}.{minor}

Examples:
  bat-listing-v6
  bat-listing-v6.1
  bat-listing-v7-beta
  craigslist-search-v2
```

- **Major**: Breaking changes, new selector strategy
- **Minor**: Bug fixes, small selector tweaks
- **Beta suffix**: Testing, not production

### Promotion Criteria

An extractor version is promoted to "preferred" when:

1. **Success rate >= 95%** over last 100 attempts
2. **No critical failures** in last 50 attempts
3. **Validation pass rate >= 98%**
4. **Human review** of 10 random samples confirms quality

### Retirement Criteria

An extractor version is retired when:

1. **Replaced by newer version** that meets promotion criteria
2. **Success rate < 50%** over last 50 attempts
3. **Source changed fundamentally** (site redesign)

Retired extractors are:
- Kept in codebase (for reference)
- Marked `status: 'retired'` in registry
- Never run on new vehicles
- May run for regression tests

### Extractor Registry

```sql
CREATE TABLE extractor_registry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,           -- 'bat-listing'
    version TEXT NOT NULL,        -- 'v6'
    status TEXT NOT NULL,         -- 'active', 'preferred', 'deprecated', 'retired'
    source_type TEXT NOT NULL,    -- 'bat'
    
    -- Performance tracking
    total_attempts INT DEFAULT 0,
    success_count INT DEFAULT 0,
    success_rate NUMERIC(5,4) GENERATED ALWAYS AS (
        CASE WHEN total_attempts > 0 
        THEN success_count::numeric / total_attempts 
        ELSE 0 END
    ) STORED,
    
    -- Metadata
    created_at TIMESTAMPTZ DEFAULT now(),
    promoted_at TIMESTAMPTZ,
    retired_at TIMESTAMPTZ,
    notes TEXT,
    
    UNIQUE(name, version)
);
```

---

## Agent Behavior Rules

These rules apply to any AI agent working on ingestion/repair.

### MUST DO

1. **Check extraction_attempts before re-extracting**
   - Don't duplicate work if recent successful attempt exists
   - If retrying, reference previous attempt

2. **Record every extraction attempt**
   - No silent extractions
   - No "just quickly fixing this one"

3. **Store evidence before updating vehicles**
   - Snapshot first, write second
   - Evidence-first principle

4. **Use the repair loop protocol**
   - Don't invent ad-hoc repair strategies
   - Follow detect → decide → execute → verify → report

5. **Report before/after for repairs**
   - Every repair must show what changed
   - Link to evidence

6. **Respect extractor versions**
   - Use preferred version unless testing
   - Create new version for selector changes

### MUST NOT

1. **Manually patch vehicle data as primary fix**
   - Fix the extractor, not the row
   - Exception: One-time data migration with full audit trail

2. **Use placeholder/fallback images**
   - If image extraction fails, field is null
   - No default images ever

3. **Guess missing data**
   - Null is valid
   - Invented data is fraud

4. **Delete evidence**
   - Mark as superseded, don't delete
   - Retention policy handles cleanup

5. **Skip validation**
   - Every extraction runs through validator
   - No "trusted" extractors that skip checks

6. **Run retired extractors on new vehicles**
   - Check registry status first
   - Retired = don't use

### SHOULD DO

1. **Batch similar repairs**
   - If selector drift affects 100 vehicles, fix extractor once
   - Re-run on all affected vehicles

2. **Alert on patterns**
   - 5+ failures from same source in 1 hour = alert
   - Success rate drop > 10% = alert

3. **Document extractor changes**
   - Why did selectors change?
   - What was the fix?
   - Add to extractor notes

---

## Anti-Patterns (What NOT To Do)

### Anti-Pattern 1: The Silent Fix

❌ **Wrong**:
```javascript
// Noticed bad data, just fix it
await supabase.from('vehicles').update({ image_url: correctUrl }).eq('id', vehicleId);
```

✅ **Right**:
```javascript
// Create extraction attempt, run extractor, validate, then update
const attempt = await runExtractor(vehicleId, sourceUrl, 'bat-listing-v6');
if (attempt.status === 'success' && await validate(attempt)) {
    await updateVehicle(vehicleId, attempt.extracted_data);
    await recordSuccess(attempt);
}
```

### Anti-Pattern 2: The Fallback Image

❌ **Wrong**:
```javascript
const imageUrl = extractedImage || '/images/default-car.png';
```

✅ **Right**:
```javascript
const imageUrl = extractedImage || null;
// UI handles null: shows "Image unavailable" or hides element
```

### Anti-Pattern 3: The Retry Loop Without Learning

❌ **Wrong**:
```javascript
while (attempts < 10) {
    result = await extract(url);
    if (result.success) break;
    attempts++;
}
```

✅ **Right**:
```javascript
const result = await extract(url, extractorV6);
if (!result.success) {
    const failure = classifyFailure(result);
    const action = decideRepairAction(failure);
    await executeRepairAction(action);  // Might try different extractor
}
```

### Anti-Pattern 4: The Unversioned Extractor

❌ **Wrong**:
```javascript
// Updated selectors in place
const extractGallery = () => { /* new code */ };
```

✅ **Right**:
```javascript
// Created new version
const extractGallery_v6 = () => { /* old code */ };
const extractGallery_v7 = () => { /* new code */ };
// Registry tracks which is preferred
```

### Anti-Pattern 5: Evidence After The Fact

❌ **Wrong**:
```javascript
await updateVehicle(data);
await saveSnapshot(html);  // What if this fails?
```

✅ **Right**:
```javascript
const snapshotRef = await saveSnapshot(html);  // Evidence first
await updateVehicle({ ...data, snapshot_ref: snapshotRef });
```

---

## Acceptance Criteria

### Vehicle Profile: Minimum Viable

A vehicle profile is "complete" when:

| Field | Requirement |
|-------|-------------|
| `title` | Non-empty string |
| `source_url` | Valid URL to original listing |
| `source_type` | One of: bat, craigslist, ebay, etc. |
| `primary_image_url` | Valid image URL OR null with reason |
| `extraction_status` | 'complete' or 'partial' |
| `last_extracted_at` | Within 30 days (for active listings) |

### Image Extraction: Success Criteria

For BaT listings:

| Metric | Threshold |
|--------|-----------|
| Lead image found | Required (or null with reason) |
| Gallery images found | >= 80% of visible gallery |
| Image URLs valid | 100% return 200 OK |
| No external domain images | 0 non-BaT URLs in gallery |
| No duplicate images | 0 duplicates by URL or hash |

### Extraction Attempt: Valid Record

| Field | Requirement |
|-------|-------------|
| `extractor_version` | Matches registry entry |
| `status` | One of: success, partial, failed |
| `metrics` | Contains at least `timing.total_ms` |
| `snapshot_ref` | Present if status != 'failed' due to network |

---

## Schema Reference

### Core Tables

```
vehicles
├── id (PK)
├── title
├── source_url
├── source_type
├── primary_image_url
├── extraction_status
├── last_extracted_at
└── ...

extraction_attempts
├── id (PK)
├── vehicle_id (FK)
├── source_url
├── extractor_name
├── extractor_version
├── status
├── failure_reason
├── metrics (JSONB)
├── extracted_data (JSONB)
├── snapshot_ref
└── timestamps

extractor_registry
├── id (PK)
├── name
├── version
├── status
├── success_rate
└── timestamps

vehicle_images
├── id (PK)
├── vehicle_id (FK)
├── image_url
├── storage_path
├── image_type
├── position
├── file_hash
├── is_canonical
└── extraction_attempt_id (FK)
```

### Views for Common Queries

```sql
-- Vehicles needing extraction
CREATE VIEW vehicles_pending_extraction AS
SELECT v.* 
FROM vehicles v
LEFT JOIN extraction_attempts ea ON ea.vehicle_id = v.id 
    AND ea.status = 'success' 
    AND ea.completed_at > now() - interval '30 days'
WHERE ea.id IS NULL;

-- Recent failures by type
CREATE VIEW recent_failures_by_type AS
SELECT 
    failure_reason,
    extractor_name,
    count(*) as failure_count,
    max(completed_at) as last_failure
FROM extraction_attempts
WHERE status = 'failed' 
    AND completed_at > now() - interval '24 hours'
GROUP BY failure_reason, extractor_name
ORDER BY failure_count DESC;

-- Extractor performance
CREATE VIEW extractor_performance AS
SELECT 
    name,
    version,
    status,
    total_attempts,
    success_count,
    success_rate,
    CASE WHEN success_rate >= 0.95 THEN 'healthy'
         WHEN success_rate >= 0.80 THEN 'degraded'
         ELSE 'failing' END as health
FROM extractor_registry
WHERE status != 'retired';
```

---

## Changelog

| Date | Author | Change |
|------|--------|--------|
| 2026-01-07 | System | Initial specification |

---

## Questions?

If this document doesn't answer your question, the answer is probably:

1. **"Fix the extractor, not the data"**
2. **"Store evidence first"**
3. **"Null is valid if source doesn't provide it"**
4. **"Follow the repair loop protocol"**

If still unclear, escalate to human review before proceeding.

