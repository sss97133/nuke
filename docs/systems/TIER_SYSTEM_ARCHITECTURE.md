# Tier System Architecture Documentation

## Overview

The tier system is a quality-based reputation system that rewards users for both commercial success and platform engagement. Tiers range from F (entry level) to A (expert), with S/SS/SSS tiers locked for future implementation.

---

## Current System (Commercial-Based)

### Architecture

**Database Tables:**
- `seller_tiers` - Stores seller tier data (commercial metrics)
- `buyer_tiers` - Stores buyer tier data (bidding metrics)

**Functions:**
- `refresh_seller_tier(UUID)` - Calculates and updates seller tier based on sales
- `refresh_buyer_tier(UUID)` - Calculates and updates buyer tier based on bids
- `refresh_all_seller_tiers()` - Bulk refresh for all sellers
- `refresh_all_buyer_tiers()` - Bulk refresh for all buyers

**Triggers:**
- `refresh_seller_tier_on_listing_change` - Fires on `vehicle_listings` changes
- `refresh_buyer_tier_on_bid_change` - Fires on `auction_bids` changes

### Current Calculation (Seller)

**Score Components (0-100 points):**
- Sales Volume: 0-30 points (based on successful_sales count)
- Completion Rate: 0-25 points (sales completed / listings created)
- Revenue: 0-25 points (total_revenue_cents)
- Rating: 0-20 points (average_rating from vehicle_listings)

**Tier Assignment:**
- C Tier: 0-29 points
- B Tier: 30-44 points
- A Tier: 45-59 points
- S Tier: 60-74 points (locked)
- SS Tier: 75-89 points (locked)
- SSS Tier: 90+ points (locked)

### Current Calculation (Buyer)

**Score Components (0-100 points):**
- Bidding Activity: 0-30 points (total_bids count)
- Win Rate: 0-25 points (winning_bids / total_bids)
- Spending: 0-25 points (total_spent_cents)
- Payment Reliability: 0-20 points (currently hardcoded based on wins)

**Tier Assignment:** Same as seller tiers

### Limitations

1. **Only Commercial Activity**: Only looks at sales/bids, ignores platform usage
2. **No Platform Metrics**: Doesn't track daily documentation, image uploads, timeline events
3. **Limited Triggers**: Only triggers on listing/bid changes, not on platform activity
4. **Result**: Most users stay at C tier because they don't have sales/bids yet

---

## New System (Platform-Native)

### Architecture

**Extended Tables:**
- `seller_tiers` - Adds platform metrics columns
- `buyer_tiers` - Adds platform metrics columns

**New Functions:**
- `calculate_platform_tier_score(UUID, UUID)` - Main platform tier calculator
- `calculate_daily_engagement_layer(UUID, UUID)` - Daily documentation engagement (0-25 pts)
- `calculate_doc_quality_layer(UUID, UUID)` - Documentation quality (0-20 pts)
- `calculate_temporal_value_layer(UUID, UUID)` - Build recency/temporal value (0-15 pts)
- `calculate_material_quality_layer(UUID)` - Parts/material quality (0-15 pts)
- `calculate_verification_layer(UUID, UUID)` - Restorer/builder verification (0-10 pts)
- `calculate_integration_layer(UUID, UUID)` - Instagram/social integration (0-10 pts)
- `refresh_platform_tier(UUID)` - Main refresh function for platform tiers

**New Triggers:**
- `refresh_tier_on_image_upload` - Fires on `vehicle_images` INSERT
- `refresh_tier_on_timeline_event` - Fires on `vehicle_timeline_events` INSERT
- `refresh_tier_on_receipt_upload` - Fires on `vehicle_receipts` INSERT

---

## Platform-Native Tier Calculation Layers

### Layer 1: Daily Documentation Engagement (0-25 points)

**Purpose:** Reward users who use the platform daily

