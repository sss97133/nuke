# Valuation Citation System - Complete Implementation

**Date**: November 1, 2025  
**Status**: ✅ DEPLOYED TO PRODUCTION

## Overview

The Valuation Citation System transforms vehicle valuations from "AI guesses" into **expert-level, fully-sourced appraisals**. Every dollar in a valuation now cites WHO submitted it, WHEN, their relationship to the vehicle, and the supporting EVIDENCE.

---

## Core Principle

> **"Expert means every figure is annotated"**

- Click any dollar amount → see source attribution
- Every citation links to evidence (receipts, tags, images, documents)
- User accuracy is tracked and scored
- System generates "blanks" for missing data
- Users fill blanks → earn accuracy tiers → build reputation

---

## Database Schema

### 1. `valuation_citations` (Source Attribution)

Every price component gets a citation:

```sql
CREATE TABLE valuation_citations (
  id UUID PRIMARY KEY,
  vehicle_id UUID,
  
  -- What this is
  component_type TEXT,  -- 'purchase_price', 'part_purchase', 'labor_hours', etc.
  component_name TEXT,  -- 'Master Cylinder', 'Purchase Floor', etc.
  
  -- The value
  value_usd NUMERIC(12,2),
  value_type TEXT,  -- 'cost', 'price', 'rate_hourly', 'hours'
  
  -- WHO submitted
  submitted_by UUID,
  submitter_role TEXT,  -- 'owner', 'mechanic', 'appraiser', 'ai', 'system'
  submitter_name TEXT,
  
  -- WHEN
  submitted_at TIMESTAMPTZ,
  effective_date DATE,
  
  -- EVIDENCE
  evidence_type TEXT,  -- 'receipt', 'image_tag', 'user_input', 'ai_extraction', etc.
  source_document_id UUID,
  source_image_tag_id UUID,
  source_image_id UUID,
  
  -- For labor
  shop_id UUID,
  laborer_user_id UUID,
  mitchell_operation_code TEXT,
  
  -- Accuracy tracking
  confidence_score INTEGER,  -- 0-100
  verification_status TEXT,  -- 'unverified', 'receipt_confirmed', 'peer_verified', etc.
  verified_by UUID,
  
  -- User override tracking
  is_user_generated BOOLEAN,
  replaced_system_value BOOLEAN,
  superseded_by UUID
);
```

**Triggers:**
- Auto-creates citations when receipts uploaded
- Auto-creates citations when AI detects components
- Tracks when users verify/dispute citations

---

### 2. `user_valuation_inputs` (Track User Edits)

```sql
CREATE TABLE user_valuation_inputs (
  id UUID PRIMARY KEY,
  user_id UUID,
  vehicle_id UUID,
  citation_id UUID,
  
  field_name TEXT,  -- 'labor_hours', 'shop_rate', 'part_cost'
  field_value TEXT,
  field_value_numeric NUMERIC(12,2),
  
  input_method TEXT,  -- 'manual', 'dropdown', 'ocr_correction', 'ai_correction'
  replaced_ai_value BOOLEAN,
  
  accuracy_score INTEGER,  -- 0-100
  verification_count INTEGER,
  dispute_count INTEGER,
  consensus_value TEXT
);
```

---

### 3. `user_valuation_accuracy` (Reputation System)

```sql
CREATE TABLE user_valuation_accuracy (
  user_id UUID PRIMARY KEY,
  
  total_inputs INTEGER,
  verified_inputs INTEGER,
  disputed_inputs INTEGER,
  accuracy_rate NUMERIC(5,2),  -- 0-100%
  
  valuation_tier TEXT,  -- 'novice', 'contributor', 'trusted', 'expert', 'professional', 'appraiser'
  tier_achieved_at TIMESTAMPTZ,
  
  strongest_categories TEXT[],  -- e.g., ["labor_hours", "shop_rates"]
  avg_confidence_score NUMERIC(5,2),
  consensus_match_rate NUMERIC(5,2)
);
```

