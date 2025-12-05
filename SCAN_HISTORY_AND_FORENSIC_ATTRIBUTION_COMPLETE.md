# Scan History & Forensic Attribution System - Complete

## ✅ What Was Implemented

### 1. **Scan History System (Never Replace - Always Save)**

**Tables Created:**
- `ai_scan_sessions` - Each analysis run creates a session (snapshot of AI accuracy)
- `ai_scan_field_confidence` - Confidence per field/table (0-100)

**Key Features:**
- ✅ All scans saved (never replaced)
- ✅ Tracks AI model version and cost
- ✅ Tracks context available at scan time
- ✅ Overall confidence score (0-100)
- ✅ Field-level confidence scores
- ✅ Confidence trends (IMPROVED/DECLINED/SAME vs previous scan)

**Purpose:**
- Snapshot of AI accuracy at given date
- Track improvement over time
- Enable re-analysis with better context
- Measure confidence per field (VIN = 100%, dent severity = 60%)

### 2. **Forensic Attribution for No-EXIF Images**

**Table Created:**
- `image_forensic_attribution` - 5W's analysis for images without EXIF

**5W's Analysis:**
- **WHO**: Uploader + history of no-EXIF uploads
- **WHAT**: What AI analysis indicates user is curating
- **WHERE**: Source URL (if scraped) + inferred location
- **WHEN**: Inferred date from context (before URL date, before file date)
- **WHY**: Context clues (watermark, professional lighting, etc.)

**Confidence Factors:**
- EXIF available: false
- Source URL available: true/false
- Uploader history: true/false (has history of no-EXIF uploads?)
- AI analysis consistent: true/false
- Context richness: 0-100

**Ghost User Types:**
- `exif_device` - Device with EXIF data
- `scraped_profile` - From scraped listing (BaT, CL, etc.)
- `unknown_photographer` - No attribution possible
- `automated_import` - System-generated

### 3. **Ghost User Profile Building**

**Enhanced `ghost_users` table:**
- `profile_buildable` - True if enough data to build claimable profile
- `profile_build_score` - 0-100 score based on:
  - Images: 40 points max (1 per image, capped at 40)
  - Vehicles: 20 points max (10 per vehicle, capped at 20)
  - Date span: 20 points max (1 per day, capped at 20)
  - Location data: 20 points
- `profile_data` - JSONB with inferred profile info
- `ghost_user_subclass` - Type classification

**Auto-update trigger:**
- Calculates build score when new attributions added
- Sets `profile_buildable = true` if score >= 50

**Goal:**
- Allow users to claim their past work
- Build profiles from ghost users with enough data
- Don't lock down data - all data is 0-100 accuracy

### 4. **Field-Level Confidence Tracking**

**Per Field Confidence:**
- `field_category` - 'parts', 'labor', 'materials', 'quality', 'value'
- `field_name` - Specific field (e.g., 'part_0', 'quality_rating')
- `confidence_score` - 0-100
- `confidence_factors` - What contributed to confidence
- `extracted_value` - What was extracted
- `extraction_reasoning` - Why AI thinks this value

**Examples:**
- VIN extraction: 100% confidence (easy, clear text)
- Dent severity: 60% confidence (requires context, subjective)
- Part identification: 85% confidence (visible in photos)
- Labor hours: 75% confidence (based on visible work + Mitchell Guide)

### 5. **Context Tracking**

**Context Available at Scan Time:**
```json
{
  "exif_data": true,
  "source_url": "https://bringatrailer.com/...",
  "vehicle_history_count": 5,
  "organization_data": true,
  "participant_attribution": true,
  "catalog_data": false,
  "oem_manuals": false
}
```

**Future Goal:**
- Every table 100% accurate
- Requires: OEM manuals, catalog data, vehicle specs
- Context refs annotated in every analysis
- Long-term framework for critical thinking

---

## 📊 Tables Ready for Receipt Bundles

### Core Receipt Tables ✅
- `timeline_events` - Main event record
- `work_order_parts` - Parts/components
- `work_order_labor` - Labor tasks
- `work_order_materials` - Materials/consumables
- `work_order_overhead` - Facility costs
- `event_financial_records` - Financial summary
- `event_participants` - Who was involved

### Attribution Tables ✅
- `device_attributions` - EXIF-based attribution
- `ghost_users` - Unclaimed devices
- `image_forensic_attribution` - No-EXIF forensic analysis
- `event_participants` - Assigned participants

### Scan History Tables ✅
- `ai_scan_sessions` - All scan sessions (never replaced)
- `ai_scan_field_confidence` - Confidence per field
- `ai_scan_history_summary` - View with trends

### Views ✅
- `work_order_comprehensive_receipt` - Full receipt data
- `ai_scan_history_summary` - Scan history with trends

---

## 🎯 Ready to Run Analysis

**All tables in place:**
- ✅ Receipt data tables
- ✅ Participant attribution
- ✅ Scan history
- ✅ Forensic attribution
- ✅ Field confidence tracking

**Function Enhanced:**
- ✅ Saves scan sessions (never replaces)
- ✅ Tracks field-level confidence
- ✅ Forensic attribution for no-EXIF images
- ✅ Ghost user classification
- ✅ Context tracking

**Next Steps:**
1. Run analysis on image bundles
2. All scans will be saved as history
3. Confidence scores tracked per field
4. Receipt bundles fully populated
5. Users can claim ghost user work later

---

## 🔍 Forensic Attribution Logic

### For No-EXIF Images:

1. **Check Uploader History**
   - Does uploader have history of no-EXIF uploads?
   - Pattern: frequent vs occasional

2. **Source URL Context**
   - If scraped: Use source URL metadata
   - BaT listings → "Scraped Profile Photographer"
   - CL/FB → "Scraped Profile Photographer"

3. **AI Analysis Context**
   - What does analysis indicate user is curating?
   - Professional photography → Higher confidence
   - Work documentation → Different attribution

4. **Temporal Logic**
   - Image created before URL date?
   - Image created before file creation date?
   - Inferred date from context

5. **Confidence Calculation**
   - Base: 50% (no-EXIF)
   - +20% if source URL available
   - +10% if uploader has history
   - +10% if vehicle history available
   - Max: 100%

---

## 📈 Confidence Measurement

**Known 100% Accuracy:**
- VIN (from NHTSA)
- Factory specs (from VIN decoder)
- Verified user input

**Known 0% Accuracy:**
- Missing data
- No context
- Conflicting sources

**Points in Middle (Tough):**
- Dent severity (needs OEM reference)
- Paint condition (needs context)
- Labor hours (needs Mitchell Guide + context)
- Part identification (needs catalog data)

**Goal:**
- Build framework to measure accuracy
- Track confidence per field
- Improve over time with more context
- Every table 100% accurate (long-term goal)

---

## ✅ Status: READY FOR ANALYSIS

All systems in place:
- ✅ Scan history (never replace)
- ✅ Field confidence tracking
- ✅ Forensic attribution
- ✅ Ghost user profiles
- ✅ Receipt bundle tables
- ✅ Participant attribution

**Ready to generate fully packaged receipt bundles based on images and surrounding context!**