**Calculation:**
```sql
-- Daily Upload Frequency (0-15 points)
- Daily uploads for 30+ days straight: 15 pts
- Daily uploads for 14+ days straight: 12 pts
- Daily uploads for 7+ days straight: 8 pts
- Uploads 5+ days/week: 6 pts
- Uploads 3+ days/week: 4 pts
- Uploads 1+ day/week: 2 pts

-- Documentation Velocity (0-10 points)
- 10+ items/day (images + events): 10 pts
- 5-9 items/day: 8 pts
- 3-4 items/day: 6 pts
- 1-2 items/day: 4 pts

-- Temporal Decay
- Activity in last 7 days: Full points
- Activity 7-30 days ago: 75% points
- Activity 30-90 days ago: 50% points
- Activity 90+ days ago: 25% points
```

**Data Sources:**
- `vehicle_images.created_at`
- `vehicle_timeline_events.created_at`
- `vehicle_receipts.created_at`

**Key Metrics:**
- Consecutive days with uploads
- Average items per day during active periods
- Last activity date

---

### Layer 2: Documentation Quality & Depth (0-20 points)

**Purpose:** Measure how thoroughly vehicles are documented

**Calculation:**
```sql
-- Visual Documentation (0-8 points)
- 300+ images with full coverage: 8 pts
- 200+ images with good coverage: 6 pts
- 100+ images with basic coverage: 4 pts
- 50+ images: 2 pts

Coverage = (unique angles + unique components) / total possible

-- Receipt/Invoice Documentation (0-6 points)
- 50+ receipts covering full build: 6 pts
- 30+ receipts covering major work: 5 pts
- 20+ receipts covering key purchases: 4 pts
- 10+ receipts: 3 pts
- 5+ receipts: 2 pts

Quality multiplier:
- Receipts linked to timeline events: +20%
- Receipts with vendor verification: +10%
- Receipts with part numbers: +10%

-- Timeline Completeness (0-6 points)
- 150+ events covering full history: 6 pts
- 100+ events covering major milestones: 5 pts
- 50+ events covering key moments: 4 pts
- 20+ events: 2 pts

Temporal consistency bonus:
- Events spaced realistically: +1 pt
- Events have EXIF dates: +1 pt
```

**Data Sources:**
- `vehicle_images` (count, angles, coverage)
- `vehicle_receipts` (count, linked to events)
- `vehicle_timeline_events` (count, dates, consistency)
- `image_tags` (parts cataloged)

---

### Layer 3: Build Recency & Temporal Value (0-15 points)

**Purpose:** Value recent builds documented in real-time

**Calculation:**
```sql
-- Recent Build Documentation (0-10 points)
- Build within last 2 years, documented daily: 10 pts
- Build within last 2 years, documented regularly: 8 pts
- Build within last 5 years, documented during: 6 pts
- Build 5-10 years ago, documented during: 4 pts
- Build 10+ years ago, documented during: 2 pts
- Build 20+ years ago, documented during: 1 pt

-- Real-Time Documentation (0-5 points)
- Timeline events dated during build period: 5 pts
- Images dated during build (EXIF matches): 5 pts
- Receipts dated during build period: 3 pts

Penalties:
- All images uploaded after build complete: -2 pts
- Timeline events backdated: -3 pts
- Receipts dated after build: -1 pt
```

**Data Sources:**
- `vehicle_timeline_events.event_date`
- `vehicle_images.taken_at` (EXIF date)
- `vehicle_receipts.receipt_date`
- `vehicles.created_at` (vehicle creation date)

**Key Logic:**
- Compare event dates to when work actually happened
- Detect retroactive documentation vs. real-time
- Value contemporary documentation over retrospective

---

### Layer 4: Material Quality & Parts Provenance (0-15 points)

**Purpose:** Assess quality of materials and parts used

**Calculation:**
```sql
-- Parts Quality Analysis (0-8 points)
- 80%+ OEM parts: 8 pts
- 60-79% OEM parts: 6 pts
- 40-59% OEM parts: 4 pts
- 20-39% OEM parts: 2 pts
- <20% OEM parts: 0 pts

Quality tiers:
- OEM/NOS: 10/10
- Premium aftermarket (Edelbrock, Bilstein): 7/10
- Quality aftermarket: 5/10
- Generic aftermarket: 3/10

-- Parts Verification (0-4 points)
- 75+ parts tagged with verification: 4 pts
- 50+ parts tagged: 3 pts
- 25+ parts tagged: 2 pts
- 10+ parts tagged: 1 pt

-- Receipt Quality for Parts (0-3 points)
- Receipts with part numbers for 80%+ parts: 3 pts
- Receipts with part numbers for 50-79%: 2 pts
- Receipts with part numbers for 20-49%: 1 pt
```