**Tier Thresholds:**
- **Novice**: 0+ inputs
- **Contributor**: 3+ verified
- **Trusted**: 10+ verified, 60%+ accuracy
- **Expert**: 25+ verified, 75%+ accuracy
- **Professional**: 50+ verified, 85%+ accuracy
- **Appraiser**: 100+ verified, 90%+ accuracy

Auto-elevation when thresholds met.

---

### 4. `valuation_blanks` (Missing Data Prompts)

```sql
CREATE TABLE valuation_blanks (
  id UUID PRIMARY KEY,
  vehicle_id UUID,
  
  blank_type TEXT,  -- 'missing_receipt', 'unknown_labor_hours', 'untagged_part', etc.
  component_name TEXT,  -- 'Master Cylinder install'
  
  priority TEXT,  -- 'low', 'medium', 'high', 'critical'
  impact_on_value_usd NUMERIC(12,2),
  
  suggested_questions TEXT[],  -- ["Who installed this part?", "What was the shop rate?"]
  related_evidence UUID[],  -- image/doc IDs
  
  status TEXT,  -- 'open', 'filled', 'skipped', 'not_applicable'
  filled_by UUID,
  filled_citation_id UUID
);
```

**Function:** `generate_valuation_blanks(vehicle_id)` scans for:
- Untagged parts in images
- Tags without receipt links
- Parts without install labor data
- Missing shop rates

---

### 5. `labor_rate_sources` (Labor Rate Attribution)

```sql
CREATE TABLE labor_rate_sources (
  id UUID PRIMARY KEY,
  
  hourly_rate_usd NUMERIC(8,2),
  rate_type TEXT,  -- 'shop_posted_rate', 'mitchell_standard', 'regional_average', etc.
  
  shop_id UUID,
  laborer_user_id UUID,
  region TEXT,
  labor_category TEXT,  -- 'mechanical', 'body', 'paint', 'electrical'
  
  source_document_id UUID,
  source_url TEXT,
  
  verified BOOLEAN,
  verification_count INTEGER
);
```

---

### 6. Enhanced `image_tags` (Link to Receipts)

Added columns:
```sql
ALTER TABLE image_tags
  ADD COLUMN receipt_line_item_id UUID,  -- Links tag → receipt proof
  ADD COLUMN part_installed_by UUID,
  ADD COLUMN install_shop_id UUID,
  ADD COLUMN install_labor_hours NUMERIC(6,2),
  ADD COLUMN install_labor_rate NUMERIC(8,2);
```

Now tags can show: "This master cylinder cost $100 (receipt link), installed by John Doe, 2.5 hours @ $95/hr (shop link)."

---

## Frontend UI

### Clickable Values

Every dollar amount in the valuation breakdown is now clickable:

```tsx
const ClickableValue = ({ value, componentType, componentName }) => (
  <span
    onClick={() => setSelectedCitation({ type: componentType, name: componentName, value })}
    style={{
      cursor: 'pointer',
      textDecoration: 'underline',
      textDecorationStyle: 'dotted',
      textDecorationColor: 'var(--accent)',
      fontWeight: 'bold'
    }}
    title="Click to view source"
  >
    {formatCurrency(value)}
  </span>
);
```

Examples:
- **Purchase Floor: [$75,000]** ← click to see who submitted, when, what document
- **Master Cylinder: [$100]** ← click to see receipt, installer, labor hours
- **Estimated Value: [$75,825]** ← click to see all sources that fed into this

---

### Citation Modal

Shows full attribution for any clicked value:

**Header:**
- Component name
- Total value
- Number of sources

**Per-source card:**
- WHO: Name + role badge (owner, mechanic, AI, system)
- WHEN: Submitted date, effective date
- VALUE: Dollar amount + type
- EVIDENCE: Badge (🧾 Receipt, 🏷️ Tag, 🤖 AI, etc.) + links to view
- CONFIDENCE: Score + verification status
- LABOR: Shop, laborer, Mitchell code (if applicable)
- NOTES: Free text

**Evidence links:**
- "View Receipt/Document" → opens document
- "View Image" → lightbox
- "View Tag" → jumps to tagged image

---

### Valuation Breakdown Card

**Header:**
- Title: "Valuation Breakdown" (not "AI Expert")
- Confidence: 70% confidence
- Add Receipt button
- Collapse toggle (▲/▼)

**Body:**
- Purchase Floor: **[$75,000]** ← clickable
- + Documented Components: **[$825]** ← clickable
- = Estimated Value: **[$75,825]** ← clickable

**Documented Components List:**
Each part shows:
- Name (e.g., "Master Cylinder")
- Condition (Good · 7/10)
- Date
- Photo count badge
- **Value** ← clickable

---

## Smart Receipt Processing

### Edge Function: `smart-receipt-linker`

**Deployed**: ✅ Production

**What it does:**
1. **Extracts** receipt data using OpenAI Vision
   - Vendor, date, line items, totals
   - Part numbers, quantities, unit prices
   - Labor hours estimation
   - Tax breakdown
   - Confidence scoring

2. **Matches** receipt items to vehicle images
   - Finds images from ±7 days
   - Uses AI to match parts to photos
   - Score 0.9-1.0: Definite match (part clearly visible)
   - Score 0.7-0.89: Probable match (related work visible)
   - Creates match reasoning

3. **Links** everything together
   - Inserts `receipt_items` with extracted data
   - Creates `valuation_citations` for parts
   - Creates `image_tags` linking receipt → images
   - Creates `timeline_events` for receipt upload

4. **Returns** results
   - Extracted item count
   - Linked image count
   - Confidence score
   - Match details

**Usage:**
```typescript
const { data } = await supabase.functions.invoke('smart-receipt-linker', {
  body: {
    documentId: 'receipt-uuid',
    vehicleId: 'vehicle-uuid',
    documentUrl: 'https://...'
  }
});

// data.extractedItems: 5
// data.linkedImages: 3
// data.confidence: 0.92
```

---

### Database Tables

**receipt_items** (extended):
- `vehicle_id` (backfilled from receipts table)
- `extracted_by_ai` (true when AI-extracted)
- `confidence_score` (0-1 from AI)
- `linked_image_ids` (UUIDs of matched images)

**vehicle_documents** (extended):
- `ai_processing_status` ('pending', 'processing', 'completed', 'failed')
- `ai_processing_started_at`
- `ai_processing_completed_at`
- `ai_extraction_confidence`

---

## User Journey

### 1. User uploads receipt

Frontend calls `smart-receipt-linker`:
```typescript
await supabase.functions.invoke('smart-receipt-linker', {
  body: { documentId, vehicleId, documentUrl }
});
```

### 2. AI extracts & links

- Parses: "Master Cylinder $100", "Brake Lines $25"
- Finds images from Sept 11 showing brake work
- Links receipt items to those images
- Creates tags: "master_cylinder" on image #1
- Creates citations: "$100 (receipt confirmed)"

### 3. User views valuation

- Sees "Master Cylinder: **$100**" (clickable)
- Clicks → modal shows:
  - "Submitted by: skylar williams (uploader)"
  - "Evidence: 🧾 Receipt (Sep 11, 2025)"
  - "Confidence: 92%"
  - "Verification: receipt_confirmed"
  - Links: "View Receipt" | "View Image" | "View Tag"

### 4. User fills missing data

System generates blanks:
- "Master Cylinder install (labor unknown)" → HIGH priority
- Suggested: "Who installed? How many hours? Shop rate?"

User clicks blank → form:
- Installer: John Doe
- Hours: 2.5
- Shop rate: $95/hr

System creates:
- `user_valuation_input` record
- New `valuation_citation` for labor
- Links to `labor_rate_sources`
- Updates user's accuracy stats

### 5. Reputation builds

- 3 verified inputs → **Contributor** badge
- 10 inputs, 75% accuracy → **Expert** badge
- 100 inputs, 90% accuracy → **Appraiser** badge