**Data Sources:**
- `image_tags` (part identification, OEM vs aftermarket)
- `vehicle_receipts` (part numbers, vendors)
- AI analysis from `vehicle_images.ai_scan_metadata`

**Scenarios:**
- **"Looks Good But No Docs"**: Limited to visual-only assessment (0-4 pts)
- **"Fully Documented"**: Can score full 15 pts with receipts and tags

---

### Layer 5: Restorer/Builder Verification (0-10 points)

**Purpose:** Credit verified builders and restorers

**Calculation:**
```sql
-- Restorer Verification Status (0-5 points)
- Verified professional shop: 5 pts
- Verified individual builder with credentials: 4 pts
- Builder linked to organization: 3 pts
- Builder has other verified builds: 2 pts
- Builder unverified: 0 pts

-- Builder Track Record (0-5 points)
- 10+ completed builds, avg quality 8+/10: 5 pts
- 5-9 completed builds, avg quality 8+/10: 4 pts
- 3-4 completed builds, avg quality 7+/10: 3 pts
- 1-2 completed builds, avg quality 7+/10: 2 pts

-- Platform Integration Bonus
- 5+ builds documented on platform: +2 pts
- Builder actively uses platform features: +1 pt
```

**Data Sources:**
- `organizations.is_verified`
- `professional_profiles` (if exists)
- `vehicles` (other builds by same builder)
- `vehicle_quality_scores` (average quality across builds)

---

### Layer 6: External Integration & Streaming (0-10 points)

**Purpose:** Reward Instagram integration and live documentation

**Calculation:**
```sql
-- Instagram/Build Streaming Integration (0-6 points)
- Instagram account linked, posts auto-sync to timeline: 6 pts
- Instagram posts manually linked: 4 pts
- Instagram account linked but not used: 1 pt
- No Instagram integration: 0 pts

Streaming value:
- Daily Instagram posts during build: +2 pts
- Stories/posts documenting progress: +1 pt
- Instagram engagement (likes, comments): +1 pt

-- Live Build Documentation (0-4 points)
- Live streaming sessions during build: 4 pts
- Time-lapse videos: 3 pts
- Video documentation: 2 pts
- Photo-only: 1 pt
```

**Data Sources:**
- `external_identities` (platform='instagram')
- `vehicle_timeline_events` (linked to Instagram posts)
- Timeline event metadata (streaming sessions, videos)

---

## Tier Assignment Logic

### Current Tiers (F → A)

```
F Tier: 0-19 points   (Entry - Minimal engagement)
E Tier: 20-34 points  (Beginner - Basic usage)
D Tier: 35-49 points  (Developing - Regular usage)
C Tier: 50-64 points  (Established - Active usage)
B Tier: 65-79 points  (Advanced - Deep engagement)
A Tier: 80-100 points (Expert - Platform-native excellence)
```

### Future Tiers (S/SS/SSS) - Locked

- S Tier: 60+ points (invitation only, tracking now)
- SS Tier: 75+ points (invitation only, tracking now)
- SSS Tier: 90+ points (invitation only, tracking now)

### Combined Tier Logic

**Platform Tier (Primary):**
- Based on platform-native metrics (F → A)

**Commercial Tier (Secondary):**
- Based on sales/bids (C → SSS, locked)

**Displayed Tier:**
- Show highest accessible tier
- Track S/SS/SSS eligibility for future

---

## Database Schema

### Extended seller_tiers Table

```sql
ALTER TABLE seller_tiers ADD COLUMN IF NOT EXISTS
  -- Platform-native tier metrics
  platform_tier TEXT CHECK (platform_tier IN ('F', 'E', 'D', 'C', 'B', 'A')),
  platform_score INTEGER DEFAULT 0,
  platform_tier_breakdown JSONB DEFAULT '{}',
  platform_tier_updated_at TIMESTAMPTZ,
  
  -- S-tier eligibility tracking (for future)
  s_tier_eligibility_score INTEGER DEFAULT 0,
  s_tier_invitation_status TEXT DEFAULT 'not_eligible' 
    CHECK (s_tier_invitation_status IN ('not_eligible', 'tracking', 'eligible', 'invited', 'declined')),
  s_tier_eligibility_updated_at TIMESTAMPTZ,
  eligibility_tracks JSONB DEFAULT '{}';  -- Track scores per specialization
```