---

## Deployment Status

### Database
✅ Migration applied: `20251101_valuation_citation_system.sql`
✅ Migration applied: `20251101_auto_process_receipts.sql`

**Tables created:**
- `valuation_citations`
- `user_valuation_inputs`
- `user_valuation_accuracy`
- `valuation_blanks`
- `labor_rate_sources`
- Extended: `image_tags` (receipt linking)
- Extended: `receipt_items` (AI extraction)
- Extended: `vehicle_documents` (processing status)

**Triggers:**
- `create_citation_from_receipt()` → auto-creates citations when receipt uploaded
- `create_citation_from_ai_component()` → auto-creates citations when AI detects parts
- `update_user_valuation_accuracy()` → auto-updates user tiers when verified

**Functions:**
- `generate_valuation_blanks(vehicle_id)` → finds missing data

---

### Frontend
✅ Component: `CitationModal.tsx` (shows attribution)
✅ Updated: `VisualValuationBreakdown.tsx` (clickable values, collapsible, renamed)
✅ Updated: `VehicleHeroImage.tsx` (fixed large_url fallback)
✅ Updated: `VehicleProfile.tsx` (uses large_url when available)

✅ **Deployed to production**: November 1, 2025

---

### Edge Functions
✅ `smart-receipt-linker` deployed
  - Extracts receipt data (OpenAI Vision)
  - Matches items to images (AI)
  - Links receipt → images → tags → citations
  - 156kB script size

**Endpoint:**
```
https://qkgaybvrernstplzjaam.supabase.co/functions/v1/smart-receipt-linker
```

---

## Next Steps

### Immediate (user can do now)
1. ✅ Upload receipt → AI auto-extracts & links
2. ✅ Click any dollar value → see source
3. ✅ View receipt/image evidence
4. ✅ Navigate collapsible valuation breakdown

### Near-term (needs frontend integration)
1. Fill valuation blanks (form UI)
2. Verify/dispute citations (buttons)
3. View user accuracy dashboard
4. See tier badges on profiles
5. Browse "blanks" needing fills

### Long-term (system maturity)
1. Mitchell/Chilton API integration (labor standards)
2. Regional shop rate averages
3. Consensus-based value resolution
4. Peer verification workflows
5. Expert-tier manual overrides
6. Market comp API integration

---

## Technical Notes

### Why Clickable Citations?

Traditional valuation engines show: "Estimated Value: $75,825"

Users think: "Where did that come from?"

**Citation system shows:**
- Click "$75,000" → "Purchase price from title (uploaded by owner, Feb 2024)"
- Click "$825" → "5 documented parts: Master Cylinder ($100, receipt), Front Disc Conversion ($300, receipt), ..."
- Click "$100" → "Receipt from AutoZone, Sep 11, 2025, linked to 2 images showing install"

**Result:** Trust, transparency, accountability.

---

### Why Blanks?

AI can estimate, but users have the real data. The system should:
1. Identify what's missing ("labor hours unknown")
2. Prompt user to fill it ("How many hours did this take?")
3. Track accuracy ("This user's labor estimates are 85% accurate")
4. Reward participation (tier elevation, badges)

**Result:** Crowdsourced, expert-level valuations.

---

### Why Tiers?

Not all user input is equal. A novice guessing shop rates vs. a professional mechanic citing actual invoices.

**Tiers:**
- Weight user inputs by tier
- Display tier badges for credibility
- Incentivize accuracy (gamification)
- Build community of experts

**Result:** Wikipedia-style collaborative knowledge, but with financial stakes.

---

## Summary

The Valuation Citation System transforms vehicle valuations from black-box AI estimates into fully-sourced, expert-level appraisals. Every dollar is clickable, every source is traceable, every user builds reputation.

**Core Innovation:**
> Receipts + Images + AI + User Knowledge = Expert Valuation

**Status:** ✅ LIVE IN PRODUCTION

**Date:** November 1, 2025