### Extended buyer_tiers Table

```sql
ALTER TABLE buyer_tiers ADD COLUMN IF NOT EXISTS
  platform_tier TEXT CHECK (platform_tier IN ('F', 'E', 'D', 'C', 'B', 'A')),
  platform_score INTEGER DEFAULT 0,
  platform_tier_breakdown JSONB DEFAULT '{}',
  platform_tier_updated_at TIMESTAMPTZ;
```

---

## Trigger Architecture

### Current Triggers (Commercial)

**1. Seller Tier Trigger:**
- **Table:** `vehicle_listings`
- **Events:** INSERT, UPDATE (status, sold_price_cents, rating), DELETE
- **Function:** `trigger_refresh_seller_tier()`
- **Action:** Calls `refresh_seller_tier(seller_id)`

**2. Buyer Tier Trigger:**
- **Table:** `auction_bids`
- **Events:** INSERT, UPDATE (is_winning, is_outbid, displayed_bid_cents), DELETE
- **Function:** `trigger_refresh_buyer_tier()`
- **Action:** Calls `refresh_buyer_tier(bidder_id)`

### New Triggers (Platform-Native)

**3. Image Upload Trigger:**
- **Table:** `vehicle_images`
- **Events:** INSERT
- **Function:** `trigger_refresh_platform_tier()`
- **Action:** Calls `refresh_platform_tier(user_id)`

**4. Timeline Event Trigger:**
- **Table:** `vehicle_timeline_events`
- **Events:** INSERT
- **Function:** `trigger_refresh_platform_tier()`
- **Action:** Calls `refresh_platform_tier(user_id)`

**5. Receipt Upload Trigger:**
- **Table:** `vehicle_receipts`
- **Events:** INSERT
- **Function:** `trigger_refresh_platform_tier()`
- **Action:** Calls `refresh_platform_tier(user_id)`

**Performance Note:** Platform tier triggers use debouncing (refresh once per user per 5 minutes max) to avoid excessive calculations.

---

## Calculation Flow

### When Platform Tier is Calculated

1. **On Activity:**
   - Image uploaded → Trigger fires → Calculate platform tier
   - Timeline event created → Trigger fires → Calculate platform tier
   - Receipt uploaded → Trigger fires → Calculate platform tier

2. **On Demand:**
   - User can manually refresh: `SELECT refresh_platform_tier(user_id)`
   - Admin bulk refresh: `SELECT refresh_all_platform_tiers()`

3. **Scheduled:**
   - Daily batch job: Recalculates all platform tiers (handles edge cases, data corrections)

### Calculation Steps

1. **Gather Data:**
   - Query all user's vehicles (or specific vehicle)
   - Query images, timeline events, receipts
   - Query Instagram integration status
   - Query builder verification status

2. **Calculate Each Layer:**
   - Run all 6 layer calculation functions
   - Each returns a score (0-25, 0-20, 0-15, etc.)

3. **Sum Scores:**
   - Total = Sum of all 6 layers (capped at 100)

4. **Determine Tier:**
   - Map total score to tier (F, E, D, C, B, A)

5. **Store Results:**
   - Update `seller_tiers` or `buyer_tiers` table
   - Store breakdown JSONB for transparency

---

## Example Calculations

### Example 1: "Recent Build, Daily Instagram + Platform Uploads"

**User:** Active builder documenting current restoration

**Data:**
- Build started 3 months ago
- Daily image uploads for 90 days
- 250 images total
- 45 receipts
- 110 timeline events
- 85% OEM parts (tagged)
- Verified professional builder
- Instagram linked, daily posts, auto-sync
- Live streaming sessions

**Calculation:**
```
Daily Engagement: 25 pts (daily uploads 90 days)
Doc Quality: 18 pts (250 images, 45 receipts, 110 events)
Temporal Value: 10 pts (recent build, real-time docs)
Material Quality: 12 pts (85% OEM, tagged)
Verification: 7 pts (verified builder)
Integration: 8 pts (Instagram + streaming)

TOTAL: 80 pts → A Tier
```

### Example 2: "Looks Good, No Docs"

**User:** Vehicle looks great but minimal platform usage

**Data:**
- 50 images (all uploaded at once)
- 0 receipts
- 5 timeline events
- No Instagram
- Unknown builder
- Build completed 10 years ago, docs added recently

**Calculation:**
```
Daily Engagement: 0 pts (no daily usage)
Doc Quality: 3 pts (50 images only)
Temporal Value: 1 pt (old build, retroactive docs)
Material Quality: 2 pts (visual-only assessment)
Verification: 0 pts (unknown builder)
Integration: 0 pts (no integration)

TOTAL: 6 pts → F Tier
```

### Example 3: "Old Restoration, Original Docs Preserved"

**User:** Classic car with preserved historical documentation

**Data:**
- Build 25 years ago
- Original photos preserved (200 images from build)
- Original receipts (35 receipts from build)
- Historical timeline (80 events from build period)
- 90% OEM parts
- Known restorer (verified)
- No modern platform activity

**Calculation:**
```
Daily Engagement: 0 pts (no current activity)
Doc Quality: 15 pts (200 images, 35 receipts, 80 events - preserved)
Temporal Value: 2 pts (old build, but original docs preserved)
Material Quality: 14 pts (90% OEM, documented)
Verification: 5 pts (known restorer)
Integration: 0 pts (no modern integration)
Historical Bonus: +5 pts (preserved original documentation)

TOTAL: 41 pts → D Tier (can reach C/B with historical significance)
```

---

## Performance Considerations

### Optimization Strategies

1. **Debounced Triggers:**
   - Platform tier triggers use debouncing (max once per 5 minutes per user)
   - Prevents excessive calculations during batch uploads

2. **Incremental Calculation:**
   - Cache layer scores in JSONB breakdown
   - Only recalculate changed layers

3. **Batch Processing:**
   - Daily batch job for all users (run overnight)
   - Handles edge cases, data corrections

4. **Indexes:**
   - Index on `vehicle_images.user_id, created_at`
   - Index on `vehicle_timeline_events.user_id, event_date`
   - Index on `vehicle_receipts.user_id, receipt_date`

5. **Materialized Views (Future):**
   - Consider materialized view for daily engagement metrics
   - Refresh incrementally

---

## Migration Strategy

### Phase 1: Schema Updates ✅
- Add platform tier columns to `seller_tiers` and `buyer_tiers`
- Add S-tier eligibility tracking columns

### Phase 2: Helper Functions (In Progress)
- Implement all 6 layer calculation functions
- Implement main platform tier calculation function

### Phase 3: Triggers
- Create triggers for platform activity
- Add debouncing logic

### Phase 4: Initial Population
- Run bulk calculation for all existing users
- Establish baseline tiers

### Phase 5: Testing & Refinement
- Test with real user data
- Adjust scoring thresholds based on distribution
- Optimize performance

### Phase 6: UI Integration
- Display platform tiers in user profiles
- Show tier breakdown/breakdown
- Display progress toward next tier

---

## Future Enhancements

1. **Specialization Tracks:**
   - Racing achievements track
   - Build quality track
   - Provenance track
   - Community contribution track

2. **S-Tier Eligibility System:**
   - Track eligibility across all tracks
   - Invitation system when S-tier unlocks

3. **Tier Benefits:**
   - Unlock features based on tier
   - Priority support
   - Early access to features

4. **Analytics Dashboard:**
   - Show tier distribution
   - Track tier progression over time
   - Identify top performers

---

## Related Documentation

- `supabase/migrations/20251111000005_tiered_auction_system.sql` - Initial tier system
- `supabase/migrations/20251228000000_tier_system_refresh_functions.sql` - Refresh functions
- `supabase/sql/helpers/test_tier_system.sql` - Test suite
- `docs/TIERED_AUCTION_SYSTEM_FRAMEWORK.txt` - Original framework spec

